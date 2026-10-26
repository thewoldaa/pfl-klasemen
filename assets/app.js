/**
 * app.js — antarmuka PFL Klasemen.
 *
 * Prinsip: tidak ada angka klasemen di berkas ini. Semua diturunkan dari
 * `matches` lewat engine.mjs. Satu-satunya keadaan yang disimpan di peramban
 * adalah perubahan skor lokal, dan itu pun hanya untuk perangkat ini.
 */

import {
  computeStandings,
  leagueSummary,
  search,
  buildSearchIndex,
  formatDateId,
  isPlayed,
  kickoffUtc,
  normalize,
  weekRecap,
} from './modules/engine.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const STORE_KEY = 'pfl.localScores.v1';
const THEME_KEY = 'pfl.theme';
const TEAM_KEY = 'pfl.selectedTeam';

/* ------------------------------------------------------------------ keadaan */

const state = {
  league: null,
  teams: [],
  matches: [],
  baseMatches: [],
  localEdits: loadLocal(),
  standings: [],
  summary: null,
  selectedTeam: null,
  activeWeek: null,
  searchIndex: null,
  resultCursor: -1,
  results: [],
};

/* --------------------------------------------------------------- penyimpanan */

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveLocal() {
  try {
    if (Object.keys(state.localEdits).length === 0) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify(state.localEdits));
  } catch {
    /* penyimpanan bisa diblokir; halaman tetap berjalan tanpa memori */
  }
}

function hasLocalEdits() {
  return Object.keys(state.localEdits).length > 0;
}

/** Terapkan perubahan lokal ke daftar laga dasar. */
function applyLocalEdits(baseMatches, edits) {
  return baseMatches.map((m) => {
    const edit = edits[m.id];
    if (!edit) return m;
    return {
      ...m,
      homeScore: edit.homeScore,
      awayScore: edit.awayScore,
      status: Number.isInteger(edit.homeScore) && Number.isInteger(edit.awayScore) ? 'finished' : m.status,
    };
  });
}

/* ------------------------------------------------------------------- utilitas */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const initials = (team) => team.code || team.short.slice(0, 3).toUpperCase();

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

const teamById = (id) => state.teams.find((t) => t.id === id);

const dayLabel = (dateStr) => formatDateId(dateStr).split(',')[0];

const timeAgo = (iso) => {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.round(hours / 24);
  return `${days} hari lalu`;
};

const formatStamp = (iso) =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(iso)) + ' WIB';

/* --------------------------------------------------------------------- boot */

async function boot() {
  try {
    const res = await fetch('dist/data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.league = data.league;
    state.teams = data.teams;
    state.baseMatches = data.matches;
    state.generatedAt = data.generatedAt;
  } catch (err) {
    renderFatal(err);
    return;
  }

  state.searchIndex = buildSearchIndex(state.teams, state.baseMatches);
  state.selectedTeam = readSession(TEAM_KEY);

  bindChrome();
  recompute({ initial: true });
  bindInteractions();
  observeReveals();
}

function readSession(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function writeSession(key, value) {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch { /* diabaikan */ }
}

/** Hitung ulang seluruh turunan dari daftar laga. */
function recompute({ initial = false } = {}) {
  state.matches = applyLocalEdits(state.baseMatches, state.localEdits);
  state.standings = computeStandings(state.teams, state.matches);
  state.summary = leagueSummary(state.standings, state.matches);
  state.searchIndex = buildSearchIndex(state.teams, state.matches);

  if (state.activeWeek == null) state.activeWeek = pickDefaultWeek();

  renderChrome();
  renderFigures();
  renderStandings();
  renderWeeks();
  renderRecentResults();
  renderTeams();
  renderAdmin();

  if (initial) {
    // sorot hasil pencarian pertama bila halaman dibuka dengan ?q=
    const q = new URLSearchParams(location.search).get('q');
    if (q) {
      $('#searchInput').value = q;
      syncSearchFilled();
      openResults(q);
    }
  }
}

function pickDefaultWeek() {
  const played = state.matches.filter(isPlayed);
  if (!played.length) return state.matches[0]?.week ?? 1;
  const next = state.matches.find((m) => !isPlayed(m));
  return next ? next.week : played[played.length - 1].week;
}

/* -------------------------------------------------------------------- fatal */

function renderFatal(err) {
  $('#standingsBody').innerHTML = `
    <tr><td colspan="11">
      <div class="empty">
        Data tidak bisa dimuat (${esc(err.message)}). Jalankan <code>npm run build</code> lalu muat ulang halaman.
      </div>
    </td></tr>`;
  $('#freshness').innerHTML = '<span>Data belum terbangun</span>';
}

/* -------------------------------------------------------------------- chrome */

function bindChrome() {
  // tema
  const setTheme = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#themeLabel').textContent = dark ? 'Mode terang' : 'Mode gelap';
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch {}
  };
  setTheme(document.documentElement.dataset.theme === 'dark');
  $('#themeBtn').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme !== 'dark');
  });

  // menu ponsel
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
  $$('.rail__link').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && rail.dataset.open === 'true') setMenu(false);
  });
  matchMedia('(min-width: 1101px)').addEventListener('change', (e) => {
    if (e.matches) setMenu(false);
  });
}

function renderChrome() {
  const { league, summary } = state;
  $('#brandSeason').textContent = league.season;
  $('#leagueLine').textContent = `${league.name} ${league.season}`;
  document.title = `Klasemen ${league.name} ${league.season}`;

  const pending = state.matches.filter((m) => !isPlayed(m));
  $('#navJadwalCount').textContent = pending.length ? String(pending.length) : '';
  $('#navHasilCount').textContent = String(summary.matchesPlayed);
  $('#navTimCount').textContent = String(state.teams.length);

  // stempel kesegaran data
  const stale = Date.now() - new Date(state.generatedAt).getTime() > 36 * 3600 * 1000;
  $('#freshness').innerHTML = `
    <span>Data terbangun <strong>${esc(timeAgo(state.generatedAt))}</strong></span>
    <span>${esc(formatStamp(state.generatedAt))}</span>
    ${stale ? '<span>Pemeriksaan harian belum berjalan lebih dari 36 jam.</span>' : ''}`;

  // pemberitahuan perubahan lokal
  const count = Object.keys(state.localEdits).length;
  const notice = $('#localNotice');
  if (count) {
    notice.hidden = false;
    $('#localNoticeText').textContent =
      `${count} laga diubah di perangkat ini dan belum masuk ke data publik. ` +
      'Klasemen di bawah memakai perubahan itu; muat ulang halaman untuk kembali ke data resmi.';
  } else {
    notice.hidden = true;
  }
  $('#resetLocalBtn').hidden = !count;
  $('#exportLocalBtn').hidden = !count;
}

/* ------------------------------------------------------------------- figures */

function renderFigures() {
  const { summary, standings } = state;
  const leader = standings[0];
  const next = summary.nextMatch;
  const nextHome = next ? teamById(next.home) : null;
  const nextAway = next ? teamById(next.away) : null;

  const items = [
    {
      label: 'Laga dimainkan',
      value: summary.matchesPlayed,
      unit: `/ ${summary.matchesTotal}`,
      note: `Pekan ${summary.lastFinishedWeek} selesai`,
    },
    {
      label: 'Gol',
      value: summary.goals,
      unit: '',
      note: `${summary.goalsPerMatch} per laga`,
    },
    {
      label: 'Pemuncak',
      value: leader ? leader.code : '—',
      unit: '',
      note: leader ? `${leader.points} poin · ${signed(leader.goalDifference)} SG` : '',
      isCode: true,
    },
    {
      label: 'Laga berikutnya',
      value: next ? `${nextHome.code}–${nextAway.code}` : '—',
      unit: '',
      note: next ? `${formatDateId(next.date, { short: true })} · ${next.time} WIB` : 'Jadwal habis',
      isCode: true,
    },
  ];

  $('#figures').innerHTML = items
    .map(
      (i) => `
    <div class="figure">
      <span class="figure__label">${esc(i.label)}</span>
      <span class="figure__value">${esc(i.value)}${i.unit ? `<span class="figure__unit">${esc(i.unit)}</span>` : ''}</span>
      <span class="figure__note">${esc(i.note)}</span>
    </div>`
    )
    .join('');
}

/* ----------------------------------------------------------------- standings */

function renderStandings() {
  const finalFour = state.league.qualification?.finalFour ?? 4;
  const body = $('#standingsBody');

  body.innerHTML = state.standings
    .map((r) => {
      const zone = r.rank <= finalFour ? 'final-four' : 'none';
      const team = teamById(r.teamId);
      const highlight = state.selectedTeam === r.teamId;
      return `
      <tr data-zone="${zone}" data-highlight="${highlight}" data-team="${esc(r.teamId)}">
        <td class="cell-rank num">${r.rank}</td>
        <td class="cell-team">
          <div class="team-cell">
            <span class="mono-mark" aria-hidden="true">${esc(initials(team))}</span>
            <span class="team-cell__name">${esc(r.short)}</span>
          </div>
        </td>
        <td class="cell-stat num">${r.played}</td>
        <td class="cell-stat num cell-optional">${r.won}</td>
        <td class="cell-stat num cell-optional">${r.drawn}</td>
        <td class="cell-stat num cell-optional">${r.lost}</td>
        <td class="cell-stat num">${r.goalsFor}</td>
        <td class="cell-stat num cell-optional">${r.goalsAgainst}</td>
        <td class="cell-stat num cell-diff">${signed(r.goalDifference)}</td>
        <td class="cell-stat num cell-points">${r.points}</td>
        <td class="cell-form">${renderForm(r.form)}</td>
        <td class="cell-stats">
          <span>${r.played} main</span>
          <span>${r.won}–${r.drawn}–${r.lost}</span>
          <span>${r.goalsFor}–${r.goalsAgainst}</span>
          <span>${signed(r.goalDifference)}</span>
        </td>
      </tr>`;
    })
    .join('');

  const played = state.summary.matchesPlayed;
  $('#standingsSub').textContent = played
    ? `Setelah ${played} dari ${state.summary.matchesTotal} laga. Diurutkan: poin, selisih gol, gol memasukkan, head-to-head.`
    : 'Belum ada laga yang dimainkan.';

  $('#standingsLegend').innerHTML = `
    <span class="legend__item"><span class="legend__swatch"></span> Lolos ke Final Four</span>
    <span class="legend__item">${state.league.points.win} poin menang · ${state.league.points.draw} poin seri</span>
    <span class="legend__item">${esc(state.league.qualification?.note ?? '')}</span>`;
}

function renderForm(form) {
  const cells = [];
  for (let i = 0; i < 5; i++) {
    const r = form[i];
    cells.push(
      r
        ? `<span class="form__dot" data-r="${r}" title="${r === 'W' ? 'Menang' : r === 'D' ? 'Seri' : 'Kalah'}">${r}</span>`
        : '<span class="form__dot" data-empty="true" aria-hidden="true"></span>'
    );
  }
  return `<span class="form" aria-label="Lima laga terakhir: ${form.join(' ')}">${cells.join('')}</span>`;
}

/* ---------------------------------------------------------------------- pekan */

function renderWeeks() {
  const tabs = $('#weekTabs');
  const weeks = [...new Set(state.matches.map((m) => m.week))].sort((a, b) => a - b);

  tabs.innerHTML = weeks
    .map((w) => {
      const inWeek = state.matches.filter((m) => m.week === w);
      const done = inWeek.filter(isPlayed).length;
      const stateName = done === 0 ? 'none' : done === inWeek.length ? 'done' : 'partial';
      const label =
        stateName === 'done' ? `${done} laga selesai` : stateName === 'partial' ? `${done} dari ${inWeek.length}` : 'belum dimainkan';
      return `
      <button class="week-tab" role="tab" id="tab-${w}" data-week="${w}"
              aria-selected="${w === state.activeWeek}" aria-controls="weekPanel"
              title="Pekan ${w} — ${label}">
        <span class="week-tab__dot" data-state="${stateName}" aria-hidden="true"></span>
        Pekan ${w}
      </button>`;
    })
    .join('');

  renderWeekPanel();
}

function renderWeekPanel() {
  const w = state.activeWeek;
  const recap = weekRecap(state.teams, state.matches, w);
  const matches = recap.matches;
  const venue = matches[0]?.venue;
  const dates = [...new Set(matches.map((m) => m.date))];
  const done = matches.filter(isPlayed).length;

  $('#weekPanel').innerHTML = `
    <div class="week-meta">
      <span><strong>Pekan ${w}</strong></span>
      ${venue ? `<span>${esc(venue)}${matches[0].city ? `, ${esc(matches[0].city)}` : ''}</span>` : ''}
      <span>${dates.map((d) => esc(formatDateId(d, { short: true }))).join(' & ') || '—'}</span>
      <span>${done}/${matches.length} laga selesai</span>
    </div>
    <div class="table-wrap">
      <div class="match-list">${matches.map((m) => matchRow(m)).join('')}</div>
    </div>`;
}

function matchRow(m, opts = {}) {
  const home = teamById(m.home);
  const away = teamById(m.away);
  const played = isPlayed(m);
  const homeWin = played && m.homeScore > m.awayScore;
  const awayWin = played && m.awayScore > m.homeScore;

  const highlightHome = state.selectedTeam === m.home;
  const highlightAway = state.selectedTeam === m.away;

  return `
  <div class="match${opts.compact ? ' match--compact' : ''}" data-match="${esc(m.id)}">
    <div class="match__when">
      <span class="match__time">${esc(m.time)}</span>
      <span>${esc(formatDateId(m.date, { short: true }))}</span>
    </div>
    <div class="match__teams">
      <div class="match__side match__side--home" data-winner="${played ? homeWin : 'na'}" ${highlightHome ? 'style="font-weight:700"' : ''}>
        <span class="mono-mark" aria-hidden="true">${esc(home.code)}</span>
        <span class="match__name">${esc(home.short)}</span>
      </div>
      <div class="match__side match__side--away" data-winner="${played ? awayWin : 'na'}" ${highlightAway ? 'style="font-weight:700"' : ''}>
        <span class="mono-mark" aria-hidden="true">${esc(away.code)}</span>
        <span class="match__name">${esc(away.short)}</span>
      </div>
    </div>
    ${
      played
        ? `<div class="match__score"><span>${m.homeScore}</span><span>${m.awayScore}</span></div>`
        : `<div class="match__score" data-pending="true">belum</div>`
    }
    ${opts.compact ? '' : `<div class="match__venue">${esc(m.venue)} · Pekan ${m.week}</div>`}
  </div>`;
}

/* ------------------------------------------------------------- hasil terbaru */

function renderRecentResults() {
  const played = state.matches
    .filter(isPlayed)
    .sort((a, b) => kickoffUtc(b) - kickoffUtc(a))
    .slice(0, 8);

  $('#recentResults').innerHTML = played.length
    ? played.map((m) => matchRow(m, { compact: true })).join('')
    : '<div class="empty">Belum ada laga yang selesai musim ini.</div>';

  const last = played[0];
  $('#hasilSub').textContent = last
    ? `Delapan laga terakhir. Terakhir: ${formatDateId(last.date)} pukul ${last.time} WIB.`
    : 'Belum ada hasil.';
}

/* ----------------------------------------------------------------------- tim */

function renderTeams() {
  const byId = new Map(state.standings.map((r) => [r.teamId, r]));

  $('#teamGrid').innerHTML = state.teams
    .map((t) => {
      const row = byId.get(t.id);
      const selected = state.selectedTeam === t.id;
      return `
      <button class="team-card" type="button" data-team="${esc(t.id)}" aria-pressed="${selected}">
        <span class="team-card__head">
          <span class="mono-mark" aria-hidden="true">${esc(initials(t))}</span>
          <span>
            <span class="team-card__name">${esc(t.short)}</span><br>
            <span class="team-card__meta">${esc(t.city)}, ${esc(t.province)}</span>
          </span>
        </span>
        <span class="team-card__figures">
          <span class="team-card__figure"><span>Peringkat</span><strong>${row ? row.rank : '—'}</strong></span>
          <span class="team-card__figure"><span>Poin</span><strong>${row ? row.points : '—'}</strong></span>
          <span class="team-card__figure"><span>Selisih</span><strong>${row ? signed(row.goalDifference) : '—'}</strong></span>
        </span>
      </button>`;
    })
    .join('');

  $('#clearTeamBtn').hidden = !state.selectedTeam;
  $('#timSub').textContent = state.selectedTeam
    ? `Menyorot ${teamById(state.selectedTeam).short}. Pilih lagi untuk melepas.`
    : 'Pilih tim untuk menyorotnya di klasemen dan jadwal.';
}

/* --------------------------------------------------------------------- admin */

function renderAdmin() {
  const pending = state.matches
    .filter((m) => !isPlayed(m))
    .sort((a, b) => kickoffUtc(a) - kickoffUtc(b))
    .slice(0, 12);

  const rows = $('#adminRows');

  if (!pending.length) {
    rows.innerHTML = '<div class="admin-empty">Semua laga pada jadwal yang tercatat sudah punya skor.</div>';
  } else {
    rows.innerHTML = pending
      .map((m) => {
        const home = teamById(m.home);
        const away = teamById(m.away);
        return `
        <div class="admin-row" data-match="${esc(m.id)}">
          <span class="admin-row__date">${esc(formatDateId(m.date, { short: true }))}<br>${esc(m.time)}</span>
          <span class="admin-row__team admin-row__team--home">${esc(home.short)}</span>
          <span class="admin-row__score">
            <input class="match__input" type="number" min="0" max="60" inputmode="numeric"
                   data-side="home" data-match="${esc(m.id)}" aria-label="Gol ${esc(home.short)}" placeholder="0">
            <span class="admin-row__dash">–</span>
            <input class="match__input" type="number" min="0" max="60" inputmode="numeric"
                   data-side="away" data-match="${esc(m.id)}" aria-label="Gol ${esc(away.short)}" placeholder="0">
          </span>
          <span class="admin-row__team">${esc(away.short)}</span>
        </div>`;
      })
      .join('');
  }

  const count = Object.keys(state.localEdits).length;
  $('#adminSub').textContent = pending.length
    ? `${pending.length} laga terdekat · ${count} perubahan lokal`
    : 'Tidak ada laga menunggu.';
  $('#editModeText').innerHTML =
    'Skor yang kamu isi di sini <strong>hanya tersimpan di peramban ini</strong> sampai halaman dimuat ulang. ' +
    'Klasemen langsung dihitung ulang. Untuk menjadikannya permanen, ekspor perubahannya dan masukkan ke ' +
    '<code>data/matches.json</code> lewat pull request.';
}

/* ------------------------------------------------------------------ interaksi */

function bindInteractions() {
  // pilih pekan
  $('#weekTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.week-tab');
    if (!tab) return;
    state.activeWeek = Number(tab.dataset.week);
    $$('.week-tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    renderWeekPanel();
  });

  // sorot tim
  $('#teamGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.team-card');
    if (!card) return;
    const id = card.dataset.team;
    state.selectedTeam = state.selectedTeam === id ? null : id;
    writeSession(TEAM_KEY, state.selectedTeam);
    renderStandings();
    renderTeams();
    renderWeekPanel();
    renderRecentResults();
    if (state.selectedTeam) {
      const row = $(`tr[data-team="${CSS.escape(state.selectedTeam)}"]`);
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  $('#clearTeamBtn').addEventListener('click', () => {
    state.selectedTeam = null;
    writeSession(TEAM_KEY, null);
    renderStandings();
    renderTeams();
    renderWeekPanel();
    renderRecentResults();
  });

  // input skor
  $('#adminRows').addEventListener('input', (e) => {
    const input = e.target.closest('.match__input');
    if (!input) return;
    const id = input.dataset.match;
    const row = input.closest('.admin-row');
    const homeEl = $('.match__input[data-side="home"]', row);
    const awayEl = $('.match__input[data-side="away"]', row);
    const h = parseInt(homeEl.value, 10);
    const a = parseInt(awayEl.value, 10);

    if (Number.isInteger(h) && Number.isInteger(a) && h >= 0 && a >= 0) {
      state.localEdits[id] = { homeScore: h, awayScore: a, at: new Date().toISOString() };
    } else {
      delete state.localEdits[id];
    }
    saveLocal();
    recompute();
    // kembalikan fokus ke kolom yang sedang diketik
    const again = $(`.match__input[data-match="${CSS.escape(id)}"][data-side="${input.dataset.side}"]`);
    again?.focus();
  });

  $('#resetLocalBtn').addEventListener('click', () => {
    if (!confirm('Batalkan semua perubahan skor lokal di perangkat ini?')) return;
    state.localEdits = {};
    saveLocal();
    recompute();
  });

  $('#exportLocalBtn').addEventListener('click', () => {
    const lines = Object.entries(state.localEdits).map(([id, v]) => {
      const m = state.baseMatches.find((x) => x.id === id);
      return `${m.id}  ${m.home} ${v.homeScore}-${v.awayScore} ${m.away}`;
    });
    const text = `# Perubahan lokal ${new Date().toISOString()}\n${lines.join('\n')}\n`;
    navigator.clipboard?.writeText(text).then(
      () => {
        const btn = $('#exportLocalBtn');
        const old = btn.textContent;
        btn.textContent = 'Tersalin';
        setTimeout(() => { btn.textContent = old; }, 1600);
      },
      () => alert(text)
    );
  });

  // salin CSV
  $('#copyCsvBtn').addEventListener('click', () => {
    const head = ['Peringkat', 'Tim', 'Main', 'Menang', 'Seri', 'Kalah', 'GF', 'GA', 'SG', 'Poin'];
    const rows = state.standings.map((r) => [r.rank, r.name, r.played, r.won, r.drawn, r.lost, r.goalsFor, r.goalsAgainst, r.goalDifference, r.points]);
    const csv = [head, ...rows].map((r) => r.join(',')).join('\n');
    navigator.clipboard?.writeText(csv).then(() => {
      const btn = $('#copyCsvBtn');
      const old = btn.innerHTML;
      btn.textContent = 'Tersalin';
      setTimeout(() => { btn.innerHTML = old; }, 1600);
    });
  });

  $('#adminBtn').addEventListener('click', () => {
    $('#skor').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('.match__input')?.focus();
  });

  // navigasi rail mengikuti posisi gulir
  const sections = ['klasemen', 'jadwal', 'hasil', 'tim', 'skor'];
  const navLinks = new Map($$('.rail__link').map((a) => [a.dataset.nav, a]));
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        navLinks.forEach((link, key) => {
          if (key) link.setAttribute('aria-current', String(key === entry.target.id));
        });
      }
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );
  sections.forEach((id) => {
    const el = document.getElementById(id);
    if (el) spy.observe(el);
  });

  bindSearch();
}

/* -------------------------------------------------------------------- cari */

function bindSearch() {
  const input = $('#searchInput');
  const panel = $('#results');

  const close = () => {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    state.resultCursor = -1;
  };

  input.addEventListener('input', () => {
    syncSearchFilled();
    const q = input.value.trim();
    if (!q) { close(); renderAll(); return; }
    openResults(q);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) openResults(input.value.trim());
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); input.blur(); return; }
    if (e.key === 'Enter') {
      const items = $$('.result', panel);
      if (state.resultCursor >= 0 && items[state.resultCursor]) {
        e.preventDefault();
        items[state.resultCursor].click();
      }
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = $$('.result', panel);
    if (!items.length) return;
    e.preventDefault();
    state.resultCursor = e.key === 'ArrowDown'
      ? (state.resultCursor + 1) % items.length
      : (state.resultCursor - 1 + items.length) % items.length;
    items.forEach((el, i) => el.setAttribute('data-active', String(i === state.resultCursor)));
    items[state.resultCursor].scrollIntoView({ block: 'nearest' });
  });

  $('#searchClear').addEventListener('click', () => {
    input.value = '';
    syncSearchFilled();
    close();
    renderAll();
    input.focus();
  });

  document.addEventListener('click', (e) => {
    if (!$('#search').contains(e.target)) close();
  });

  // tombol "/" memfokuskan pencarian
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  panel.addEventListener('click', (e) => {
    const item = e.target.closest('.result');
    if (!item) return;
    const { kind, id } = item.dataset;
    close();
    if (kind === 'team') {
      state.selectedTeam = id;
      writeSession(TEAM_KEY, id);
      renderAll();
      $('#klasemen').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (kind === 'match') {
      const m = state.matches.find((x) => x.id === id);
      if (!m) return;
      state.activeWeek = m.week;
      renderWeeks();
      $('#jadwal').scrollIntoView({ behavior: 'smooth', block: 'start' });
      requestAnimationFrame(() => {
        const row = $(`.match[data-match="${CSS.escape(id)}"]`);
        row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        row?.animate(
          [{ background: 'var(--accent-soft)' }, { background: 'transparent' }],
          { duration: 1400, easing: 'ease-out' }
        );
      });
    } else if (kind === 'week') {
      state.activeWeek = Number(id);
      renderWeeks();
      $('#jadwal').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function syncSearchFilled() {
  $('#search').classList.toggle('search--filled', Boolean($('#searchInput').value));
}

function renderAll() {
  renderStandings();
  renderWeeks();
  renderRecentResults();
  renderTeams();
  renderAdmin();
}

function openResults(q) {
  const panel = $('#results');
  const result = search(state.searchIndex, state.teams, state.matches, q, { today: new Date() });
  state.results = result;
  state.resultCursor = -1;

  const parts = [];

  if (result.teams.length) {
    parts.push(`<div class="results__group">
      <div class="results__heading">Tim</div>
      ${result.teams.slice(0, 4).map((t) => {
        const row = state.standings.find((r) => r.teamId === t.id);
        return `<button class="result" type="button" role="option" data-kind="team" data-id="${esc(t.id)}">
          <span class="mono-mark" aria-hidden="true">${esc(initials(t))}</span>
          <span class="result__main">
            <span class="result__title">${esc(t.name)}</span>
            <span class="result__meta">${esc(t.city)} · ${row ? `peringkat ${row.rank}, ${row.points} poin` : 'belum bermain'}</span>
          </span>
        </button>`;
      }).join('')}
    </div>`);
  }

  if (result.intent.kind === 'week') {
    parts.push(`<div class="results__group">
      <div class="results__heading">Pekan</div>
      <button class="result" type="button" role="option" data-kind="week" data-id="${result.intent.week}">
        <span class="result__main">
          <span class="result__title">Pekan ${result.intent.week}</span>
          <span class="result__meta">${result.matches.length} laga · ${result.matches.filter(isPlayed).length} selesai</span>
        </span>
      </button>
    </div>`);
  }

  if (result.matches.length) {
    const shown = result.matches.slice(0, 24);
    parts.push(`<div class="results__group">
      <div class="results__heading">${result.intent.kind === 'date' ? esc(result.note) : 'Laga'}</div>
      ${shown.map((m) => {
        const home = teamById(m.home);
        const away = teamById(m.away);
        const played = isPlayed(m);
        return `<button class="result" type="button" role="option" data-kind="match" data-id="${esc(m.id)}">
          <span class="result__main">
            <span class="result__title">${esc(home.short)} vs ${esc(away.short)}</span>
            <span class="result__meta">${esc(formatDateId(m.date, { short: true }))} · ${esc(m.time)} · Pekan ${m.week}</span>
          </span>
          ${played
            ? `<span class="result__score">${m.homeScore}–${m.awayScore}</span>`
            : '<span class="result__score result__score--pending">belum</span>'}
        </button>`;
      }).join('')}
      ${result.matches.length > shown.length ? `<div class="results__empty"><span>${result.matches.length - shown.length} laga lain — persempit pencarian.</span></div>` : ''}
    </div>`);
  }

  if (!parts.length) {
    parts.push(`<div class="results__empty">
      <strong>Tidak ada hasil untuk "${esc(q)}"</strong>
      <span>Coba nama tim, tanggal, atau nomor pekan.</span>
    </div>
    <div class="results__hints">
      ${hintChips()}
    </div>`);
  }

  panel.innerHTML = parts.join('');
  panel.hidden = false;
  $('#searchInput').setAttribute('aria-expanded', 'true');
}

function hintChips() {
  const nextWeek = state.matches.find((m) => !isPlayed(m))?.week;
  const chips = [
    state.standings[0] ? state.standings[0].short : null,
    nextWeek ? `pekan ${nextWeek}` : null,
    state.matches.find((m) => !isPlayed(m)) ? formatDateId(state.matches.find((m) => !isPlayed(m)).date, { short: true }) : null,
  ].filter(Boolean);
  return chips
    .map((c) => `<button class="week-tab" type="button" data-hint="${esc(c)}">${esc(c)}</button>`)
    .join('');
}

document.addEventListener('click', (e) => {
  const hint = e.target.closest('[data-hint]');
  if (!hint) return;
  const input = $('#searchInput');
  input.value = hint.dataset.hint;
  syncSearchFilled();
  openResults(hint.dataset.hint);
  input.focus();
});

/* -------------------------------------------------------------------- reveal */

function observeReveals() {
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    els.forEach((el) => el.setAttribute('data-shown', 'true'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.setAttribute('data-shown', 'true');
          io.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '0px 0px -10% 0px' }
  );
  els.forEach((el) => io.observe(el));
}

boot();
