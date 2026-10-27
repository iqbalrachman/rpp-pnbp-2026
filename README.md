# RPP PNBP BMKG 2026

Dashboard statis untuk membandingkan layanan pada PP 47/2018 dengan usulan RPP PNBP BMKG 2026. Aplikasi berjalan di browser; tidak ada backend atau dependensi build.

## Berkas

- `index.html` — struktur halaman, tabel, drawer, dan styling.
- `app.js` — pemuatan data live, filter, statistik, chart ringkas, tabel, dan drawer detail.
- `data.js` — konfigurasi endpoint, parser CSV/gviz, pemetaan kolom, ekstraksi teks/tautan, tarif, hierarki, dan statistik.
- `snapshot.json` — placeholder nonaktif; aplikasi tidak membaca snapshot atau cache browser.


## Dashboard Pembayaran PNBP (GAS + GitHub Pages)

Folder `pnbp-dashboard/` berisi dashboard pemantauan setoran PNBP (terpisah dari analisis tarif di atas):

- `pnbp-dashboard/index.html` — satu file HTML mandiri (Tailwind, ECharts, tanpa build).
- `pnbp-dashboard/Code.gs` — backend Apps Script: membaca sheet transaksi **dan** sheet target, menyajikan HTML/JSON/JSONP.
- `pnbp-dashboard/data/latest.json` — snapshot **contoh** (bukan data asli) untuk pratinjau.
- `pnbp-dashboard/README.md` — setup GAS, GitHub Pages, kontrak endpoint, format sheet target.
- `docs/BRAINSTORM-PNBP.md` — analitik, kualitas data, dan rencana kerja.

Aturan yang dipegang:

- **Koneksi data hanya lewat Google Apps Script.** Browser tidak pernah membaca spreadsheet langsung (tidak ada Published CSV/gviz/ID sheet di halaman).
- **Spreadsheet bersifat credential.** Hanya GAS (`Execute as: Me`) yang membukanya; halaman publik hanya menerima data olahan lewat JSONP.
- **Tidak ada konversi kurs.** IDR dan USD selalu ditampilkan terpisah — di KPI, tren, proyeksi, peringkat, anomali, dan ekspor.
- **Target vs realisasi** membaca sheet target apa pun bentuknya (format panjang atau lebar/tahunan), mencocokkan lewat kode satker → nama satker → wajib bayar → NTPN → total, dan menghindari dobel hitung bila ada baris target total.
- **NTPN ditampilkan apa adanya**, tanpa penggantian label.

## Menjalankan secara lokal

Jalankan server statis dari direktori repo, lalu buka alamat server di browser. Contoh:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Buka `http://localhost:8000`. Jangan membuka `index.html` langsung melalui skema `file://`, karena modul JavaScript dan pemuatan data memerlukan origin HTTP.

## Alur dan integritas data

1. `app.js` membaca RPP dari dua sumber **live** secara paralel: **Published CSV** (`pub-csv`) dan **gviz JSON** (`gviz-jsonp`). CSV menjadi dasar karena memuat teks persis seperti tampilan sheet. gviz dipakai sebagai pelengkap: hanya sel yang kosong di CSV yang diisi dari gviz, dan metadata hyperlink diambil dari gviz. Jika kedua sumber utama gagal, endpoint lain di `rppSources()` dicoba berurutan sebagai cadangan.
2. CSV diproses oleh parser yang mendukung koma, kutip, dan baris baru di dalam sel. Respons gviz mempertahankan teks sel dan metadata hyperlink yang memang dikirim sumber. Penggabungan dilakukan per baris (dicocokkan dengan ID Baru, ID Lama, dan No, dengan penghitung untuk ID ganda) oleh `mergeRpp` di `data.js`. Teks yang sudah terisi di CSV tidak pernah ditimpa.
3. `normRpp` memetakan header dengan alias eksplisit. Jika header yang dikenali tidak memuat kolom yang diperlukan, sumber ditolak dan endpoint live berikutnya dicoba; aplikasi tidak diam-diam menampilkan kolom yang tak terpetakan sebagai data kosong. Pemetaan posisi hanya menjadi fallback ketika feed tidak menyediakan header yang dikenali.
4. Isi teks field drawer tidak diringkas atau dipotong. Dasar Hukum dan Link Surat menampilkan teks sel serta target hyperlink yang berhasil diberikan sumber. Jika target tautan tidak tersedia dari sumber live, aplikasi memberi peringatan dan tidak membuat URL pencarian pengganti.
5. Hierarki layanan ditampilkan dari atas ke bawah: Jenis → Subjenis → Nama → Detil, dengan nama layanan (tebal) di bagian paling bawah. Pengelompokan konteks dihitung ulang dari baris yang terlihat setelah filter atau pengurutan. Ikon dipilih dari nama layanan itu sendiri lebih dulu, baru dari kategori induk.
6. Drawer detail RPP memiliki bagian **"Semua kolom sumber"** yang berisi semua kolom sheet yang terisi, dengan label header dari sumber. Bagian ini menjadi jaring pengaman: kolom yang belum dipetakan tetap terlihat.
7. Notice di halaman menampilkan jumlah sel yang dilengkapi dari sumber lain (`merge.filled`) dan jumlah sel yang berbeda antar sumber (`merge.diff`). Untuk sel yang berbeda, teks yang ditampilkan adalah versi CSV.

Aplikasi **tidak menggunakan snapshot offline atau `localStorage`**. Jika semua sumber live gagal, aplikasi menampilkan status gagal, bukan data lama.

## Catatan sumber dan privasi

- Endpoint spreadsheet yang dipublikasikan dapat dibaca publik. Pastikan isi sheet memang boleh dibagikan sebelum mengubah izin publikasi.
- ID spreadsheet dan ID publikasi di `data.js` adalah identifier sumber, bukan kredensial autentikasi.
- Tidak ada proses unggah atau perubahan data ke spreadsheet dari dashboard ini.

## Pengujian

Test memakai test runner bawaan Node.js, tanpa dependensi tambahan. `tests/data.test.js` menguji parser dan normalisasi; `tests/merge.test.js` menguji `mergeRpp` dan `cols` dengan fixture sintetis:

```sh
npm test
```
