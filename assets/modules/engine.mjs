/**
 * engine.mjs — satu-satunya implementasi aturan liga.
 *
 * Dipakai oleh dua konsumen:
 *   1. scripts/build.mjs (Node) untuk membangun data/standings.json
 *   2. browser, untuk mode luring dan untuk menghitung ulang saat data lokal berubah
 *
 * Aturan yang tidak boleh dilanggar: klasemen SELALU dihitung dari daftar laga.
 * Tidak ada angka klasemen yang boleh diketik manual di mana pun.
 */

export const POINTS = { win: 3, draw: 1, loss: 0 };

/* ---------------------------------------------------------------- helpers */

export const isPlayed = (m) =>
  m.status === 'finished' &&
  Number.isInteger(m.homeScore) &&
  Number.isInteger(m.awayScore) &&
  m.homeScore >= 0 &&
  m.awayScore >= 0;

/** Tanggal laga sebagai angka YYYYMMDD di zona Asia/Jakarta. */
export function dateKey(dateStr) {
  return Number(dateStr.replace(/-/g, ''));
}

/** "2026-10-31" + "14:00" -> objek Date dalam UTC yang mewakili jam dinding Jakarta. */
export function kickoffUtc(match) {
  const [y, mo, d] = match.date.split('-').map(Number);
  const [h, mi] = (match.time || '00:00').split(':').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 7, mi));
}

/* ------------------------------------------------------------- klasemen */

/**
 * Hitung klasemen dari daftar laga.
 * @param {Array} teams   data/teams.json
 * @param {Array} matches data/matches.json -> .matches
 * @param {Object} opts   { headToHead: boolean }
 * @returns {Array} baris klasemen terurut, sudah berisi peringkat
 */
export function computeStandings(teams, matches, opts = {}) {
  const headToHead = opts.headToHead !== false;

  const rows = new Map();
  for (const t of teams) {
    rows.set(t.id, {
      teamId: t.id,
      name: t.name,
      short: t.short,
      code: t.code,
      city: t.city,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [],
      // jejak hasil antar tim untuk tiebreak head-to-head
      h2h: new Map(),
    });
  }

  const played = matches.filter(isPlayed).sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.time.localeCompare(b.time));

  for (const m of played) {
    const home = rows.get(m.home);
    const away = rows.get(m.away);
    if (!home || !away) continue;

    home.played++;
    away.played++;
    home.goalsFor += m.homeScore;
    home.goalsAgainst += m.awayScore;
    away.goalsFor += m.awayScore;
    away.goalsAgainst += m.homeScore;

    let homePoints;
    let awayPoints;
    let homeResult;
    let awayResult;

    if (m.homeScore > m.awayScore) {
      home.won++; away.lost++;
      homePoints = POINTS.win; awayPoints = POINTS.loss;
      homeResult = 'W'; awayResult = 'L';
    } else if (m.homeScore < m.awayScore) {
      home.lost++; away.won++;
      homePoints = POINTS.loss; awayPoints = POINTS.win;
      homeResult = 'L'; awayResult = 'W';
    } else {
      home.drawn++; away.drawn++;
      homePoints = POINTS.draw; awayPoints = POINTS.draw;
      homeResult = 'D'; awayResult = 'D';
    }

    home.points += homePoints;
    away.points += awayPoints;
    home.form.push(homeResult);
    away.form.push(awayResult);

    // head-to-head: poin dan selisih gol khusus pertemuan kedua tim
    if (!home.h2h.has(away.teamId)) home.h2h.set(away.teamId, { points: 0, gd: 0, gf: 0 });
    if (!away.h2h.has(home.teamId)) away.h2h.set(home.teamId, { points: 0, gd: 0, gf: 0 });
    const hh = home.h2h.get(away.teamId);
    const ah = away.h2h.get(home.teamId);
    hh.points += homePoints; hh.gd += m.homeScore - m.awayScore; hh.gf += m.homeScore;
    ah.points += awayPoints; ah.gd += m.awayScore - m.homeScore; ah.gf += m.awayScore;
  }

  const list = [...rows.values()].map((r) => {
    r.goalDifference = r.goalsFor - r.goalsAgainst;
    r.form = r.form.slice(-5);
    return r;
  });

  list.sort((a, b) => compareRows(a, b, headToHead));

  let rank = 0;
  let previous = null;
  for (const row of list) {
    // dua tim dengan angka identik berbagi peringkat
    if (!previous || !sameRankKey(previous, row)) rank++;
    row.rank = rank;
    previous = row;
  }
  return list;
}

function sameRankKey(a, b) {
  return (
    a.points === b.points &&
    a.goalDifference === b.goalDifference &&
    a.goalsFor === b.goalsFor &&
    a.played === b.played
  );
}

function compareRows(a, b, headToHead) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
  if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
  if (headToHead) {
    const ah = a.h2h.get(b.teamId);
    const bh = b.h2h.get(a.teamId);
    if (ah && bh) {
      if (bh.points !== ah.points) return bh.points - ah.points;
      if (bh.gd !== ah.gd) return bh.gd - ah.gd;
      if (bh.gf !== ah.gf) return bh.gf - ah.gf;
    }
  }
  if (b.won !== a.won) return b.won - a.won;
  return a.name.localeCompare(b.name, 'id');
}

/* --------------------------------------------------------- fakta turunan */

/** Ringkasan liga untuk bilah angka di atas halaman. */
export function leagueSummary(standings, matches) {
  const played = matches.filter(isPlayed);
  const goals = played.reduce((n, m) => n + m.homeScore + m.awayScore, 0);
  const finishedWeeks = [...new Set(played.map((m) => m.week))].sort((a, b) => a - b);
  const upcoming = matches
    .filter((m) => !isPlayed(m))
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.time.localeCompare(b.time));

  return {
    matchesPlayed: played.length,
    matchesTotal: matches.length,
    goals,
    goalsPerMatch: played.length ? +(goals / played.length).toFixed(2) : 0,
    lastFinishedWeek: finishedWeeks.length ? finishedWeeks[finishedWeeks.length - 1] : 0,
    nextMatch: upcoming[0] || null,
    leader: standings[0] ? standings[0].teamId : null,
  };
}

/** Rekap satu pekan: daftar laga + klasemen setelah pekan itu. */
export function weekRecap(teams, matches, week) {
  const inWeek = matches
    .filter((m) => m.week === week)
    .sort((a, b) => dateKey(a.date) - dateKey(b.date) || a.time.localeCompare(b.time));
  const upTo = matches.filter((m) => m.week <= week);
  return {
    week,
    matches: inWeek,
    standings: computeStandings(teams, upTo),
    complete: inWeek.length > 0 && inWeek.every(isPlayed),
  };
}

/** Rekor pertemuan dua tim. */
export function headToHead(teams, matches, teamA, teamB) {
  const played = matches.filter((m) => isPlayed(m) && ((m.home === teamA && m.away === teamB) || (m.home === teamB && m.away === teamA)));
  let aWins = 0, bWins = 0, draws = 0, aGoals = 0, bGoals = 0;
  for (const m of played) {
    const aIsHome = m.home === teamA;
    const ag = aIsHome ? m.homeScore : m.awayScore;
    const bg = aIsHome ? m.awayScore : m.homeScore;
    aGoals += ag; bGoals += bg;
    if (ag > bg) aWins++; else if (ag < bg) bWins++; else draws++;
  }
  return { matches: played, aWins, bWins, draws, aGoals, bGoals };
}

/* --------------------------------------------------------------- pencarian */

const MONTHS_ID = [
  'januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
];
const DAYS_ID = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];

export function formatDateId(dateStr, opts = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = DAYS_ID[dt.getUTCDay()];
  const month = MONTHS_ID[m - 1];
  if (opts.short) return `${d} ${month.slice(0, 3)}`;
  return `${day}, ${d} ${month} ${y}`;
}

/** Normalisasi teks kueri: huruf kecil, buang diakritik dan tanda baca. */
export function normalize(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s:/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Urai kueri menjadi maksud yang bisa dieksekusi.
 * Mendukung: nama tim, kode tim, tanggal (2026-10-31, 31/10, 31 oktober),
 * nama pekan (pekan 3), kata relatif (hari ini, besok, minggu ini), "vs".
 */
export function parseQuery(rawQuery, ctx = {}) {
  const q = normalize(rawQuery);
  if (!q) return { kind: 'empty', raw: rawQuery };

  // "hari ini" berarti hari ini di Jakarta, bukan di zona waktu mesin.
  const today = jakartaToday(ctx.today);

  // tanggal ISO
  let m = q.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return { kind: 'date', date: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, raw: rawQuery };

  // pekan
  m = q.match(/\b(?:pekan|week|minggu ke|ronde|round)\s*[-:]?\s*(\d{1,2})\b/);
  if (m) return { kind: 'week', week: Number(m[1]), raw: rawQuery };

  // hari ini / besok / kemarin
  if (/\bhari ini\b|\btoday\b/.test(q)) return { kind: 'date', date: isoDate(today), raw: rawQuery };
  if (/\bbesok\b|\btomorrow\b/.test(q)) return { kind: 'date', date: isoDate(addDays(today, 1)), raw: rawQuery };
  if (/\bkemarin\b|\byesterday\b/.test(q)) return { kind: 'date', date: isoDate(addDays(today, -1)), raw: rawQuery };

  // 31 oktober / 31 okt / 31/10 / 31-10
  m = q.match(/\b(\d{1,2})\s*(?:[/-]\s*(\d{1,2})\b|([a-z]{3,})\b)/);
  if (m) {
    const day = Number(m[1]);
    let monthIndex = -1;
    if (m[2]) {
      monthIndex = Number(m[2]) - 1;
    } else if (m[3]) {
      monthIndex = MONTHS_ID.findIndex((name) => name.startsWith(m[3].slice(0, 3)));
    }
    if (monthIndex >= 0 && monthIndex < 12 && day >= 1 && day <= 31) {
      const year = pickYear(day, monthIndex, today);
      return { kind: 'date', date: `${year}-${pad(monthIndex + 1)}-${pad(day)}`, raw: rawQuery };
    }
  }

  // "tim a vs tim b"
  const vsSplit = q.split(/\s+(?:vs\.?|v|lawan|versus)\s+/);
  if (vsSplit.length === 2) {
    return { kind: 'pair', parts: vsSplit.map((s) => s.trim()).filter(Boolean), raw: rawQuery };
  }

  return { kind: 'text', text: q, raw: rawQuery };
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Tanggal kalender di Asia/Jakarta (UTC+7) untuk sebuah momen.
 * Dipakai agar "hari ini" tidak bergeser satu hari ketika CI berjalan di UTC.
 * Mengembalikan Date dalam UTC yang mewakili tengah malam Jakarta.
 */
export function jakartaToday(when = new Date()) {
  const shifted = new Date(when.getTime() + 7 * 3600 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function isoDate(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(d, n) {
  return new Date(d.getTime() + n * 86400000);
}

/** Pilih tahun yang paling masuk akal untuk tanggal tanpa tahun. */
function pickYear(day, monthIndex, today) {
  const y = today.getUTCFullYear();
  const candidate = Date.UTC(y, monthIndex, day);
  const diff = candidate - today.getTime();
  if (diff < -180 * 86400000) return y + 1;
  return y;
}

/** Indeks teks untuk setiap entitas yang bisa dicari. */
export function buildSearchIndex(teams, matches) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const entries = [];

  for (const t of teams) {
    entries.push({
      type: 'team',
      id: t.id,
      haystack: normalize([t.name, t.short, t.code, t.city, t.province, t.venue].join(' ')),
      tokens: [...new Set(normalize([t.name, t.short, t.code, t.city, t.province].join(' ')).split(' '))],
    });
  }

  for (const m of matches) {
    const home = teamById.get(m.home);
    const away = teamById.get(m.away);
    if (!home || !away) continue;
    entries.push({
      type: 'match',
      id: m.id,
      week: m.week,
      date: m.date,
      haystack: normalize(
        [home.name, home.short, home.code, away.name, away.short, away.code, m.venue, m.city, m.date, `pekan ${m.week}`].join(' ')
      ),
    });
  }

  return { entries };
}

/**
 * Jalankan pencarian. Mengembalikan { intent, teams, matches, week, note }.
 * Dipakai apa adanya oleh UI; tidak ada logika pencarian di tempat lain.
 */
export function search(index, teams, matches, query, ctx = {}) {
  const intent = parseQuery(query, ctx);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const byKickoff = (a, b) => dateKey(a.date) - dateKey(b.date) || a.time.localeCompare(b.time);

  if (intent.kind === 'empty') {
    return { intent, teams: [], matches: [], note: null };
  }

  if (intent.kind === 'week') {
    const hits = matches.filter((m) => m.week === intent.week).sort(byKickoff);
    return {
      intent,
      teams: [...new Set(hits.flatMap((m) => [m.home, m.away]))].map((id) => teamById.get(id)).filter(Boolean),
      matches: hits,
      note: hits.length ? `Pekan ${intent.week}` : `Pekan ${intent.week} belum ada di jadwal.`,
    };
  }

  if (intent.kind === 'date') {
    const hits = matches.filter((m) => m.date === intent.date).sort(byKickoff);
    return {
      intent,
      teams: [...new Set(hits.flatMap((m) => [m.home, m.away]))].map((id) => teamById.get(id)).filter(Boolean),
      matches: hits,
      note: hits.length ? formatDateId(intent.date) : `Tidak ada laga pada ${formatDateId(intent.date)}.`,
    };
  }

  if (intent.kind === 'pair') {
    const left = matchTeams(index, teams, intent.parts[0]);
    const right = matchTeams(index, teams, intent.parts[1]);
    if (left.length && right.length) {
      const a = left[0].id;
      const b = right[0].id;
      const hits = matches
        .filter((m) => (m.home === a && m.away === b) || (m.home === b && m.away === a))
        .sort(byKickoff);
      return {
        intent,
        teams: [teamById.get(a), teamById.get(b)],
        matches: hits,
        note: hits.length ? `${teamById.get(a).short} vs ${teamById.get(b).short}` : 'Kedua tim belum pernah bertemu.',
      };
    }
    // salah satu sisi tidak ketemu: jatuh ke pencarian teks
    intent.kind = 'text';
    intent.text = normalize(intent.parts.join(' '));
  }

  // pencarian teks bebas: tim dulu, lalu laga
  const teamHits = matchTeams(index, teams, intent.text);
  const teamIds = new Set(teamHits.map((t) => t.id));
  const matchHits = matches
    .filter((m) => teamIds.has(m.home) || teamIds.has(m.away))
    .sort(byKickoff);

  return {
    intent,
    teams: teamHits,
    matches: matchHits,
    note: teamHits.length
      ? `${teamHits.length} tim · ${matchHits.length} laga`
      : `Tidak ada hasil untuk "${query}".`,
  };
}

function matchTeams(index, teams, text) {
  const q = normalize(text);
  if (!q) return [];
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const scored = [];

  for (const entry of index.entries) {
    if (entry.type !== 'team') continue;
    const score = scoreEntry(entry, q);
    if (score > 0) scored.push({ score, team: teamById.get(entry.id) });
  }
  if (!scored.length) return [];

  // Peringkat berjenjang. Begitu ada kecocokan kuat, taksiran yang lebih lemah dibuang:
  // "bintang" (awalan) tidak boleh ikut menarik "bintan" (kota NZ Laksamana), dan
  // "bintan" (kota persis) tidak boleh dikotori tebakan salah ketik.
  const best = Math.max(...scored.map((s) => s.score));
  const tier = best >= 90 ? 90 : best >= 60 ? 60 : 30;
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score >= tier && s.team).map((s) => s.team);
}

function scoreEntry(entry, q) {
  if (entry.haystack === q) return 100;
  if (entry.tokens.includes(q)) return 90;
  if (entry.tokens.some((t) => t.startsWith(q))) return 80;
  if (entry.haystack.startsWith(q)) return 70;
  if (entry.haystack.includes(` ${q}`)) return 60;
  if (entry.haystack.includes(q)) return 40;
  // toleransi salah ketik ringan
  if (q.length >= 4 && entry.tokens.some((t) => editDistanceAtMostOne(t, q))) return 30;
  return 0;
}

function editDistanceAtMostOne(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
    return diff === 1;
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

/* --------------------------------------------------------------- validasi */

/**
 * Periksa integritas data sebelum dipublikasikan.
 * Mengembalikan array masalah; kosong berarti data layak tayang.
 */
export function validate(teams, matches) {
  const problems = [];
  const ids = new Set();
  const teamIds = new Set(teams.map((t) => t.id));
  const pairSeen = new Map();
  const byWeek = new Map();

  if (teams.length < 2) problems.push('Butuh minimal dua tim.');

  for (const m of matches) {
    if (ids.has(m.id)) problems.push(`ID laga ganda: ${m.id}`);
    ids.add(m.id);

    if (!teamIds.has(m.home)) problems.push(`${m.id}: tim kandang "${m.home}" tidak ada di teams.json`);
    if (!teamIds.has(m.away)) problems.push(`${m.id}: tim tandang "${m.away}" tidak ada di teams.json`);
    if (m.home === m.away) problems.push(`${m.id}: tim melawan dirinya sendiri`);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) problems.push(`${m.id}: tanggal tidak valid (${m.date})`);

    // round robin dua putaran: pasangan berurutan hanya boleh muncul sekali,
    // karena kandang-tandang adalah dua laga yang sah.
    const pair = `${m.home}|${m.away}`;
    if (pairSeen.has(pair)) problems.push(`${m.id}: pertemuan ganda dengan ${pairSeen.get(pair)} (${pair})`);
    pairSeen.set(pair, m.id);

    // PFL memainkan dua laga per tim per pekan (Sabtu dan Minggu), jadi batasnya dua.
    const weekKey = `${m.week}|${m.home}`;
    const weekKeyAway = `${m.week}|${m.away}`;
    byWeek.set(weekKey, (byWeek.get(weekKey) || 0) + 1);
    byWeek.set(weekKeyAway, (byWeek.get(weekKeyAway) || 0) + 1);

    if (isPlayed(m)) {
      if (m.homeScore > 60 || m.awayScore > 60) problems.push(`${m.id}: skor tidak wajar (${m.homeScore}-${m.awayScore})`);
      if (m.status !== 'finished') problems.push(`${m.id}: punya skor tetapi status bukan finished`);
    } else if (m.status === 'finished') {
      problems.push(`${m.id}: status finished tetapi skor belum lengkap`);
    }
  }

  // setiap tim harus punya jumlah laga yang sama, atau selisih paling banyak satu
  for (const [key, count] of byWeek) {
    if (count > 2) {
      const [week, teamId] = key.split('|');
      problems.push(`${teamId} bermain ${count} kali di pekan ${week} (maksimal 2)`);
    }
  }

  const counts = new Map(teams.map((t) => [t.id, 0]));
  for (const m of matches.filter(isPlayed)) {
    counts.set(m.home, (counts.get(m.home) || 0) + 1);
    counts.set(m.away, (counts.get(m.away) || 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min > 1) problems.push(`Jumlah laga antar tim tidak seimbang: ${min} sampai ${max}`);
  }

  return problems;
}
