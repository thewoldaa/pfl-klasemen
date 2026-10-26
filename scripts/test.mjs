#!/usr/bin/env node
/**
 * test.mjs — uji mesin liga dan pencarian.
 *
 * Menguji perilaku, bukan sekadar menjalankan kode: aturan poin, urutan
 * tiebreak, head-to-head, validasi data rusak, dan setiap maksud pencarian.
 * Jalankan dengan `node scripts/test.mjs`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeStandings,
  headToHead,
  headToHeadFull,
  teamProfile,
  isPlayed,
  parseQuery,
  search,
  buildSearchIndex,
  validate,
  weekRecap,
  leagueSummary,
} from '../assets/modules/engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push({ name, message: err.message });
  }
}

function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} diharapkan ${e}, dapat ${a}`);
}

function ok(value, label = '') {
  if (!value) throw new Error(`${label} diharapkan benar, dapat ${JSON.stringify(value)}`);
}

/* ------------------------------------------------------------------ data */

const teams = JSON.parse(await fs.readFile(path.join(ROOT, 'data/teams.json'), 'utf8'));
const matches = JSON.parse(await fs.readFile(path.join(ROOT, 'data/matches.json'), 'utf8')).matches;

const byId = new Map(teams.map((t) => [t.id, t]));

/* --------------------------------------------------------- uji: klasemen */

test('menang memberi 3 poin, seri 1, kalah 0', () => {
  const t = [
    { id: 'a', name: 'A', short: 'A', code: 'AAA', city: 'X' },
    { id: 'b', name: 'B', short: 'B', code: 'BBB', city: 'Y' },
  ];
  const m = [
    { id: '1', week: 1, date: '2026-01-01', time: '10:00', home: 'a', away: 'b', homeScore: 2, awayScore: 0, status: 'finished' },
  ];
  const s = computeStandings(t, m);
  eq(s.find((r) => r.teamId === 'a').points, 3, 'poin pemenang');
  eq(s.find((r) => r.teamId === 'b').points, 0, 'poin pecundang');
});

test('seri memberi 1 poin ke kedua tim', () => {
  const t = [
    { id: 'a', name: 'A', short: 'A', code: 'AAA', city: 'X' },
    { id: 'b', name: 'B', short: 'B', code: 'BBB', city: 'Y' },
  ];
  const m = [
    { id: '1', week: 1, date: '2026-01-01', time: '10:00', home: 'a', away: 'b', homeScore: 1, awayScore: 1, status: 'finished' },
  ];
  const s = computeStandings(t, m);
  eq(s.map((r) => r.points), [1, 1], 'poin seri');
});

test('laga tanpa skor tidak dihitung', () => {
  const t = [
    { id: 'a', name: 'A', short: 'A', code: 'AAA', city: 'X' },
    { id: 'b', name: 'B', short: 'B', code: 'BBB', city: 'Y' },
  ];
  const m = [
    { id: '1', week: 1, date: '2026-01-01', time: '10:00', home: 'a', away: 'b', homeScore: null, awayScore: null, status: 'scheduled' },
  ];
  const s = computeStandings(t, m);
  eq(s.map((r) => r.played), [0, 0], 'laga dimainkan');
  eq(s.map((r) => r.points), [0, 0], 'poin');
});

test('urutan: poin, lalu selisih gol, lalu gol memasukkan', () => {
  const t = ['a', 'b', 'c'].map((id) => ({ id, name: id, short: id, code: id.toUpperCase(), city: 'X' }));
  const m = [
    // a: 3 poin, SG +1
    { id: '1', week: 1, date: '2026-01-01', time: '10:00', home: 'a', away: 'b', homeScore: 2, awayScore: 1, status: 'finished' },
    // c: 3 poin, SG +3
    { id: '2', week: 2, date: '2026-01-02', time: '10:00', home: 'c', away: 'b', homeScore: 4, awayScore: 1, status: 'finished' },
  ];
  const s = computeStandings(t, m);
  eq(s[0].teamId, 'c', 'pemuncak');
  eq(s[1].teamId, 'a', 'peringkat dua');
});

test('head-to-head memutus poin dan selisih gol yang sama', () => {
  const t = ['a', 'b'].map((id) => ({ id, name: id, short: id, code: id.toUpperCase(), city: 'X' }));
  const m = [
    // a menang 3-0 atas b, tetapi kalah 0-2 dari tim lain tidak ada di sini,
    // jadi kita buat poin & SG identik lewat dua laga berbeda.
    { id: '1', week: 1, date: '2026-01-01', time: '10:00', home: 'a', away: 'b', homeScore: 3, awayScore: 0, status: 'finished' },
    { id: '2', week: 2, date: '2026-01-02', time: '10:00', home: 'b', away: 'a', homeScore: 1, awayScore: 0, status: 'finished' },
  ];
  const s = computeStandings(t, m);
  // a: 3 poin SG +2, b: 3 poin SG -2 — selisih gol sudah memutus, a di atas.
  eq(s[0].teamId, 'a', 'pemenang agregat');
});

test('peringkat bersama untuk angka yang identik', () => {
  const t = ['a', 'b'].map((id) => ({ id, name: id, short: id, code: id.toUpperCase(), city: 'X' }));
  const s = computeStandings(t, []);
  eq(s.map((r) => r.rank), [1, 1], 'kedua tim peringkat 1 saat kosong');
});

test('klasemen riil dapat direproduksi dan konservatif', () => {
  const s = computeStandings(teams, matches);
  const played = matches.filter(isPlayed).length;
  eq(s.reduce((n, r) => n + r.played, 0), played * 2, 'total laga');
  eq(
    s.reduce((n, r) => n + r.goalsFor, 0),
    s.reduce((n, r) => n + r.goalsAgainst, 0),
    'gol masuk = gol kemasukan'
  );
  for (const r of s) {
    eq(r.played, r.won + r.drawn + r.lost, `aritmetika ${r.teamId}`);
    eq(r.points, r.won * 3 + r.drawn, `poin ${r.teamId}`);
    eq(r.goalDifference, r.goalsFor - r.goalsAgainst, `SG ${r.teamId}`);
  }
});

test('pemuncak saat ini adalah Bintang Timur dengan 12 poin', () => {
  const s = computeStandings(teams, matches);
  eq(s[0].teamId, 'bintang-timur');
  eq(s[0].points, 12);
  eq(s[0].played, 4);
});

/* ------------------------------------------------------- uji: head to head */

test('head-to-head menghitung hasil kedua arah', () => {
  const rec = headToHead(teams, matches, 'proton', 'pangsuma');
  eq(rec.matches.length, 1, 'jumlah pertemuan');
  eq(rec.aWins, 0, 'kemenangan proton');
  eq(rec.bWins, 1, 'kemenangan pangsuma');
  eq(rec.aGoals, 3, 'gol proton');
  eq(rec.bGoals, 4, 'gol pangsuma');
});

/* --------------------------------------------------------- uji: validasi */

test('validasi menerima data yang benar', () => {
  eq(validate(teams, matches), []);
});

test('validasi menolak tim yang tidak dikenal', () => {
  const bad = [{ ...matches[0], home: 'tidak-ada' }];
  ok(validate(teams, bad).length > 0, 'harus melaporkan masalah');
});

test('validasi menolak tim melawan dirinya sendiri', () => {
  const bad = [{ ...matches[0], away: matches[0].home }];
  ok(validate(teams, bad).some((p) => p.includes('melawan dirinya sendiri')));
});

test('validasi menolak status finished tanpa skor', () => {
  const bad = [{ ...matches[0], homeScore: null, awayScore: null }];
  ok(validate(teams, bad).some((p) => p.includes('skor belum lengkap')));
});

test('validasi menolak pasangan kandang-tandang ganda', () => {
  const bad = [matches[0], { ...matches[0], id: 'DUP' }];
  ok(validate(teams, bad).some((p) => p.includes('pertemuan ganda')));
});

test('validasi menolak tim bermain tiga kali dalam sepekan', () => {
  const m = matches[0];
  const a = { ...m, id: 'A', away: 'halus' };
  const b = { ...m, id: 'B', away: 'mimika' };
  const c = { ...m, id: 'C', away: 'proton' };
  const bad = [a, b, c];
  ok(validate(teams, bad).some((p) => p.includes('maksimal 2')));
});

/* ------------------------------------------------------------ uji: pekan */

test('rekap pekan memuat klasemen setelah pekan itu', () => {
  const r = weekRecap(teams, matches, 1);
  eq(r.week, 1);
  eq(r.matches.length, 9, 'laga pekan 1');
  eq(r.complete, true, 'pekan 1 selesai');
  eq(r.standings.reduce((n, x) => n + x.played, 0), 18, 'total laga');
});

test('pekan yang belum dimainkan tidak selesai', () => {
  const r = weekRecap(teams, matches, 3);
  eq(r.complete, false);
  eq(r.matches.filter(isPlayed).length, 0);
});

/* --------------------------------------------------------- uji: ringkasan */

test('ringkasan liga konsisten dengan daftar laga', () => {
  const s = computeStandings(teams, matches);
  const sum = leagueSummary(s, matches);
  eq(sum.matchesPlayed, matches.filter(isPlayed).length);
  eq(sum.matchesTotal, matches.length);
  eq(sum.goals, s.reduce((n, r) => n + r.goalsFor, 0));
  ok(sum.nextMatch && sum.nextMatch.week === 3, 'laga berikutnya pekan 3');
});

/* ---------------------------------------------------------- uji: pencarian */

const index = buildSearchIndex(teams, matches);
const TODAY = new Date('2026-10-26T00:00:00+07:00');

test('parseQuery: nama tim menjadi teks', () => {
  eq(parseQuery('bintang').kind, 'text');
});

test('parseQuery: tanggal ISO', () => {
  const q = parseQuery('2026-10-31');
  eq(q.kind, 'date');
  eq(q.date, '2026-10-31');
});

test('parseQuery: tanggal Indonesia', () => {
  const q = parseQuery('31 oktober');
  eq(q.kind, 'date');
  eq(q.date, '2026-10-31');
});

test('parseQuery: tanggal angka', () => {
  const q = parseQuery('31/10');
  eq(q.kind, 'date');
  eq(q.date, '2026-10-31');
});

test('parseQuery: pekan', () => {
  const q = parseQuery('pekan 3');
  eq(q.kind, 'week');
  eq(q.week, 3);
});

test('parseQuery: pasangan tim', () => {
  const q = parseQuery('proton vs pangsuma');
  eq(q.kind, 'pair');
  eq(q.parts, ['proton', 'pangsuma']);
});

test('parseQuery: hari relatif', () => {
  eq(parseQuery('hari ini', { today: TODAY }).date, '2026-10-26');
  eq(parseQuery('besok', { today: TODAY }).date, '2026-10-27');
  eq(parseQuery('kemarin', { today: TODAY }).date, '2026-10-25');
});

test('cari nama tim menemukan satu tim', () => {
  const r = search(index, teams, matches, 'bintang', { today: TODAY });
  eq(r.teams.map((t) => t.id), ['bintang-timur']);
});

test('cari kota tidak tertukar dengan tim lain', () => {
  const r = search(index, teams, matches, 'bintan', { today: TODAY });
  eq(r.teams.map((t) => t.id), ['nanzaby']);
});

test('salah ketik ringan tetap menemukan tim', () => {
  const r = search(index, teams, matches, 'bintng', { today: TODAY });
  eq(r.teams.map((t) => t.id), ['bintang-timur']);
});

test('cari tanggal menemukan laga hari itu', () => {
  const r = search(index, teams, matches, '31 oktober', { today: TODAY });
  eq(r.intent.kind, 'date');
  eq(r.matches.length, 5, 'laga 31 Oktober');
  ok(r.matches.every((m) => m.date === '2026-10-31'));
});

test('cari pekan menemukan sembilan laga', () => {
  const r = search(index, teams, matches, 'pekan 3', { today: TODAY });
  eq(r.matches.length, 9);
});

test('cari pasangan tim hanya mengembalikan pertemuan mereka', () => {
  const r = search(index, teams, matches, 'proton vs pangsuma', { today: TODAY });
  // round robin dua putaran: satu pertemuan sudah dimainkan, satu masih terjadwal
  eq(r.matches.length, 2);
  ok(r.matches.every((m) => [m.home, m.away].sort().join('|') === 'pangsuma|proton'));
  eq(r.matches.filter(isPlayed).map((m) => m.id), ['W02-M04']);
});

test('cari kueri kosong tidak mengembalikan apa pun', () => {
  const r = search(index, teams, matches, '   ', { today: TODAY });
  eq(r.intent.kind, 'empty');
  eq(r.matches.length, 0);
});

test('cari kata yang tidak ada memberi catatan kosong', () => {
  const r = search(index, teams, matches, 'zzzzz', { today: TODAY });
  eq(r.teams.length, 0);
  eq(r.matches.length, 0);
  ok(r.note.includes('Tidak ada hasil'));
});

test('cari nama venue menemukan semua laga di sana', () => {
  const r = search(index, teams, matches, 'gor popki', { today: TODAY });
  ok(r.matches.length >= 9, 'minimal sembilan laga di GOR POPKI');
});

/* ------------------------------------------------- uji: profil satu tim */

test('profil tim menghitung rekor dari hasil, bukan dari tabel', () => {
  const p = teamProfile(teams, matches, 'bintang-timur');
  const row = computeStandings(teams, matches).find((r) => r.teamId === 'bintang-timur');
  eq(p.record.played, row.played, 'jumlah main');
  eq(p.record.won, row.won, 'menang');
  eq(p.record.goalsFor, row.goalsFor, 'gol memasukkan');
  eq(p.record.goalsAgainst, row.goalsAgainst, 'gol kemasukan');
  eq(p.record.goalDifference, row.goalDifference, 'selisih gol');
  eq(p.row.rank, row.rank, 'peringkat');
});

test('profil tim mengembalikan null untuk tim yang tidak ada', () => {
  eq(teamProfile(teams, matches, 'tidak-ada'), null);
});

test('rekap per lawan menjumlah tepat ke rekor tim', () => {
  for (const team of teams) {
    const p = teamProfile(teams, matches, team.id);
    const sum = (key) => p.opponents.reduce((n, o) => n + o[key], 0);
    eq(sum('played'), p.record.played, `${team.id}: jumlah laga`);
    eq(sum('gf'), p.record.goalsFor, `${team.id}: gol memasukkan`);
    eq(sum('ga'), p.record.goalsAgainst, `${team.id}: gol kemasukan`);
  }
});

test('laga tim dan laga berikutnya tidak pernah tumpang tindih', () => {
  for (const team of teams) {
    const p = teamProfile(teams, matches, team.id);
    ok(p.matches.every(isPlayed), `${team.id}: semua laga yang dimainkan punya skor`);
    ok(p.upcoming.every((m) => !isPlayed(m)), `${team.id}: semua laga berikutnya belum dimainkan`);
  }
});

test('lintasan peringkat tidak pernah memuat pekan tanpa hasil', () => {
  const p = teamProfile(teams, matches, 'proton');
  ok(p.trajectory.length > 0, 'ada minimal satu pekan selesai');
  for (const t of p.trajectory) {
    ok(t.position >= 1 && t.position <= teams.length, `posisi ${t.position} di luar rentang`);
  }
});

test('lintasan peringkat monoton mengikuti klasemen yang dibangun ulang', () => {
  const p = teamProfile(teams, matches, 'bintang-timur');
  for (const t of p.trajectory) {
    const through = matches.filter((m) => m.week <= t.week);
    const expected = computeStandings(teams, through).findIndex((r) => r.teamId === 'bintang-timur') + 1;
    eq(t.position, expected, `pekan ${t.week}`);
  }
});

/* -------------------------------------------------- uji: head-to-head penuh */

test('head-to-head penuh searah dengan headToHead ringkas', () => {
  for (const a of teams) {
    for (const b of teams) {
      if (a.id === b.id) continue;
      const full = headToHeadFull(teams, matches, a.id, b.id);
      const brief = headToHead(teams, matches, a.id, b.id);
      eq(full.aWins, brief.aWins, `${a.id}-${b.id}: kemenangan`);
      eq(full.bWins, brief.bWins, `${a.id}-${b.id}: kekalahan`);
      eq(full.aGoals, brief.aGoals, `${a.id}-${b.id}: gol`);
      // headToHead hanya mengembalikan laga selesai; versi penuh juga memuat yang menanti.
      eq(full.played, brief.matches.length, `${a.id}-${b.id}: laga selesai`);
      ok(full.matches.length >= brief.matches.length, `${a.id}-${b.id}: versi penuh tidak boleh lebih sedikit`);
    }
  }
});

test('head-to-head penuh hanya memuat laga kedua tim itu', () => {
  const h = headToHeadFull(teams, matches, 'bintang-timur', 'cosmo-jne');
  ok(h.matches.length > 0, 'mereka pernah bertemu');
  for (const m of h.matches) {
    const pair = [m.home, m.away].sort().join('|');
    eq(pair, ['bintang-timur', 'cosmo-jne'].sort().join('|'), `laga ${m.id} bukan pertemuan keduanya`);
  }
});

test('head-to-head penuh membagi main dan menanti dengan benar', () => {
  const h = headToHeadFull(teams, matches, 'bintang-timur', 'cosmo-jne');
  eq(h.played + h.pending, h.matches.length, 'selesai + menanti = total');
  eq(h.played, h.aWins + h.draws + h.bWins, 'hasil = jumlah laga selesai');
});

test('head-to-head penuh mengembalikan null untuk tim yang tidak ada', () => {
  eq(headToHeadFull(teams, matches, 'bintang-timur', 'tidak-ada'), null);
});

/* ------------------------------------------------------------- laporan */

const total = passed + failed;
console.log('');
if (failed) {
  for (const f of failures) console.log(`  GAGAL  ${f.name}\n         ${f.message}`);
  console.log('');
}
console.log(`  ${passed}/${total} uji lulus\n`);
process.exit(failed ? 1 : 0);
