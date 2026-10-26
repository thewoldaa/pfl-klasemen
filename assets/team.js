/**
 * team.js — halaman detail satu tim.
 *
 * Tidak punya aturan liga sendiri: seluruh angka datang dari engine
 * (teamProfile, headToHeadFull). Tujuannya agar halaman ini tidak pernah
 * berbeda dari klasemen.
 */

import {
  teamProfile,
  headToHeadFull,
  computeStandings,
  formatDateId,
  isPlayed,
} from './modules/engine.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const THEME_KEY = 'pfl.theme';
const TEAM_KEY = 'pfl.selectedTeam';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

const state = { league: null, teams: [], matches: [], teamId: null, h2hTeam: null };

/* ------------------------------------------------------------------ boot */

async function boot() {
  bindChrome();

  const params = new URLSearchParams(location.search);
  state.teamId = params.get('team') || readSession(TEAM_KEY);

  let data;
  try {
    const res = await fetch('dist/data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $('#teamHeader').innerHTML = `<div class="empty">Data tidak bisa dimuat (${esc(err.message)}). Jalankan <code>npm run build</code>.</div>`;
    return;
  }

  state.league = data.league;
  state.teams = data.teams;
  state.matches = data.matches;

  if (!state.teamId || !state.teams.some((t) => t.id === state.teamId)) {
    state.teamId = state.teams[0].id;
  }
  state.h2hTeam = defaultOpponent();

  renderChrome();
  renderHeader();
  renderBody();
  bindInteractions();
}

function readSession(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

/**
 * Lawan yang dibuka pertama kali di panel head-to-head.
 *
 * Memilih lawan pertama menurut abjad akan membuka panel kosong bila kedua
 * tim belum pernah bertemu. Yang dicari: lawan dengan pertemuan terbanyak,
 * lalu yang punya laga selesai, lalu yang paling awal di jadwal.
 */
function defaultOpponent() {
  const others = state.teams.filter((t) => t.id !== state.teamId);
  if (!others.length) return null;

  let best = null;
  for (const opponent of others) {
    const h2h = headToHeadFull(state.teams, state.matches, state.teamId, opponent.id);
    if (!h2h) continue;
    const score = [h2h.matches.length, h2h.played];
    if (
      !best ||
      score[0] > best.score[0] ||
      (score[0] === best.score[0] && score[1] > best.score[1])
    ) {
      best = { id: opponent.id, score };
    }
  }
  return best ? best.id : others[0].id;
}

/* ---------------------------------------------------------------- chrome */

function bindChrome() {
  const setTheme = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#themeLabel').textContent = dark ? 'Mode terang' : 'Mode gelap';
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch {}
  };
  setTheme(document.documentElement.dataset.theme === 'dark');
  $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme !== 'dark'));

  const rail = $('#rail');
  const scrim = $('[data-scrim]');
  const menuBtn = $('#menuBtn');
  const setMenu = (open) => {
    rail.dataset.open = String(open);
    scrim.hidden = !open;
    scrim.dataset.open = String(open);
    menuBtn.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  menuBtn.addEventListener('click', () => setMenu(rail.dataset.open !== 'true'));
  scrim.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rail.dataset.open === 'true') setMenu(false);
  });

  bindSearch();
}

function renderChrome() {
  $('#brandSeason').textContent = state.league.season;
  const stamp = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  $('#freshness').innerHTML = `<span>Data terbangun</span><span>${esc(stamp)} WIB</span>`;
}

/* ---------------------------------------------------------------- header */

function renderHeader() {
  const profile = teamProfile(state.teams, state.matches, state.teamId);
  if (!profile) {
    $('#teamHeader').innerHTML = '<div class="empty">Tim tidak ditemukan.</div>';
    return;
  }
  const { team, row, record } = profile;

  document.title = `${team.name} — PFL Klasemen`;

  $('#teamHeader').innerHTML = `
    <div class="page__head">
      <p class="page__eyebrow">
        <a href="index.html#tim">Tim</a> · ${esc(state.league.name)} ${esc(state.league.season)}
      </p>
      <h1 class="page__title team-title">
        <span class="mono-mark mono-mark--lg" aria-hidden="true">${esc(team.code)}</span>
        ${esc(team.name)}
      </h1>
      <p class="page__sub">${esc(team.city)}, ${esc(team.province)}${team.venue ? ` · ${esc(team.venue)}` : ''}</p>
      ${team.note ? `<p class="page__sub">${esc(team.note)}</p>` : ''}
    </div>

    <div class="figures">
      <div class="figure">
        <span class="figure__label">Peringkat</span>
        <span class="figure__value">${row ? row.rank : '—'}</span>
        <span class="figure__note">${row ? `${row.points} poin` : 'belum bermain'}</span>
      </div>
      <div class="figure">
        <span class="figure__label">Main</span>
        <span class="figure__value">${record.played}</span>
        <span class="figure__note">${record.won} menang · ${record.drawn} seri · ${record.lost} kalah</span>
      </div>
      <div class="figure">
        <span class="figure__label">Gol</span>
        <span class="figure__value">${record.goalsFor}<span class="figure__unit">/ ${record.goalsAgainst}</span></span>
        <span class="figure__note">selisih ${signed(record.goalDifference)}</span>
      </div>
      <div class="figure">
        <span class="figure__label">Bentuk</span>
        <span class="figure__value figure__value--form">${renderForm(profile.form)}</span>
        <span class="figure__note">lima laga terakhir</span>
      </div>
    </div>`;
}

function renderForm(form) {
  const cells = [];
  for (let i = 0; i < 5; i++) {
    const r = form[i];
    cells.push(r
      ? `<span class="form__dot" data-r="${r}">${r}</span>`
      : '<span class="form__dot" data-empty="true" aria-hidden="true"></span>');
  }
  return `<span class="form" aria-label="Lima laga terakhir: ${form.join(' ')}">${cells.join('')}</span>`;
}

/* ------------------------------------------------------------------ body */

function renderBody() {
  const profile = teamProfile(state.teams, state.matches, state.teamId);
  const standings = computeStandings(state.teams, state.matches);
  const byId = new Map(state.teams.map((t) => [t.id, t]));

  const opponents = profile.opponents.map((o) => {
    const team = byId.get(o.teamId);
    return `
      <tr data-opponent="${esc(o.teamId)}">
        <td class="cell-team">
          <div class="team-cell">
            <span class="mono-mark" aria-hidden="true">${esc(team.code)}</span>
            <span class="team-cell__name">${esc(team.short)}</span>
          </div>
        </td>
        <td class="num">${o.played}</td>
        <td class="num">${o.won}</td>
        <td class="num">${o.drawn}</td>
        <td class="num">${o.lost}</td>
        <td class="num">${o.gf}</td>
        <td class="num">${o.ga}</td>
        <td class="num cell-points">${signed(o.gf - o.ga)}</td>
        <td class="cell-actions">
          <button class="btn btn--quiet" type="button" data-h2h="${esc(o.teamId)}">Head-to-head</button>
        </td>
      </tr>`;
  }).join('');

  const timeline = profile.matches.map((m) => {
    const isHome = m.home === state.teamId;
    const opponent = byId.get(isHome ? m.away : m.home);
    const gf = isHome ? m.homeScore : m.awayScore;
    const ga = isHome ? m.awayScore : m.homeScore;
    const result = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    return `
      <div class="match" data-result="${result}">
        <div class="match__when">
          <span class="match__time">${esc(m.time)}</span>
          <span>${esc(formatDateId(m.date, { short: true }))}</span>
        </div>
        <div class="match__teams">
          <div class="match__side">
            <span class="form__dot" data-r="${result}">${result}</span>
            <span class="match__name">${isHome ? 'vs' : '@'} ${esc(opponent.short)}</span>
          </div>
          <div class="match__side" style="color:var(--muted);font-size:var(--fs-small)">
            Pekan ${m.week} · ${esc(m.venue)}
          </div>
        </div>
        <div class="match__score"><span>${gf}</span><span>${ga}</span></div>
      </div>`;
  }).join('');

  const upcoming = profile.upcoming.length
    ? profile.upcoming.slice(0, 6).map((m) => {
        const isHome = m.home === state.teamId;
        const opponent = byId.get(isHome ? m.away : m.home);
        return `
          <div class="match">
            <div class="match__when">
              <span class="match__time">${esc(m.time)}</span>
              <span>${esc(formatDateId(m.date, { short: true }))}</span>
            </div>
            <div class="match__teams">
              <div class="match__side"><span class="match__name">${isHome ? 'vs' : '@'} ${esc(opponent.short)}</span></div>
              <div class="match__side" style="color:var(--muted);font-size:var(--fs-small)">Pekan ${m.week}</div>
            </div>
            <div class="match__score" data-pending="true">belum</div>
          </div>`;
      }).join('')
    : '<div class="empty">Tidak ada laga tersisa di jadwal.</div>';

  $('#teamBody').innerHTML = `
    <section class="section">
      <div class="section__head">
        <div class="section__titles">
          <h2 class="section__title">Hasil per lawan</h2>
          <p class="section__sub">Semua pertemuan musim ini. Pilih head-to-head untuk melihat keduanya berdampingan.</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="standings standings--compact">
          <thead>
            <tr>
              <th scope="col">Lawan</th>
              <th scope="col" class="num">M</th>
              <th scope="col" class="num">W</th>
              <th scope="col" class="num">D</th>
              <th scope="col" class="num">L</th>
              <th scope="col" class="num">GF</th>
              <th scope="col" class="num">GA</th>
              <th scope="col" class="num">SG</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>${opponents || '<tr><td colspan="9"><div class="empty">Belum ada pertemuan.</div></td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section class="section" id="h2hSection">
      <div class="section__head">
        <div class="section__titles">
          <h2 class="section__title">Head-to-head</h2>
          <p class="section__sub">Pilih lawan untuk melihat rekap dan setiap pertemuan.</p>
        </div>
        <div class="section__actions">
          <label class="visually-hidden" for="h2hSelect">Pilih lawan</label>
          <select class="match__input match__input--wide" id="h2hSelect">
            ${state.teams
              .filter((t) => t.id !== state.teamId)
              .map((t) => `<option value="${esc(t.id)}" ${t.id === state.h2hTeam ? 'selected' : ''}>${esc(t.name)}</option>`)
              .join('')}
          </select>
        </div>
      </div>
      <div id="h2hBody"></div>
    </section>

    <section class="section">
      <div class="section__head">
        <div class="section__titles">
          <h2 class="section__title">Lintasan peringkat</h2>
          <p class="section__sub">Posisi setelah setiap pekan yang selesai. Turun berarti naik di tabel.</p>
        </div>
      </div>
      <div class="table-wrap table-wrap--pad">${renderTrajectory(profile, standings)}</div>
    </section>

    <section class="section">
      <div class="section__head">
        <div class="section__titles">
          <h2 class="section__title">Gol per pekan</h2>
          <p class="section__sub">Memasukkan dan kemasukan, satu batang per pekan.</p>
        </div>
      </div>
      <div class="table-wrap table-wrap--pad">${renderGoals(profile)}</div>
    </section>

    <section class="section">
      <div class="section__head">
        <div class="section__titles">
          <h2 class="section__title">Semua laga</h2>
          <p class="section__sub">${profile.matches.length} laga dimainkan${profile.upcoming.length ? `, ${profile.upcoming.length} menanti` : ''}.</p>
        </div>
      </div>
      <div class="table-wrap"><div class="match-list">${timeline || '<div class="empty">Belum ada laga.</div>'}</div></div>
    </section>

    <section class="section">
      <div class="section__head">
        <div class="section__titles">
          <h2 class="section__title">Laga berikutnya</h2>
          <p class="section__sub">Enam laga terdekat.</p>
        </div>
      </div>
      <div class="table-wrap"><div class="match-list">${upcoming}</div></div>
    </section>

    ${renderExtremes(profile, byId)}`;

  renderH2H();
}

function renderExtremes(profile, byId) {
  const items = [];
  if (profile.biggestWin) {
    const opp = byId.get(profile.biggestWin.opponent);
    items.push({
      label: 'Kemenangan terbesar',
      value: `${profile.biggestWin.gf}–${profile.biggestWin.ga}`,
      note: `vs ${opp.short} · ${formatDateId(profile.biggestWin.match.date, { short: true })}`,
    });
  }
  if (profile.biggestLoss) {
    const opp = byId.get(profile.biggestLoss.opponent);
    items.push({
      label: 'Kekalahan terbesar',
      value: `${profile.biggestLoss.gf}–${profile.biggestLoss.ga}`,
      note: `vs ${opp.short} · ${formatDateId(profile.biggestLoss.match.date, { short: true })}`,
    });
  }
  if (!items.length) return '';
  return `
    <section class="section">
      <div class="figures">
        ${items
          .map(
            (i) => `
          <div class="figure">
            <span class="figure__label">${esc(i.label)}</span>
            <span class="figure__value">${esc(i.value)}</span>
            <span class="figure__note">${esc(i.note)}</span>
          </div>`
          )
          .join('')}
      </div>
    </section>`;
}

/** Lintasan peringkat: satu baris kecil per pekan, posisi makin tinggi = makin baik. */
function renderTrajectory(profile) {
  if (!profile.trajectory.length) return '<div class="empty">Belum ada pekan yang selesai.</div>';
  const maxPos = Math.max(...profile.trajectory.map((t) => t.position), 1);
  const total = state.teams.length;

  const rows = profile.trajectory
    .map((t) => {
      const height = Math.round(((total - t.position + 1) / total) * 100);
      return `
        <div class="traj__row">
          <span class="traj__week">Pekan ${t.week}</span>
          <span class="traj__track"><span class="traj__bar" style="width:${height}%"></span></span>
          <span class="traj__value">#${t.position}</span>
          <span class="traj__meta">${t.points} poin</span>
        </div>`;
    })
    .join('');

  return `<div class="traj">${rows}</div>`;
}

/** Gol per pekan: dua batang bertumpuk sisi-sisi. */
function renderGoals(profile) {
  if (!profile.goalsByWeek.length) return '<div class="empty">Belum ada gol.</div>';
  const peak = Math.max(...profile.goalsByWeek.map((w) => Math.max(w.gf, w.ga)), 1);

  const rows = profile.goalsByWeek
    .map((w) => {
      const gf = Math.round((w.gf / peak) * 100);
      const ga = Math.round((w.ga / peak) * 100);
      return `
        <div class="goals__row">
          <span class="goals__week">Pekan ${w.week}</span>
          <span class="goals__bars">
            <span class="goals__bar goals__bar--for" style="width:${gf}%"><span>${w.gf}</span></span>
            <span class="goals__bar goals__bar--against" style="width:${ga}%"><span>${w.ga}</span></span>
          </span>
        </div>`;
    })
    .join('');

  return `
    <div class="goals">
      ${rows}
      <div class="goals__legend">
        <span class="legend__item"><span class="legend__swatch"></span> memasukkan</span>
        <span class="legend__item"><span class="legend__swatch legend__swatch--muted"></span> kemasukan</span>
      </div>
    </div>`;
}

/* ------------------------------------------------------------ head to head */

function renderH2H() {
  const h2h = headToHeadFull(state.teams, state.matches, state.teamId, state.h2hTeam);
  if (!h2h) {
    $('#h2hBody').innerHTML = '<div class="empty">Tim tidak ditemukan.</div>';
    return;
  }

  const matches = h2h.matches.length
    ? h2h.matches
        .map((m) => {
          const played = isPlayed(m);
          const home = state.teams.find((t) => t.id === m.home);
          const away = state.teams.find((t) => t.id === m.away);
          return `
          <div class="match">
            <div class="match__when">
              <span class="match__time">${esc(m.time)}</span>
              <span>${esc(formatDateId(m.date, { short: true }))}</span>
            </div>
            <div class="match__teams">
              <div class="match__side"><span class="mono-mark" aria-hidden="true">${esc(home.code)}</span><span class="match__name">${esc(home.short)}</span></div>
              <div class="match__side"><span class="mono-mark" aria-hidden="true">${esc(away.code)}</span><span class="match__name">${esc(away.short)}</span></div>
            </div>
            ${played
              ? `<div class="match__score"><span>${m.homeScore}</span><span>${m.awayScore}</span></div>`
              : '<div class="match__score" data-pending="true">belum</div>'}
            <div class="match__venue">Pekan ${m.week} · ${esc(m.venue)}</div>
          </div>`;
        })
        .join('')
    : '<div class="empty">Kedua tim belum pernah bertemu di jadwal ini.</div>';

  $('#h2hBody').innerHTML = `
    <div class="h2h">
      <div class="h2h__side">
        <span class="mono-mark mono-mark--lg" aria-hidden="true">${esc(h2h.a.code)}</span>
        <span class="h2h__name">${esc(h2h.a.short)}</span>
        <span class="h2h__score">${h2h.aWins}</span>
        <span class="h2h__meta">${h2h.aGoals} gol</span>
      </div>
      <div class="h2h__middle">
        <span class="h2h__record">${h2h.aWins}–${h2h.draws}–${h2h.bWins}</span>
        <span class="h2h__meta">${h2h.played} laga selesai${h2h.pending ? `, ${h2h.pending} menanti` : ''}</span>
        <span class="h2h__meta">agregat ${h2h.aGoals}–${h2h.bGoals}</span>
      </div>
      <div class="h2h__side h2h__side--right">
        <span class="mono-mark mono-mark--lg" aria-hidden="true">${esc(h2h.b.code)}</span>
        <span class="h2h__name">${esc(h2h.b.short)}</span>
        <span class="h2h__score">${h2h.bWins}</span>
        <span class="h2h__meta">${h2h.bGoals} gol</span>
      </div>
    </div>
    <div class="table-wrap" style="margin-top:var(--gap)">
      <div class="match-list">${matches}</div>
    </div>`;
}

/* ------------------------------------------------------------- interaksi */

function bindInteractions() {
  document.addEventListener('change', (e) => {
    if (e.target.id !== 'h2hSelect') return;
    state.h2hTeam = e.target.value;
    renderH2H();
    $('#h2hSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-h2h]');
    if (!btn) return;
    state.h2hTeam = btn.dataset.h2h;
    const select = $('#h2hSelect');
    if (select) select.value = state.h2hTeam;
    renderH2H();
    $('#h2hSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/* ---------------------------------------------------------------- pencarian */

function bindSearch() {
  const input = $('#searchInput');
  const panel = $('#results');

  const close = () => {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  const sync = () => $('#search').classList.toggle('search--filled', Boolean(input.value));

  input.addEventListener('input', () => {
    sync();
    const q = input.value.trim().toLowerCase();
    if (!q) { close(); return; }

    const hits = state.teams
      .filter((t) =>
        [t.name, t.short, t.code, t.city].some((v) => v.toLowerCase().includes(q))
      )
      .slice(0, 6);

    if (!hits.length) {
      panel.innerHTML = `<div class="results__empty"><strong>Tidak ada tim untuk "${esc(input.value)}"</strong>
        <span>Coba nama tim atau kota.</span></div>`;
    } else {
      panel.innerHTML = `<div class="results__group"><div class="results__heading">Tim</div>
        ${hits
          .map(
            (t) => `<a class="result" href="tim.html?team=${encodeURIComponent(t.id)}">
              <span class="mono-mark" aria-hidden="true">${esc(t.code)}</span>
              <span class="result__main">
                <span class="result__title">${esc(t.name)}</span>
                <span class="result__meta">${esc(t.city)}</span>
              </span></a>`
          )
          .join('')}</div>`;
    }
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); }
    if (e.key === 'Enter') {
      const first = $('.result', panel);
      if (first) first.click();
    }
  });

  $('#searchClear').addEventListener('click', () => {
    input.value = '';
    sync();
    close();
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!$('#search').contains(e.target)) close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
}

boot();
