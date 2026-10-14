# RPP PNBP BMKG 2026

Dashboard statis untuk membandingkan layanan pada PP 47/2018 dengan usulan RPP PNBP BMKG 2026. Aplikasi berjalan di browser; tidak ada backend atau dependensi build.

## Berkas

- `index.html` — struktur halaman, tabel, drawer, dan styling.
- `app.js` — pemuatan data live, filter, statistik, chart ringkas, tabel, dan drawer detail.
- `data.js` — konfigurasi endpoint, parser CSV/gviz, pemetaan kolom, ekstraksi teks/tautan, tarif, hierarki, dan statistik.
- `snapshot.json` — placeholder nonaktif; aplikasi tidak membaca snapshot atau cache browser.

## Menjalankan secara lokal

Jalankan server statis dari direktori repo, lalu buka alamat server di browser. Contoh:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Buka `http://localhost:8000`. Jangan membuka `index.html` langsung melalui skema `file://`, karena modul JavaScript dan pemuatan data memerlukan origin HTTP.

## Alur dan integritas data

1. `app.js` mencoba beberapa endpoint **live** Google Sheets untuk RPP dan PP 47/2018; endpoint alternatif hanya dipakai jika masih mengambil sheet live.
2. CSV diproses oleh parser yang mendukung koma, kutip, dan baris baru di dalam sel. Respons gviz mempertahankan teks sel dan metadata hyperlink yang memang dikirim sumber.
3. `normRpp` memetakan header dengan alias eksplisit. Jika header yang dikenali tidak memuat kolom yang diperlukan, sumber ditolak dan endpoint live berikutnya dicoba; aplikasi tidak diam-diam menampilkan kolom yang tak terpetakan sebagai data kosong. Pemetaan posisi hanya menjadi fallback ketika feed tidak menyediakan header yang dikenali.
4. Isi teks field drawer tidak diringkas atau dipotong. Dasar Hukum dan Link Surat menampilkan teks sel serta target hyperlink yang berhasil diberikan sumber. Jika target tautan tidak tersedia dari sumber live, aplikasi memberi peringatan dan tidak membuat URL pencarian pengganti.
5. Hierarki layanan ditampilkan dari detail ke induk: Detil → Nama → Subjenis → Jenis. Pengelompokan konteks dihitung ulang dari baris yang terlihat setelah filter atau pengurutan.

Aplikasi **tidak menggunakan snapshot offline atau `localStorage`**. Jika semua sumber live gagal, aplikasi menampilkan status gagal, bukan data lama.

## Catatan sumber dan privasi

- Endpoint spreadsheet yang dipublikasikan dapat dibaca publik. Pastikan isi sheet memang boleh dibagikan sebelum mengubah izin publikasi.
- ID spreadsheet dan ID publikasi di `data.js` adalah identifier sumber, bukan kredensial autentikasi.
- Tidak ada proses unggah atau perubahan data ke spreadsheet dari dashboard ini.

## Pengujian

Test data memakai test runner bawaan Node.js, tanpa dependensi tambahan:

```sh
npm test
```
