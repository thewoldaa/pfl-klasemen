# Klasemen Pro Futsal League Indonesia

Papan klasemen, jadwal, dan hasil PFL 2026/2027 yang **dihitung dari hasil pertandingan** — bukan diketik manual.

Setiap angka di halaman ini berasal dari satu berkas: `data/matches.json`. Klasemen dibangun ulang dari daftar laga itu setiap kali ada perubahan, baik di komputermu maupun di GitHub Actions. Kalau sebuah angka tidak bisa direproduksi dari hasil pertandingan, build gagal dan tidak ada yang dipublikasikan.

**Situs:** `https://thewoldaa.github.io/pfl-klasemen/`

---

## Kenapa dihitung, bukan diketik

Sumber berita mencetak klasemen sebagai tabel jadi. Tabel itu mengandung salah ketik: pada pekan 2 musim ini, satu sumber menulis selisih gol Black Steel `+5` padahal golnya `8–3` (selisih `+3`), dan menulis gol memasukkan Unggul `3` padahal hasil empat laganya berjumlah `4`. Keduanya lolos dari penyuntingan manusia.

Aplikasi ini tidak menyimpan klasemen sama sekali. Ia menyimpan hasil pertandingan, lalu menghitung:

```
poin      = 3 × menang + 1 × seri
peringkat = poin → selisih gol → gol memasukkan → head-to-head → jumlah menang
```

Kalau hasilnya berbeda dari tabel yang diterbitkan, yang salah adalah tabelnya — dan build akan menunjukkannya.

## Yang bisa dilakukan

- **Klasemen** dengan penanda Final Four, bentuk lima laga terakhir, dan sorotan tim.
- **Pencarian** yang mengerti nama tim, kota, kode tim, tanggal (`31 Oktober`, `31/10`, `2026-10-31`), nomor pekan (`pekan 3`), pasangan (`proton vs pangsuma`), dan kata relatif (`hari ini`, `besok`). Salah ketik ringan ditoleransi.
- **Jadwal per pekan** dengan penanda laga yang belum dimainkan.
- **Halaman detail tim** (`tim.html?team=bintang-timur`): rekap hasil per lawan, head-to-head penuh dengan lawan pilihan (agregat gol, W–D–L, setiap pertemuan), lintasan peringkat per pekan, gol memasukkan dan kemasukan per pekan, semua laga, laga berikutnya, serta kemenangan dan kekalahan terbesar.
- **Sinkronisasi hasil mingguan** dari halaman sumber, dengan pengaman: hanya menambah hasil, tidak pernah menimpa tanpa `--force`, dan menolak menulis kalau validasi gagal.
- **Input skor lokal**: masukkan skor, klasemen berubah seketika. Perubahan itu hanya tersimpan di peramban sampai halaman dimuat ulang — lihat catatan di bawah.
- **Mode gelap**, tabel yang menjadi daftar di ponsel, dan tautan langsung (`?q=bintang`).

## Menjalankan

```bash
npm run build     # validasi data, hitung klasemen, tulis data/standings.json + dist/data.json
npm run verify    # periksa ulang hasil build secara independen
node scripts/test.mjs
npm run serve     # http://localhost:4173
npm run sync      # tarik hasil pekan terbaru dari halaman sumber (dry-run)
```

Tidak ada dependensi. Hanya Node 20 atau lebih baru.

## Struktur

```
data/
  league.json       identitas liga, aturan poin, tiebreak
  teams.json        daftar klub
  matches.json      SATU-SATUNYA sumber kebenaran: hasil dan jadwal
  standings.json    hasil hitungan (dibuat, jangan disunting)
assets/
  modules/engine.mjs  aturan liga + mesin pencarian (dipakai Node dan peramban)
  app.js              antarmuka papan
  team.js             antarmuka halaman detail tim
  styles/             token dan komponen
tim.html              halaman detail tim
scripts/
  build.mjs         validasi → hitung → tulis
  verify.mjs        pemeriksaan independen
  test.mjs          uji perilaku
  freshness.mjs     pengawas data basi
  serve.mjs         server statis untuk pengembangan
  sync.mjs          tarik hasil dari sumber mingguan
  sources/skor.mjs  adaptor pengurai halaman sumber
.github/workflows/daily.yml
```

## Menambah hasil pertandingan

Sunting `data/matches.json`. Isi `homeScore` dan `awayScore`, ubah `status` menjadi `finished`:

```json
{
  "id": "W03-M01",
  "week": 3,
  "date": "2026-10-31",
  "time": "09:00",
  "home": "proton",
  "away": "kuda-laut",
  "homeScore": 4,
  "awayScore": 2,
  "venue": "GOR POPKI Cibubur",
  "city": "Jakarta",
  "status": "finished"
}
```

Lalu jalankan `npm run check`. Kalau data diterima, buka pull request. Bot akan membangun ulang klasemen setelah merge.

**Jangan** menyunting `data/standings.json` atau `dist/data.json` — keduanya ditimpa setiap build.

### Menarik hasil mingguan dari sumber

Menyunting JSON dengan tangan rawan salah. `scripts/sync.mjs` membaca halaman sumber, mencocokkan setiap laga ke `data/matches.json`, lalu mengisi skor yang belum ada:

```bash
npm run sync                  # dry-run: tampilkan apa yang akan berubah, tidak menulis apa pun
npm run sync:apply            # tulis perubahan ke data/matches.json
node scripts/sync.mjs --offline halaman.html   # uji adaptor pada salinan halaman
```

Pengamannya sengaja ketat:

- **Hanya menambah.** Laga yang sudah punya skor tidak pernah ditimpa. Kalau sumber berbeda dari data, sync melaporkan `KONFLIK` dan berhenti — perbedaan itu harus diputuskan manusia, bukan ditelan diam-diam.
- **Tidak menebak tim.** Laga baru hanya masuk kalau kedua nama timnya dapat dipetakan ke `teams.json` lewat alias. Nama yang tidak dikenal dilaporkan, bukan ditebak.
- **Tidak menulis data rusak.** Hasil gabungan divalidasi lebih dulu; kalau gagal, berkas tidak disentuh.

Setelah `--apply`, jalankan `npm run check` dan tinjau diff `data/matches.json` sebelum commit. Nama-nama tim di halaman sumber ditulis berbeda-beda antar musim; kalau muncul nama yang belum dikenal, tambahkan ke `TEAM_ALIASES` di `scripts/sources/skor.mjs`.

### Aturan yang ditegakkan build

Build menolak data yang:

- memuat tim yang tidak ada di `teams.json`
- mempertemukan sebuah tim dengan dirinya sendiri
- memakai pasangan kandang-tandang yang sama dua kali
- memainkan satu tim lebih dari dua kali dalam satu pekan
- menandai `finished` tetapi skornya belum lengkap, atau sebaliknya
- meninggalkan selisih jumlah laga antar tim lebih dari satu

Selain itu `verify.mjs` memeriksa bahwa klasemen dapat direproduksi, total gol memasukkan sama dengan total gol kemasukan, dan setiap baris memenuhi `main = menang + seri + kalah`.

## Pembaruan harian

`.github/workflows/daily.yml` berjalan setiap 06:00 WIB:

1. membangun ulang klasemen,
2. menjalankan seluruh pemeriksaan dan uji,
3. memeriksa kesegaran data,
4. melakukan commit bila ada perubahan.

Kalau data tidak konsisten, alur kerja berhenti dan tidak ada yang dipublikasikan. Lebih baik papan yang tertinggal satu hari daripada papan yang salah.

## Soal input skor lokal

Kotak "Input skor" di halaman adalah alat bantu, bukan basis data. Skor yang kamu masukkan disimpan di `localStorage` peramban itu saja, dan hilang saat halaman dimuat ulang. Ini disengaja: situs statis tidak punya tempat menyimpan data bersama, dan memberi kesan bahwa isianmu tersimpan permanen untuk semua orang akan menyesatkan. Untuk menjadikannya permanen, ekspor perubahan lalu masukkan ke `data/matches.json` lewat pull request.

## Sumber data

Hasil pekan 1–2 dan jadwal pekan 3–7 diambil dari pemberitaan:

- [Skor.id — Jadwal, Hasil dan Klasemen PFL 2026/2027](https://skor.id/posts/785481/pro-futsal-league-2026-2027-jadwal-hasil-dan-klasemen-lengkap)
- [G-Sports — Rekap Pekan 2 PFL 2026/2027](https://g-sports.id/2026/10/04/pekan-2-pfl-2026-2027-bintang-timur-surabaya-puncaki-klasemen/)

Jadwal pekan 4 dan seterusnya dapat berubah. Jangan menambah laga yang belum diumumkan operator liga.

Proyek ini tidak berafiliasi dengan Federasi Futsal Indonesia, PT Kompetisi Futsal Indonesia, atau klub mana pun.

## Lisensi

MIT — lihat [LICENSE](LICENSE).
