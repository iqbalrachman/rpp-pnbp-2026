# Dashboard Pembayaran PNBP BMKG

Satu file HTML (`index.html`) + satu backend Apps Script (`Code.gs`). Dashboard dibuka dari GitHub Pages, sedangkan **satu-satunya koneksi data adalah Google Apps Script**.

```
pnbp-dashboard/
├── index.html          # dashboard (HTML + CSS + JS dalam satu file)
├── Code.gs             # backend Apps Script: baca sheet transaksi + sheet target
├── appsscript.json     # manifest (timezone + akses web app)
├── data/latest.json    # snapshot CONTOH (bukan data asli) untuk pratinjau
└── README.md
```

---

## 1. Aturan yang dipegang dashboard ini

| Aturan | Penerapan |
| --- | --- |
| **Koneksi hanya GAS** | Tidak ada akses langsung ke Google Sheets dari browser (tidak ada `docs.google.com`, gviz, atau CSV publik di HTML). |
| **Spreadsheet = credential** | Sheet tidak dipublikasikan. Hanya Apps Script (`Execute as: Me`) yang membukanya. Browser hanya menerima data olahan lewat JSONP. |
| **Data olahan boleh publik** | Halaman GitHub Pages boleh dibuka siapa pun; yang tampil hanya hasil olahan, bukan isi spreadsheet. |
| **Tanpa konversi kurs** | Tidak ada kurs, tidak ada ekuivalen. IDR dan USD tidak pernah dijumlahkan. |
| **IDR & USD dipisah** | KPI, tren, proyeksi, peringkat, anomali, dan ekspor semuanya dipisah per mata uang. Tombol **IDR / USD** memilih mata uang untuk chart analitik. |
| **Target vs realisasi pintar** | Backend membaca sheet target apa pun bentuknya, lalu mencocokkan target ke transaksi lewat kode satker → nama satker → wajib bayar → NTPN → total. |
| **NTPN apa adanya** | Kolom `NTPN` ditampilkan persis seperti isi sheet (tidak dipotong, tidak diganti label). |

---

## 2. Setup Apps Script (sumber data)

1. Buka spreadsheet → **Extensions → Apps Script** (agar `SPREADSHEET_ID` tidak perlu diisi).
2. Tempel isi `Code.gs` ke `Code.gs`.
3. Buat file HTML bernama **`index`** (File → New → HTML), tempel seluruh isi `index.html`.
4. Sesuaikan bagian atas `Code.gs` bila perlu:

   ```js
   const SHEET_CONFIG = {
     SPREADSHEET_ID: '',      // kosongkan bila script terpasang di spreadsheet
     SHEET_NAME: '',          // kosongkan = sheet pertama (sheet transaksi)
     HEADER_SCAN_ROWS: 25,
     CACHE_SECONDS: 300,
     API_VERSION: '3',
   };

   const TARGET_CONFIG = {
     SHEET_NAME: '',          // kosongkan = cari otomatis sheet "TARGET"/"PAGU"
     HEADER_SCAN_ROWS: 15,
   };
   ```

5. Jalankan sekali dari editor:
   - `debugReadSheet` → memastikan header transaksi terdeteksi.
   - `debugReadTargets` → memastikan target terbaca (jumlah target & sheet yang dipakai).
6. **Deploy → New deployment → Web app**
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (wajib, agar JSONP dari GitHub Pages berhasil)
7. Salin URL `/exec`.

> Jangan gunakan **Publish to web** pada spreadsheet. Cukup Web App GAS; spreadsheet tetap privat.

---

## 3. Hubungkan halaman GitHub Pages ke GAS

Buka dashboard, klik ikon gerigi (**Pengaturan**), tempel URL `/exec`, simpan. Nilai disimpan di `localStorage` browser.

Alternatif tanpa membuka dialog:

```
https://<user>.github.io/<repo>/pnbp-dashboard/?endpoint=https://script.google.com/macros/s/XXXX/exec
```

Untuk default permanen, isi `DEFAULT_CONFIG.gasEndpoint` di `index.html` dengan URL tersebut (satu baris), lalu commit.

**Urutan pemuatan data:**

| Urutan | Sumber | Keterangan |
| --- | --- | --- |
| 1 | `google.script.run` | hanya bila halaman dibuka dari `/exec` |
| 2 | cache sesi | data live terakhir di tab yang sama (default 15 menit) |
| 3 | snapshot contoh `data/latest.json` | tampil cepat lalu **disegarkan dari GAS** di latar belakang |
| 4 | JSONP ke `/exec` | jalur utama di GitHub Pages |
| 5 | data demo | semua gagal — selalu berlabel “demo/contoh” |

Label sumber aktif selalu terlihat di banner dan panel kanan, jadi data contoh tidak akan tertukar dengan data asli.

---

## 4. Kontrak endpoint GAS

| URL | Hasil |
| --- | --- |
| `/exec` | dashboard HTML (file `index`) |
| `/exec?action=data` | `{ ok, rows, meta, targets, targetsMeta }` |
| `/exec?action=data&callback=cb` | `cb({ … });` — JSONP (dipakai dashboard) |
| `/exec?action=targets` | `{ ok, targets, meta }` |
| `/exec?action=health` | `{ ok: true, version, time }` |
| `/exec?action=meta` | metadata pembacaan sheet transaksi |

Fungsi untuk `google.script.run`: `getDashboardPayload()`, `getDashboardData()` (array baris saja), `getDashboardTargets()`.

---

## 5. Sheet transaksi (data pembayaran)

Header dicari otomatis pada 25 baris pertama, dicocokkan toleran (persis → huruf besar/kecil → mengandung).

| Kolom sheet | Dipakai sebagai |
| --- | --- |
| `NAMA WAJIB BAYAR / SETOR` | wajib bayar |
| `TANGGAL BAYAR` | tanggal (dikirim `YYYY-MM-DD`) |
| `KODE KL/UNIT/SATKER` | satker (kode + nama dipisah otomatis) |
| `NTPN` | **ditampilkan apa adanya** |
| `KODE BILLING`, `KODE BANK/POS`, `NTB/NTP` | kode referensi |
| `KODE PENERIMAAN`, `KODE PP`, `KODE TARIF`, `NOMINAL TARIF`, `VOLUME` | tarif & volume |
| `MATA UANG` | IDR / USD |
| `KODE AKUN` | kode akun |
| `SETORAN PER AKUN` | nilai setoran |
| `KETERANGAN` | keterangan |

Kolom lain tetap ikut terkirim dan bisa dicari lewat kotak pencarian.

---

## 6. Sheet target (untuk target vs realisasi)

Buat sheet bernama **`TARGET`** (atau `PAGU`; nama apa pun juga dideteksi selama punya kolom target). Dua bentuk didukung:

**a. Format panjang** (satu baris = satu target)

| KODE KL/UNIT/SATKER | PERIODE | MATA UANG | TARGET | CATATAN |
| --- | --- | --- | --- | --- |
| 437174 - STASIUN MET SULTAN AJI MUHAMMAD SULAIMAN SEPINGGAN | 2026 | IDR | 5000000 | DIPA 2026 |
| 436766 - SEKRETARIAT UTAMA BMKG | 2026 | USD | 9000000 | PNBP valas |
| Seluruh satker | 2026 | IDR | 30000000 | target total |

**b. Format lebar** (satu baris = satu unit, kolom target per tahun/periode)

| KODE KL/UNIT/SATKER | TARGET 2026 | TARGET 2026 USD | TARGET Q1 2026 |
| --- | --- | --- | --- |
| 663839 - STASIUN KLIMATOLOGI LAMPUNG | 8000000 | | 2000000 |

Periode yang dikenali: `2026` (tahun), `2026-03` (bulan), `2026-Q1` (triwulan). Kolom `MATA UANG` (atau akhiran `IDR`/`USD` pada nama kolom) menentukan mata uang; default IDR.

### Cara dashboard membaca target

1. **Pencocokan berlapis**: kode satker → nama satker (persis, lalu mengandung) → nama wajib bayar → teks NTPN → label → total. Jenis pencocokan yang berhasil ditampilkan di tabel (`satker`, `payer`, `ntpn`, `total`).
2. **Periode dihormati**: target tahunan hanya dibandingkan dengan transaksi tahun tersebut; target bulanan/triwulan difilter lebih ketat.
3. **Anti dobel hitung**: bila ada baris target tingkat **total** (mis. “Seluruh satker”), capaian agregat dihitung dari baris itu saja. Bila tidak ada, barulah target per satker dijumlahkan. Aturan ini terlihat di keterangan KPI.
4. **Proyeksi tahunan**: untuk target tahunan, dashboard menghitung laju realisasi per bulan berjalan dan memproyeksikan akhir tahun (`realisasi / bulan berjalan × 12`).
5. **Status**: `Tercapai` (≥100%), `Sesuai jalur` (≥90% atau proyeksi ≥90%), `Perlu perhatian` (≥70%), `Di bawah` (<70%), `Tanpa realisasi`.
6. **Tanpa sheet target**: dashboard memakai **pembanding otomatis** — realisasi bulan sebelumnya dibandingkan dengan bulan berjalan — dan memberi label jelas “bukan target resmi”. Jadi bagian ini tidak pernah kosong tanpa penjelasan.

Semua angka target mengikuti tombol **IDR / USD**: target USD dibandingkan dengan realisasi USD, tanpa dikonversi.

---

## 7. Perilaku angka & tanggal

- Tanpa konversi kurs; tidak ada kolom ekuivalen di mana pun.
- IDR diformat `Rp 1.234.567` (ringkas: `Rp 1,2 Jt`), USD `$1,234.56` (ringkas: `$1.23 M`).
- Tanggal: `Date` → `YYYY-MM-DD`; teks `dd/mm/yyyy` atau `yyyy-mm-dd` juga dikenali.
- Angka: `1.234,56`, `Rp 1.000.000`, `(2.500)`, `4.20E+5` diurai; kode panjang yang tampil `8.20E+18` dikonversi ke teks angka penuh **bila** nilai mentah tersedia.
- `SETORAN PER AKUN` dan `VOLUME` dikirim sebagai angka.

---

## 8. Batasan Apps Script

- Eksekusi maksimal 6 menit; respons web app sebaiknya < 30 detik.
- `CacheService` ±100 KB per item → payload dipecah otomatis (maks. 40 potong) dan dibatasi 6 jam.
- Web App `Anyone` berarti siapa pun yang punya URL dapat memanggil endpoint. Karena itu **hanya kirim kolom yang boleh publik**: isi `Code.gs` mengirim baris transaksi apa adanya, jadi pastikan tidak ada kolom sensitif (mis. NIP, nomor rekening) di sheet yang dibaca. Bila ada, sembunyikan kolomnya atau tambahkan filter di `readSheet_`.
- Tidak ada kuota URL Fetch yang terpakai (dashboard memanggil GAS, bukan sebaliknya).

---

## 9. Troubleshooting

| Gejala | Penyebab & solusi |
| --- | --- |
| Halaman menampilkan login Google | Web app belum `Anyone`, atau URL bukan `/exec`. |
| “Gagal memuat endpoint” | URL salah/terhapus. Cek `/exec?action=health`. |
| Endpoint 0 baris | Header transaksi tidak dikenali. Jalankan `debugReadSheet`. |
| Capaian target 0% semua | `debugReadTargets` — cek nama kolom target & periode. |
| Target tercocok ke “total” padahal per satker | Pastikan kolom kode satker berisi kode yang sama dengan sheet transaksi (mis. `437174`). |
| Angka jadi `8,2E+18` | Format kolom di sheet bukan Teks. |
| Data lama terus muncul | Cache GAS 300 detik + cache sesi 15 menit. Jalankan `clearDashboardCache`, klik **Muat ulang**. |
| Muncul “Data contoh (snapshot)” | GAS belum tersambung; atur endpoint di Pengaturan. |

---

## 10. Pengujian

```sh
npm test
```

Test memeriksa: sintaks script dashboard, tidak adanya kurs/konversi, pemisahan IDR–USD, kelengkapan seluruh ID elemen, tidak ada akses langsung ke Google Sheets, NTPN apa adanya, mesin target (pencocokan + anti dobel hitung), skema snapshot, dan `Code.gs` bersifat read-only. Bila `jsdom` terpasang, smoke test merender dashboard dan memeriksa KPI, tabel target, tabel NTPN, serta panel kualitas data.
