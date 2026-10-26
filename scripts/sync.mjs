#!/usr/bin/env node
/**
 * sync.mjs — mengambil hasil terbaru dari sumber, lalu menggabungkannya
 * ke data/matches.json.
 *
 * Prinsip yang dijaga:
 *   1. Sumber hanya boleh MENAMBAH hasil, tidak boleh menghapus laga yang sudah
 *      ada di jadwal kita.
 *   2. Skor yang sudah tercatat tidak ditimpa tanpa --force. Kalau sumber dan
 *      data berbeda, itu dilaporkan sebagai konflik untuk diperiksa manusia.
 *   3. Laga baru yang belum ada di jadwal kita ditambahkan hanya bila semua
 *      timnya dikenali. Kalau tidak, dilaporkan dan dilewati.
 *   4. Tidak ada yang ditulis bila hasilnya tidak lolos validasi.
 *
 *   node scripts/sync.mjs             periksa dan terapkan perubahan
 *   node scripts/sync.mjs --dry-run   laporkan saja
 *   node scripts/sync.mjs --force     timpa skor yang berbeda
 *   node scripts/sync.mjs --offline FILE  pakai HTML tersimpan, bukan jaringan
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSource, parseSchedule, resolveTeamId } from './sources/skor.mjs';
import { validate, isPlayed } from '../assets/modules/engine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const SOURCE_URL =
  'https://skor.id/posts/785481/pro-futsal-league-2026-2027-jadwal-hasil-dan-klasemen-lengkap';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const offlineIndex = args.indexOf('--offline');
const offlineFile = offlineIndex >= 0 ? args[offlineIndex + 1] : null;

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

function log(kind, message) {
  const tag = { added: 'BARU ', updated: 'UBAH ', same: 'sama ', conflict: 'KONFLIK', skipped: 'lewati', info: 'info ' }[kind] || '     ';
  console.log(`  ${tag} ${message}`);
}

async function main() {
  const teams = await readJson(path.join(DATA, 'teams.json'));
  const matchDoc = await readJson(path.join(DATA, 'matches.json'));
  const matches = matchDoc.matches;

  console.log(`\n  Sumber: ${offlineFile ? offlineFile : SOURCE_URL}\n`);

  let html;
  if (offlineFile) {
    html = await fs.readFile(offlineFile, 'utf8');
  } else {
    try {
      html = await fetchSource(SOURCE_URL);
    } catch (err) {
      console.error(`  GAGAL mengambil sumber: ${err.message}`);
      console.error('  Data tidak diubah. Coba lagi nanti, atau pakai --offline <berkas>.\n');
      process.exit(1);
    }
  }

  const weeks = parseSchedule(html);
  if (!weeks.length) {
    console.error('  GAGAL: tidak ada laga yang terbaca dari sumber.');
    console.error('  Halaman mungkin berubah struktur. Data tidak diubah.\n');
    process.exit(1);
  }

  const byPair = new Map();
  for (const m of matches) byPair.set(`${m.home}|${m.away}`, m);

  const added = [];
  const updated = [];
  const conflicts = [];
  const skipped = [];

  for (const week of weeks) {
    for (const parsed of week.matches) {
      const home = resolveTeamId(parsed.homeName, teams);
      const away = resolveTeamId(parsed.awayName, teams);

      if (!home || !away) {
        skipped.push(`pekan ${week.week}: ${parsed.homeName} vs ${parsed.awayName} — tim tidak dikenali`);
        continue;
      }

      const key = `${home}|${away}`;
      const existing = byPair.get(key);

      if (!existing) {
        // laga baru: hanya ditambahkan kalau sumber sudah punya skornya
        if (!parsed.played) {
          skipped.push(`pekan ${week.week}: ${parsed.homeName} vs ${parsed.awayName} — belum ada di jadwal dan belum ada skor`);
          continue;
        }
        const match = {
          id: `S${String(week.week).padStart(2, '0')}-${home.slice(0, 3).toUpperCase()}${away.slice(0, 3).toUpperCase()}`,
          week: week.week,
          date: parsed.date,
          time: parsed.time,
          home,
          away,
          homeScore: parsed.homeScore,
          awayScore: parsed.awayScore,
          venue: week.venue || existing?.venue || '',
          city: week.city || existing?.city || '',
          status: 'finished',
        };
        matches.push(match);
        byPair.set(key, match);
        added.push(match);
        continue;
      }

      // laga sudah ada
      if (!parsed.played) continue; // sumber belum punya hasil

      if (!isPlayed(existing)) {
        existing.homeScore = parsed.homeScore;
        existing.awayScore = parsed.awayScore;
        existing.status = 'finished';
        if (parsed.date) existing.date = parsed.date;
        if (parsed.time) existing.time = parsed.time;
        updated.push({ match: existing, from: 'belum dimainkan' });
        continue;
      }

      // sudah ada skor: bandingkan
      if (existing.homeScore === parsed.homeScore && existing.awayScore === parsed.awayScore) {
        continue;
      }

      if (force) {
        const from = `${existing.homeScore}-${existing.awayScore}`;
        existing.homeScore = parsed.homeScore;
        existing.awayScore = parsed.awayScore;
        updated.push({ match: existing, from });
      } else {
        conflicts.push(
          `${existing.id} ${parsed.homeName} vs ${parsed.awayName}: data ${existing.homeScore}-${existing.awayScore}, sumber ${parsed.homeScore}-${parsed.awayScore}`
        );
      }
    }
  }

  /* ------------------------------------------------------------ laporan */
  for (const m of added) log('added', `${m.id} ${m.date} ${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`);
  for (const u of updated) log('updated', `${u.match.id} ${u.match.home} ${u.from} → ${u.match.homeScore}-${u.match.awayScore} ${u.match.away}`);
  for (const c of conflicts) log('conflict', c);
  for (const s of skipped) log('skipped', s);

  if (!added.length && !updated.length && !conflicts.length) {
    log('same', 'tidak ada perubahan');
  }

  if (conflicts.length && !force) {
    console.log('\n  Skor di atas berbeda dari sumber dan TIDAK ditimpa.');
    console.log('  Periksa manual, lalu jalankan dengan --force bila sumber yang benar.\n');
  }

  if (dryRun) {
    console.log(`\n  --dry-run: tidak ada yang ditulis. ${added.length} baru, ${updated.length} diubah, ${conflicts.length} konflik.\n`);
    return;
  }

  if (!added.length && !updated.length) {
    console.log('\n  Data tidak berubah.\n');
    return;
  }

  /* ------------------------------------------------------------ validasi */
  const problems = validate(teams, matches);
  if (problems.length) {
    console.error(`\n  DITOLAK: hasil penggabungan tidak lolos validasi (${problems.length} masalah).`);
    for (const p of problems) console.error(`   - ${p}`);
    console.error('\n  Data tidak ditulis. Periksa sumber atau jalankan --dry-run.\n');
    process.exit(1);
  }

  matches.sort((a, b) => a.week - b.week || a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  await fs.writeFile(
    path.join(DATA, 'matches.json'),
    `${JSON.stringify({ ...matchDoc, matches }, null, 2)}\n`,
    'utf8'
  );

  console.log(`\n  Ditulis: ${added.length} laga baru, ${updated.length} diperbarui.`);
  console.log('  Jalankan `npm run build` untuk membangun ulang klasemen.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
