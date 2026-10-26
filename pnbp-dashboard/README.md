# Dashboard Pembayaran PNBP BMKG

Satu file HTML (`index.html`) + satu file backend Apps Script (`Code.gs`). Dashboard bisa dibuka sebagai Web App Google Apps Script **dan** sebagai halaman statis di GitHub Pages tanpa mengubah kode.

```
pnbp-dashboard/
├── index.html          # dashboard (HTML + CSS + JS dalam satu file)
├── Code.gs             # backend Apps Script: baca sheet, JSON, JSONP
├── appsscript.json     # manifest (timezone + akses web app)
├── data/latest.json    # snapshot contoh (fallback agar tetap tampil)
├── README.md           # dokumen ini
└── ../docs/BRAINSTORM-PNBP.md  # ide analitik lanjutan
```

## Cara kerja sumber data

Dashboard mencoba sumber berikut secara berurutan dan menampilkan sumber aktif di panel kanan:

| Urutan | Sumber | Kapan dipakai |
| --- | --- | --- |
| 1 | `google.script.run` | dashboard dibuka dari URL `/exec` Apps Script |
| 2 | Cache sesi | tab yang sama, data live terakhir masih segar |
| 3 | `data/latest.json` | hosting statis; tampil cepat lalu disegarkan dari GAS di latar belakang |
| 4 | Endpoint GAS (JSONP lalu `fetch`) | GitHub Pages dengan `gasEndpoint` terisi |
| 5 | Data demo | semua sumber gagal — **selalu diberi label “demo”** |

Tidak ada penulisan ke spreadsheet. Semua agregasi dilakukan di browser.

## 1. Deploy backend (Apps Script)

1. Buka <https://script.google.com> → **New project**.
2. Buat file `Code.gs` (default) lalu tempel isi `Code.gs` dari folder ini.
3. Tambah file HTML bernama **`index`** (File → New → HTML), lalu tempel seluruh isi `index.html`.
4. Isi konfigurasi di bagian atas `Code.gs`:

   ```js
   const SHEET_CONFIG = {
     SPREADSHEET_ID: '',   // kosongkan bila script terpasang di spreadsheet
     SHEET_NAME: '',       // kosongkan untuk sheet pertama
     HEADER_SCAN_ROWS: 25,
     CACHE_SECONDS: 300,
     API_VERSION: '3',
   };
   ```

   Disarankan membuat project dari spreadsheet (**Extensions → Apps Script**) agar `SPREADSHEET_ID` tidak perlu diisi.
5. Jalankan `debugReadSheet` sekali dari editor untuk memastikan header terdeteksi.
6. **Deploy → New deployment → Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (wajib, agar JSONP bekerja)
7. Salin URL `/exec`.

## 2. Arahkan dashboard ke endpoint itu

Buka `index.html`, ubah satu baris di `DEFAULT_CONFIG`:

```js
gasEndpoint: 'https://script.google.com/macros/s/…/exec',
```

Bisa juga tanpa mengubah file:

- tambahkan `?endpoint=https://…/exec` pada URL dashboard, atau
- buka **Pengaturan** (ikon gerigi) di dashboard lalu tempel URL-nya. Nilai disimpan di `localStorage` browser.

> URL lama yang masih menunjuk deployment versi sebelumnya tidak akan mengembalikan JSON. Setelah `Code.gs` versi ini dideploy, gunakan URL `/exec` yang baru.

## 3. Pindah ke GitHub Pages

1. Commit folder ini ke repo (tanpa `node_modules`).
2. **Settings → Pages → Source: Deploy from a branch → `main` / root**.
3. Buka `https://<user>.github.io/<repo>/pnbp-dashboard/`.
4. Isi endpoint GAS lewat dialog Pengaturan (atau `?endpoint=…`), lalu simpan sehingga URL tersebut bisa dibagikan.

Karena dashboard membaca JSON lewat JSONP, halaman statis dapat memanggil Apps Script tanpa server perantara. GAS tidak mengirim header CORS, jadi `fetch` biasa akan gagal — itulah alasan JSONP dipakai lebih dulu.

### Snapshot (opsional, disarankan)

`data/latest.json` adalah contoh. Untuk data asli tanpa GAS hidup, buat snapshot berkala:

1. Tambahkan trigger harian di Apps Script yang memanggil `getDashboardPayload()`.
2. Simpan JSON-nya ke repo lewat GitHub REST API (butuh token di Script Properties), atau unduh manual dari `?action=data`.
3. Set `meta.capturedAt` agar waktu snapshot terlihat di panel kanan.

Jangan menaruh data sensitif di repo publik. Pilih salah satu: snapshot publik, atau GAS dengan pembatasan akses.

## Kontrak endpoint

| URL | Hasil |
| --- | --- |
| `/exec` | dashboard HTML (`index`) |
| `/exec?action=data` | `{ ok, rows, meta }` JSON |
| `/exec?action=data&callback=cb` | `cb({ … });` — JSONP |
| `/exec?action=health` | `{ ok: true, version, time }` |
| `/exec?action=meta` | metadata pembacaan sheet |

Fungsi untuk `google.script.run`: `getDashboardPayload()` (baru), `getDashboardData()` (kompatibel, hanya array baris).

## Pemetaan kolom

Header dicari otomatis pada 25 baris pertama dan dicocokkan toleran (persis → huruf besar/kecil → mengandung). Kolom yang dikenali:

| Kolom sheet | Dipakai sebagai |
| --- | --- |
| `NAMA WAJIB BAYAR / SETOR` | wajib bayar |
| `TANGGAL BAYAR` | tanggal (dikirim `YYYY-MM-DD`) |
| `KODE KL/UNIT/SATKER` | satker |
| `NTPN` | nama layanan (lihat catatan di dokumen brainstorm) |
| `KODE BILLING`, `KODE BANK/POS`, `NTB/NTP` | kode referensi |
| `KODE PENERIMAAN`, `KODE PP`, `KODE TARIF`, `NOMINAL TARIF`, `VOLUME` | tarif & volume |
| `MATA UANG` | IDR/USD |
| `KODE AKUN` | kode akun |
| `SETORAN PER AKUN` | nilai setoran |
| `KETERANGAN` | keterangan |

Kolom lain tetap ikut terkirim dan bisa dicari lewat kotak pencarian.

## Perilaku angka & tanggal

- Sel tanggal: `Date` → `YYYY-MM-DD`; teks `dd/mm/yyyy` juga dikenali.
- Angka: `1.234,56`, `Rp 1.000.000`, `(2.500)`, dan notasi eksponen hasil impor diurai.
- Kode panjang yang tampil `8.20E+18` dikonversi ke teks angka penuh **bila** nilai mentah tersedia. Presisi yang sudah hilang di sheet tidak bisa dipulihkan — format kolomnya sebagai Teks.
- `SETORAN PER AKUN` dan `VOLUME` dikirim sebagai angka.

## Batasan Apps Script yang perlu diketahui

- Waktu eksekusi 6 menit/proses; pembacaan beberapa ribu baris biasanya hanya beberapa detik.
- `CacheService` dibatasi ±100 KB per item; payload dipecah otomatis (maks. 40 potong ≈ 3,6 MB) dan dibatasi 6 jam.
- Web App `Anyone` berarti siapa pun yang memiliki URL dapat membaca data.
- Kuota URL Fetch 20.000/hari (tidak dipakai di kode ini).

## Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| Dashboard menampilkan HTML login Google | Web app belum `Anyone`, atau URL bukan `/exec`. |
| “Gagal memuat endpoint” | URL salah/terhapus, atau deployment belum versi baru. Buka `/exec?action=health`. |
| Endpoint mengembalikan 0 baris | Header tidak dikenali atau sheet salah. Jalankan `debugReadSheet`. |
| Angka jadi `8,2E+18` | Format kolom di sheet bukan Teks. |
| Dashboard menampilkan data demo | Semua sumber gagal — cek label sumber di panel kanan dan dialog Pengaturan. |
| Data lama terus muncul | Cache 300 detik di GAS + cache sesi 15 menit. Jalankan `clearDashboardCache`, klik **Muat ulang**. |

## Pengujian

```sh
npm test
```

Test memeriksa sintaks script dashboard, kelengkapan ID elemen, jalur data (GAS/JSONP/snapshot/demo), skema snapshot, dan `Code.gs` tidak menulis ke sheet. Bila `jsdom` terpasang, smoke test merender dashboard dan memeriksa KPI serta tabel.
