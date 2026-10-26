#!/usr/bin/env node
/**
 * build.mjs — validasi data, hitung klasemen, tulis berkas turunan.
 *
 * Dijalankan oleh: `npm run build`, dan oleh .github/workflows/daily.yml setiap hari.
 * Keluar dengan kode 1 kalau data tidak konsisten, sehingga GitHub Actions gagal
 * dan tidak pernah memublikasikan klasemen yang salah.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeStandings,
  leagueSummary,
  validate,
  weekRecap,
  headToHead,
  isPlayed,
} from '../assets/modules/engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

async function main() {
  const league = await readJson(path.join(DATA, 'league.json'));
  const teams = await readJson(path.join(DATA, 'teams.json'));
  const matchDoc = await readJson(path.join(DATA, 'matches.json'));
  const matches = matchDoc.matches;

  /* ---------------------------------------------------------- validasi */
  const problems = validate(teams, matches);
  if (problems.length) {
    console.error(`\n  Data ditolak — ${problems.length} masalah:\n`);
    for (const p of problems) console.error(`   • ${p}`);
    console.error('\n  Perbaiki data/matches.json lalu jalankan ulang.\n');
    process.exit(1);
  }

  /* ----------------------------------------------------------- hitungan */
  const standings = computeStandings(teams, matches);
  const summary = leagueSummary(standings, matches);

  const weeks = [...new Set(matches.map((m) => m.week))].sort((a, b) => a - b);
  const recaps = weeks.map((w) => {
    const r = weekRecap(teams, matches, w);
    return {
      week: w,
      complete: r.complete,
      played: r.matches.filter(isPlayed).length,
      matches: r.matches,
    };
  });

  const h2h = {};
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const rec = headToHead(teams, matches, teams[i].id, teams[j].id);
      if (rec.matches.length) h2h[`${teams[i].id}|${teams[j].id}`] = {
        matches: rec.matches.map((m) => m.id),
        aWins: rec.aWins,
        bWins: rec.bWins,
        draws: rec.draws,
        aGoals: rec.aGoals,
        bGoals: rec.bGoals,
      };
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    league,
    teams,
    matches,
    standings,
    summary,
    weeks: recaps,
    headToHead: h2h,
  };

  /* ------------------------------------------------------------- tulis */
  await fs.mkdir(DIST, { recursive: true });
  await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });

  // untuk dibaca manusia dan untuk API publik
  await write(path.join(DATA, 'standings.json'), {
    generatedAt: payload.generatedAt,
    season: league.season,
    points: league.points,
    table: standings.map((r) => ({
      rank: r.rank,
      teamId: r.teamId,
      name: r.name,
      code: r.code,
      played: r.played,
      won: r.won,
      drawn: r.drawn,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalDifference: r.goalDifference,
      points: r.points,
      form: r.form,
    })),
    summary,
  });

  // bundel tunggal untuk browser
  await write(path.join(DIST, 'data.json'), payload);

  /* ------------------------------------------------------------ laporan */
  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n = 2) => String(v).padStart(n);
  console.log(`\n  ${league.name} ${league.season}`);
  console.log(`  ${summary.matchesPlayed}/${summary.matchesTotal} laga · ${summary.goals} gol · ${summary.goalsPerMatch} per laga\n`);
  console.log(`  ${pad('#', 3)} ${pad('Tim', 24)} ${pad('M', 3)}${pad('W', 3)}${pad('D', 3)}${pad('L', 3)}${pad('GF', 4)}${pad('GA', 4)}${pad('GD', 4)}${pad('PTS', 4)}`);
  for (const r of standings) {
    const gd = r.goalDifference > 0 ? `+${r.goalDifference}` : String(r.goalDifference);
    console.log(
      `  ${pad(r.rank, 3)} ${pad(r.short, 24)} ${num(r.played, 3)}${num(r.won, 3)}${num(r.drawn, 3)}${num(r.lost, 3)}${num(r.goalsFor, 4)}${num(r.goalsAgainst, 4)}${num(gd, 4)}${num(r.points, 4)}`
    );
  }
  console.log(`\n  ditulis: data/standings.json, dist/data.json\n`);
}

async function write(file, obj) {
  await fs.writeFile(file, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
