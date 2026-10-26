#!/usr/bin/env node
/**
 * freshness.mjs — pengawas kesegaran data.
 *
 * Tugasnya menangkap satu kegagalan yang mudah terjadi: sumber berhenti
 * diperbarui, situs tetap tampak normal, dan angkanya diam-diam basi.
 * Di CI skrip ini memberi peringatan; hanya gagal bila data sangat tua.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WARN_HOURS = 36;
const FAIL_HOURS = 24 * 7;

const hours = (ms) => Math.floor(ms / 3_600_000);

async function main() {
  const standings = JSON.parse(await fs.readFile(path.join(ROOT, 'data/standings.json'), 'utf8'));
  const matches = JSON.parse(await fs.readFile(path.join(ROOT, 'data/matches.json'), 'utf8')).matches;

  const built = new Date(standings.generatedAt);
  const age = hours(Date.now() - built.getTime());

  // laga terakhir yang tercatat selesai
  const finished = matches
    .filter((m) => m.status === 'finished' && Number.isInteger(m.homeScore))
    .map((m) => m.date)
    .sort()
    .pop();

  const daysSinceMatch = finished
    ? Math.floor((Date.now() - new Date(`${finished}T00:00:00+07:00`).getTime()) / 86_400_000)
    : null;

  console.log('');
  console.log(`  build terakhir     ${built.toISOString()} (${age} jam lalu)`);
  console.log(`  laga terakhir      ${finished ?? '—'}${daysSinceMatch != null ? ` (${daysSinceMatch} hari lalu)` : ''}`);
  console.log(`  laga tercatat      ${matches.filter((m) => m.status === 'finished').length} selesai / ${matches.length} total`);

  let status = 0;

  if (age > WARN_HOURS) {
    console.log(`\n  PERINGATAN: build lebih tua dari ${WARN_HOURS} jam.`);
    console.log('  Jadwal harian mungkin tidak berjalan. Periksa tab Actions.');
  }

  if (age > FAIL_HOURS) {
    console.log(`\n  GAGAL: build lebih tua dari ${FAIL_HOURS / 24} hari.`);
    status = 1;
  }

  if (age <= WARN_HOURS) console.log('\n  Data masih segar.\n');
  else console.log('');

  process.exit(status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
