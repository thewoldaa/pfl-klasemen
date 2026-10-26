/**
 * sources/skor.mjs — adapter untuk halaman rekap Skor.id.
 *
 * Halaman itu memuat satu artikel yang diperbarui operator sepanjang musim:
 * klasemen, lalu blok per pekan dengan tanggal dan hasil. Strukturnya:
 *
 *   <strong>Pekan 3 (GOR POPKI, Jakarta)</strong>
 *   <strong>Sabtu, 31 Oktober 2026<br /></strong>
 *   Proton FC vs Kuda Laut Nusantara - 09.00 WIB<br />...
 *   Bintang Timur 5-2 Unggul FC - 19.00 WIB<br />...
 *
 * Adapter ini hanya membaca. Ia tidak pernah menyimpulkan laga yang tidak
 * tertulis, dan tidak pernah mengarang skor untuk laga yang masih "vs".
 */

const MONTHS = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Buang tag HTML dan normalisasi entitas + spasi. */
export function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#61;/g, '=')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** "31 Oktober 2026" -> "2026-10-31". Null bila tidak dikenali. */
export function parseIndonesianDate(text) {
  const m = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Urai satu baris laga.
 *   "Bintang Timur 5-2 Unggul FC - 19.00 WIB"  -> skor
 *   "Proton FC vs Kuda Laut Nusantara - 09.00 WIB" -> belum dimainkan
 * Mengembalikan null bila baris bukan laga.
 */
export function parseMatchLine(line) {
  const text = line.trim();
  if (!text) return null;

  // waktu di ujung: "- 19.00 WIB" atau "- 19:00"
  const timeMatch = text.match(/-\s*(\d{1,2})[.:](\d{2})\s*(?:WIB)?\s*$/i);
  if (!timeMatch) return null;
  const time = `${String(Number(timeMatch[1])).padStart(2, '0')}:${timeMatch[2]}`;
  const body = text.slice(0, timeMatch.index).trim();

  // hasil: "Tim A 5-2 Tim B"
  const scored = body.match(/^(.+?)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s+(.+)$/);
  if (scored) {
    return {
      homeName: scored[1].trim(),
      awayName: scored[4].trim(),
      homeScore: Number(scored[2]),
      awayScore: Number(scored[3]),
      time,
      played: true,
    };
  }

  // belum dimainkan: "Tim A vs Tim B"
  const pending = body.match(/^(.+?)\s+(?:vs\.?|v)\s+(.+)$/i);
  if (pending) {
    return {
      homeName: pending[1].trim(),
      awayName: pending[2].trim(),
      homeScore: null,
      awayScore: null,
      time,
      played: false,
    };
  }

  return null;
}

/**
 * Urai seluruh halaman menjadi daftar pekan.
 *
 * Halaman sumber memakai <p> yang tidak selalu ditutup, sehingga judul pekan
 * dan tanggal bisa menempel pada teks sebelumnya dalam satu baris. Karena itu
 * penguraian dilakukan berdasarkan posisi penanda di dalam teks, bukan dengan
 * mengharapkan penanda berada di awal baris.
 *
 * @returns {Array<{week:number, venue:string, city:string, matches:Array}>}
 */
export function parseSchedule(html) {
  const text = stripTags(html);

  // kumpulkan penanda beserta posisinya
  const markers = [];

  const weekRe = /Pekan\s+(\d{1,2})\s*(?:\(([^)]*)\))?/gi;
  for (let m; (m = weekRe.exec(text)); ) {
    const place = (m[2] || '').split(',').map((s) => s.trim());
    markers.push({
      at: m.index,
      end: m.index + m[0].length,
      kind: 'week',
      week: Number(m[1]),
      venue: place[0] || '',
      city: place.slice(1).join(', ') || '',
    });
  }

  const dateRe = /(?:Sabtu|Minggu|Senin|Selasa|Rabu|Kamis|Jumat),?\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/gi;
  for (let m; (m = dateRe.exec(text)); ) {
    const iso = parseIndonesianDate(m[0]);
    if (iso) markers.push({ at: m.index, end: m.index + m[0].length, kind: 'date', date: iso });
  }

  // Setiap laga diakhiri jam ("- 19.00 WIB"). Jam itu dipakai sebagai jangkar.
  // Badan laga adalah teks sesudah jangkar sebelumnya, dipotong pada pemisah
  // baris terakhir sebelum jangkar ini. Cara ini tahan terhadap <br /> yang
  // hilang sehingga dua laga menempel dalam satu baris.
  const timeRe = /-\s*(\d{1,2})[.:](\d{2})\s*(?:WIB)?/gi;
  const anchors = [];
  for (let m; (m = timeRe.exec(text)); ) {
    anchors.push({
      at: m.index,
      end: m.index + m[0].length,
      time: `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`,
    });
  }

  // penanda struktural (pekan & tanggal) sebagai batas mutlak
  const boundaries = markers.map((m) => ({ at: m.at, end: m.end })).sort((a, b) => a.at - b.at);

  for (const anchor of anchors) {
    // Awal jendela: akhir jangkar waktu sebelumnya, atau akhir penanda
    // pekan/tanggal yang menempel langsung setelah "WIB".
    let from = 0;
    for (const a of anchors) {
      if (a.end <= anchor.at) from = Math.max(from, a.end);
    }
    for (const b of boundaries) {
      if (b.end <= anchor.at) from = Math.max(from, b.end);
    }

    // Akhir jendela: awal penanda berikutnya, supaya
    // "Halus FC 1-5 Bintang Timur - 19.00 WIBPekan 2 (...)" tidak ikut
    // membawa kata "Pekan 2" ke dalam badan laga.
    let to = anchor.at;
    for (const b of boundaries) {
      if (b.at >= from && b.at < to) to = b.at;
    }

    const body = text.slice(from, to).replace(/^[\s,;|]+/, "").trim();
    if (!body) continue;

    const parsed = parseMatchLine(`${body} - ${anchor.time} WIB`);
    if (parsed) markers.push({ at: from, end: anchor.end, kind: "match", match: parsed });
  }

  markers.sort((a, b) => a.at - b.at);

  const weeks = [];
  let currentWeek = null;
  let currentDate = null;

  for (const marker of markers) {
    if (marker.kind === 'week') {
      currentWeek = { week: marker.week, venue: marker.venue, city: marker.city, matches: [] };
      weeks.push(currentWeek);
      currentDate = null;
    } else if (marker.kind === 'date') {
      currentDate = marker.date;
    } else if (marker.kind === 'match' && currentWeek && currentDate) {
      currentWeek.matches.push({ ...marker.match, date: currentDate });
    }
  }

  return weeks.filter((w) => w.matches.length > 0);
}

/**
 * Peta nama dari sumber ke id tim kita.
 * Sumber memakai nama pendek yang tidak selalu sama dengan teams.json,
 * jadi pencocokan dilakukan lewat alias eksplisit, bukan tebakan.
 */
export const TEAM_ALIASES = {
  'bintang timur': 'bintang-timur',
  'bintang timur surabaya': 'bintang-timur',
  'black steel': 'black-steel',
  'black steel papua': 'black-steel',
  'blacksteel': 'black-steel',
  'cosmo jne': 'cosmo-jne',
  'cosmo jne fc': 'cosmo-jne',
  'cosmo jne fc jakarta': 'cosmo-jne',
  'halus': 'halus',
  'halus fc': 'halus',
  'halus fc jakarta': 'halus',
  'kuda laut nusantara': 'kuda-laut',
  'kuda laut nusantara fc': 'kuda-laut',
  'mimika': 'mimika',
  'mimika fc': 'mimika',
  'mimika fc papua': 'mimika',
  'nz laksamana laut': 'nanzaby',
  'nanzaby': 'nanzaby',
  'nanzaby fc': 'nanzaby',
  'nanzaby fc kepri': 'nanzaby',
  'pangsuma': 'pangsuma',
  'pangsuma fc': 'pangsuma',
  'pangsuma fc kalbar': 'pangsuma',
  'proton': 'proton',
  'proton fc': 'proton',
  'proton fc kuningan': 'proton',
  'unggul': 'unggul',
  'unggul fc': 'unggul',
  'unggul fc malang': 'unggul',
};

export function resolveTeamId(name, teams) {
  const key = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (TEAM_ALIASES[key]) return TEAM_ALIASES[key];

  // fallback: cocokkan dengan nama/short/kode resmi
  for (const team of teams) {
    const candidates = [team.name, team.short, team.code].map((s) => s.toLowerCase());
    if (candidates.includes(key)) return team.id;
  }
  // fallback terakhir: awalan
  for (const team of teams) {
    const short = team.short.toLowerCase();
    if (key.startsWith(short) || short.startsWith(key)) return team.id;
  }
  return null;
}

/** Mengambil halaman sumber. Melempar Error dengan pesan yang jelas bila gagal. */
export async function fetchSource(url, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`sumber menjawab HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`sumber tidak menjawab dalam ${timeoutMs / 1000} detik`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
