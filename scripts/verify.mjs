#!/usr/bin/env node
/**
 * verify.mjs — pemeriksaan independen atas hasil build.
 *
 * Dijalankan sesudah build, di CI dan secara lokal. Tujuannya menangkap kelas
 * kesalahan yang lolos dari validate(): angka yang tidak konservasi, klasemen
 * yang tidak bisa direproduksi, dan pergeseran tak terduga dibanding pekan lalu.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStandings, isPlayed, validate, teamProfile, headToHeadFull } from '../assets/modules/engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

const checks = [];
const fail = (name, detail) => checks.push({ ok: false, name, detail });
const pass = (name, detail = '') => checks.push({ ok: true, name, detail });

async function main() {
  const teams = await readJson(path.join(ROOT, 'data/teams.json'));
  const matches = (await readJson(path.join(ROOT, 'data/matches.json'))).matches;
  const published = await readJson(path.join(ROOT, 'data/standings.json'));
  const dist = await readJson(path.join(ROOT, 'dist/data.json'));

  /* 1. integritas dasar */
  const problems = validate(teams, matches);
  problems.length ? fail('validasi data', problems.join('; ')) : pass('validasi data');

  /* 2. klasemen dapat direproduksi */
  const recomputed = computeStandings(teams, matches);
  const same = recomputed.every((row, i) => {
    const p = published.table[i];
    return (
      p &&
      p.teamId === row.teamId &&
      p.rank === row.rank &&
      p.played === row.played &&
      p.won === row.won &&
      p.drawn === row.drawn &&
      p.lost === row.lost &&
      p.goalsFor === row.goalsFor &&
      p.goalsAgainst === row.goalsAgainst &&
      p.goalDifference === row.goalDifference &&
      p.points === row.points
    );
  }) && recomputed.length === published.table.length;
  same
    ? pass('klasemen dapat direproduksi dari hasil')
    : fail('klasemen dapat direproduksi dari hasil', 'standings.json tidak cocok dengan hitungan ulang');

  /* 3. konservasi gol: total memasukkan == total kemasukan */
  const gf = published.table.reduce((n, r) => n + r.goalsFor, 0);
  const ga = published.table.reduce((n, r) => n + r.goalsAgainst, 0);
  gf === ga ? pass('konservasi gol', `${gf} = ${ga}`) : fail('konservasi gol', `${gf} ≠ ${ga}`);

  /* 4. konservasi poin dan laga */
  const played = matches.filter(isPlayed);
  const totalPlayed = published.table.reduce((n, r) => n + r.played, 0);
  totalPlayed === played.length * 2
    ? pass('konservasi laga', `${totalPlayed} = 2 × ${played.length}`)
    : fail('konservasi laga', `${totalPlayed} ≠ 2 × ${played.length}`);

  /* 5. setiap baris: M = W + D + L, dan poin = 3W + D */
  for (const r of published.table) {
    if (r.played !== r.won + r.drawn + r.lost) {
      fail('aritmetika baris', `${r.name}: M ${r.played} ≠ ${r.won}+${r.drawn}+${r.lost}`);
    }
    if (r.points !== r.won * 3 + r.drawn) {
      fail('aritmetika baris', `${r.name}: poin ${r.points} ≠ 3×${r.won}+${r.drawn}`);
    }
    if (r.goalDifference !== r.goalsFor - r.goalsAgainst) {
      fail('aritmetika baris', `${r.name}: SG tidak konsisten`);
    }
  }
  if (!checks.some((c) => c.name === 'aritmetika baris')) pass('aritmetika baris');

  /* 6. urutan klasemen sah menurut tiebreak */
  for (let i = 1; i < published.table.length; i++) {
    const a = published.table[i - 1];
    const b = published.table[i];
    if (a.points < b.points) fail('urutan klasemen', `${a.name} di atas ${b.name} dengan poin lebih sedikit`);
    if (a.points === b.points && a.goalDifference < b.goalDifference) {
      fail('urutan klasemen', `${a.name} di atas ${b.name} dengan selisih gol lebih buruk`);
    }
  }
  if (!checks.some((c) => c.name === 'urutan klasemen')) pass('urutan klasemen');

  /* 7. bundle browser memuat angka yang sama */
  const distRow = dist.standings?.[0];
  const pubRow = published.table[0];
  distRow && pubRow && distRow.teamId === pubRow.teamId && distRow.points === pubRow.points
    ? pass('dist/data.json sinkron')
    : fail('dist/data.json sinkron', 'pemuncak berbeda antara dist dan data/standings.json');

  /* 8. tidak ada laga ganda pada pasangan kandang-tandang yang sama */
  const seen = new Set();
  for (const m of matches) {
    const key = `${m.home}|${m.away}`;
    if (seen.has(key)) fail('pasangan kandang-tandang', `${key} muncul lebih dari sekali`);
    seen.add(key);
  }
  if (!checks.some((c) => c.name === 'pasangan kandang-tandang')) pass('pasangan kandang-tandang');

  /* 9. halaman detail tim tidak boleh memuat angka yang bertentangan */
  const profileProblems = [];
  for (const team of teams) {
    const p = teamProfile(teams, matches, team.id);
    if (!p) {
      profileProblems.push(`${team.id}: profil kosong`);
      continue;
    }
    const row = recomputed.find((r) => r.teamId === team.id);
    if (p.record.played !== row.played) profileProblems.push(`${team.id}: main ${p.record.played} ≠ ${row.played}`);
    if (p.record.goalsFor !== row.goalsFor) profileProblems.push(`${team.id}: gol ${p.record.goalsFor} ≠ ${row.goalsFor}`);
    if (p.row.rank !== row.rank) profileProblems.push(`${team.id}: peringkat ${p.row.rank} ≠ ${row.rank}`);

    const opponentPlayed = p.opponents.reduce((n, o) => n + o.played, 0);
    if (opponentPlayed !== p.record.played) {
      profileProblems.push(`${team.id}: rekap lawan ${opponentPlayed} ≠ ${p.record.played}`);
    }
  }
  profileProblems.length
    ? fail('profil tim sejalan dengan klasemen', profileProblems.slice(0, 3).join('; '))
    : pass('profil tim sejalan dengan klasemen');

  /* 10. setiap tim punya lawan untuk panel head-to-head */
  const h2hProblems = [];
  for (const team of teams) {
    const others = teams.filter((t) => t.id !== team.id);
    const withMeetings = others.filter((o) => {
      const h = headToHeadFull(teams, matches, team.id, o.id);
      return h && h.matches.length > 0;
    });
    if (!withMeetings.length) h2hProblems.push(`${team.id}: tidak punya lawan dengan pertemuan`);
  }
  h2hProblems.length
    ? fail('head-to-head tersedia untuk semua tim', h2hProblems.join('; '))
    : pass('head-to-head tersedia untuk semua tim');

  /* laporan */
  const width = Math.max(...checks.map((c) => c.name.length));
  console.log('');
  for (const c of checks) {
    console.log(`  ${c.ok ? 'lulus' : 'GAGAL'}  ${c.name.padEnd(width)}  ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n  ${checks.length - failed.length}/${checks.length} pemeriksaan lulus\n`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
