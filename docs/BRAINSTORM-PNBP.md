# Brainstorm Data Pembayaran PNBP BMKG

Catatan kerja untuk dashboard `pnbp-dashboard/`. Fokus: apa yang ada di spreadsheet, apa yang layak diukur, bagaimana perlakuannya terhadap **IDR/USD**, dan bagaimana **target vs realisasi** dibuat benar-benar membaca data yang ada.

---

## 0. Keputusan yang sudah ditetapkan

| Keputusan | Konsekuensi teknis |
| --- | --- |
| Koneksi data **hanya lewat GAS** | Browser tidak pernah membuka spreadsheet. Tidak ada Published CSV, gviz, atau `docs.google.com` di halaman. |
| **Spreadsheet = credential** | Sheet tetap privat. Web App `Execute as: Me`, `Access: Anyone`. Browser hanya menerima payload olahan via JSONP. |
| **Data olahan boleh publik** | Halaman GitHub Pages boleh dibuka siapa pun. Yang tampil hanya agregat + baris transaksi yang memang dikirim GAS. |
| **Tanpa konversi kurs** | Tidak ada kurs, tidak ada ekuivalen IDR. IDR dan USD tidak pernah dijumlahkan, tidak ada “total gabungan”. |
| **NTPN apa adanya** | Teks kolom `NTPN` ditampilkan utuh: tidak dipotong, tidak dilabeli ulang, tidak dinormalisasi. |
| **Target vs realisasi wajib pintar** | Target datang dari sheet target yang bentuknya bebas, dicocokkan otomatis, dan tidak boleh dobel hitung. |

---

## 1. Profil data transaksi

**Grain:** satu baris = satu setoran untuk satu kombinasi *wajib bayar × satker × kode tarif × kode akun × tanggal bayar*.

| Kolom | Tipe sebenarnya | Catatan |
| --- | --- | --- |
| `NAMA WAJIB BAYAR / SETOR` | teks bebas | Campur instansi, perusahaan, dan perorangan. Perlu normalisasi nama (lihat §5). |
| `TANGGAL BAYAR` | tanggal | Basis semua tren, proyeksi, dan periode target. |
| `KODE KL/UNIT/SATKER` | teks `kode - nama` | Kode (6 digit) dipakai untuk **mencocokkan target**; nama untuk label. |
| `NTPN` | **teks nama layanan** | Contohnya “Informasi Cuaca untuk Penerbangan”. Ini dimensi layanan, bukan nomor pembayaran. Ditampilkan apa adanya. |
| `NTB/NTP` | teks campuran | Kunci transaksi; sebagian tampil `7.62E+16`. |
| `KODE BILLING`, `KODE BANK/POS` | angka panjang | Rawan berubah menjadi notasi eksponen saat impor. |
| `KODE PENERIMAAN`, `KODE PP`, `KODE TARIF` | kategori | `KODE PP` dominan `2018047`. |
| `NOMINAL TARIF` × `VOLUME` | angka | Hasil kali ≈ `SETORAN PER AKUN` → dipakai sebagai audit otomatis. |
| `MATA UANG` | `IDR` / `USD` | Dua skala berbeda dalam satu tabel. **Tidak pernah dijumlahkan.** |
| `KODE AKUN` | kategori | Komposisi penerimaan. |
| `SETORAN PER AKUN` | angka | Metrik utama. |
| `KETERANGAN` | teks bebas | Sering kosong; sebagian memuat nama perusahaan/periode. |

**Implikasi**

1. Setiap metrik punya dua versi: `totalIdr` dan `totalUsd`. Rata-rata, porsi, peringkat, dan anomali dihitung per mata uang.
2. `NTPN` tidak boleh dipakai untuk menghitung “jumlah NTPN unik” sebagai kode pembayaran; yang dihitung adalah jumlah teks NTPN unik (jenis layanan).
3. Karena tidak ada kurs, pertanyaan “total penerimaan nasional” harus dijawab dua angka, bukan satu.

---

## 2. Arsitektur data & keamanan

```
Spreadsheet (credential, privat)
        │  dibaca Apps Script (Execute as: Me)
        ▼
Code.gs  ──►  payload { rows, targets, meta }
        │        JSONP: callback({...})
        ▼
GitHub Pages (index.html)  ──►  agregasi & chart di browser
```

* Halaman statis **tidak** menyimpan ID/URL spreadsheet. Test otomatis menolak keberadaan `docs.google.com`, gviz, atau `spreadsheets/d/`.
* Endpoint `/exec` bersifat publik. Karena itu yang dikirim hanya data yang memang boleh tampil. Bila spreadsheet memuat kolom sensitif (NIP, rekening, kontak), sembunyikan kolomnya di sheet atau saring di `readSheet_` sebelum dikirim.
* Cache: `CacheService` (payload dipecah 90 KB) + cache sesi browser. Turunkan `CACHE_SECONDS` bila data harus hampir real-time.

---

## 3. Mata uang: aturan tampilan

| Permukaan | IDR | USD |
| --- | --- | --- |
| Banner total | angka sendiri + jumlah transaksi | angka sendiri + jumlah transaksi |
| KPI | Total IDR, rata-rata IDR | Total USD, rata-rata USD |
| Tren | panel IDR | panel USD (grid terpisah, bukan sumbu ganda) |
| Proyeksi | regresi IDR | regresi USD |
| Peringkat satker/NTPN/wajib bayar | bar `idr` | bar `usd` |
| Anomali | z-score dihitung dari kelompok IDR | z-score dihitung dari kelompok USD |
| Kumulatif & komposisi akun | mengikuti tombol **IDR/USD** | mengikuti tombol **IDR/USD** |
| Target | target IDR vs realisasi IDR | target USD vs realisasi USD |

Prinsip: **satu panel = satu mata uang**. Tidak ada sumbu Y ganda yang mencampur IDR dan USD, karena visual seperti itu menyiratkan perbandingan yang secara akuntansi tidak valid.

---

## 4. Target vs realisasi

### 4.1 Bentuk sheet target yang didukung

**Panjang** (disarankan):

| KODE KL/UNIT/SATKER | PERIODE | MATA UANG | TARGET |
| --- | --- | --- | --- |
| 437174 - STASIUN MET SEPINGGAN | 2026 | IDR | 5000000 |
| 436766 - SEKRETARIAT UTAMA BMKG | 2026 | USD | 9000000 |
| Seluruh satker | 2026 | IDR | 30000000 |

**Lebar** (umum di dokumen DIPA):

| KODE KL/UNIT/SATKER | TARGET 2026 | TARGET 2026 USD | TARGET Q1 2026 |
| --- | --- | --- | --- |
| 663839 - STASIUN KLIMATOLOGI LAMPUNG | 8000000 | | 2000000 |

Deteksi dilakukan dengan membaca header 15 baris pertama: kolom target dikenali dari nama `TARGET`, `PAGU`, `TARGET 2026`, `TARGET 2026 USD`, `TARGET Q1 2026`, dan sejenisnya. Bila tidak ada sheet bernama TARGET/PAGU, backend memeriksa sheet lain (selain sheet transaksi) yang punya header target.

### 4.2 Algoritma pencocokan

```
target → kode satker  (persis / prefix)
       → nama satker  (persis → mengandung)
       → nama wajib bayar
       → teks NTPN
       → label bebas (satker/payer/ntpn)
       → total (semua baris)
```

Setiap target menyimpan `matchType` hasil pencocokan sehingga bisa diaudit di tabel. Bila target tidak punya dimensi apa pun, dianggap target total. Pencocokan nama memakai normalisasi sederhana (uppercase, spasi dirapikan).

### 4.3 Agregasi anti dobel hitung

Bila sheet memuat baris **total** (“Seluruh satker”) *dan* target per satker, menjumlahkan semuanya akan menggandakan angka. Aturannya:

```
basis = baris target dimensi 'total' bila ada, jika tidak: seluruh baris target
```

`summary.basis` diteruskan ke UI sehingga keterangan KPI menyebut “target tingkat total” atau “jumlah target per unit”.

### 4.4 Proyeksi & status

Untuk target tahunan:

```
bulan berjalan  = jumlah bulan unik yang punya transaksi pada tahun target
proyeksi akhir  = realisasi / bulan berjalan × 12
```

Status: `Tercapai` (≥100%), `Sesuai jalur` (≥90% atau proyeksi ≥90%), `Perlu perhatian` (≥70%), `Di bawah` (<70%), `Tanpa realisasi` (tidak ada transaksi pada periode itu).

### 4.5 Fallback: pembanding otomatis

Tanpa sheet target, dashboard membuat pembanding dari **realisasi bulan sebelumnya**, untuk total dan 8 satker teratas, lalu memberi label “bukan target resmi”. Tujuannya agar bagian ini tetap informatif tanpa menyesatkan.

### 4.6 Yang perlu ditambahkan agar makin pintar

1. **Target per kode tarif** — beberapa layanan punya target terpisah; saat ini pencocokan belum memakai `KODE TARIF`.
2. **Target triwulanan bertingkat** — mendukung `Q1`–`Q4` sebagai pecahan target tahunan agar proyeksi lebih halus.
3. **Target revisi** — kolom `VERSI`/`REVISI` supaya DIPA awal vs revisi bisa dibandingkan.
4. **Target dengan satuan non-rupiah** (mis. jumlah layanan) — butuh kolom `SATUAN` agar capaian tidak selalu uang.

---

## 5. Kualitas data

| Pemeriksaan | Dampak | Perbaikan di sheet |
| --- | --- | --- |
| Tanggal tidak terbaca | baris hilang dari tren & target | format kolom sebagai Date; validasi input |
| Kode dalam notasi `E+` | billing/NTB tidak bisa dicocokkan | format `KODE BILLING`, `KODE BANK/POS`, `NTB/NTP` sebagai **Plain text** |
| Nama wajib bayar kosong | segmentasi pincang | isi dari data billing; buat daftar nama baku |
| NTB ganda | risiko dobel hitung | jadikan NTB kunci unik + `COUNTIF` penanda |
| Tarif × volume ≠ setoran | salah input / tarif bertingkat | kolom bantu `=NOMINAL*VOLUME` |
| Setoran nol/negatif | merusak rata-rata | filter baris kosong sebelum ekspor |
| Mata uang selain IDR/USD | tidak masuk total mana pun | validasi daftar `IDR,USD` |
| Tanggal masa depan | salah tahun | validasi tanggal ≤ hari ini |

Aturan teknis: satu sheet = satu tabel bersih; header di satu baris; kolom bantu `PERIODE` (`yyyy-mm`), `TAHUN`, `BULAN`; simpan target di sheet terpisah (bukan digabung ke sheet transaksi).

---

## 6. Analitik yang sekarang berjalan

| Analitik | Cara hitung | Catatan |
| --- | --- | --- |
| Tren per periode | agregasi hari/bulan/tahun, **per mata uang** | panel terpisah |
| Proyeksi | regresi linear + interval prediksi 95% | per mata uang; ada peringatan bila periode terakhir belum lengkap |
| Anomali | `z = (x − μ)/σ`, ambang 3, **per mata uang** | minimal 5 baris per mata uang |
| Konsentrasi | porsi top-1 IDR dan USD (dua angka) | tidak digabung |
| Kekuatan satker/NTPN/wajib bayar | peringkat berdasarkan mata uang terpilih | klik-klik tombol IDR/USD |
| Audit tarif | `NOMINAL TARIF × VOLUME` vs setoran (toleransi 2%) | deteksi salah input |
| Kualitas data | 8 pemeriksaan + skor 0–100 | terlihat di bagian Kualitas Data |
| Target vs realisasi | pencocokan berlapis + proyeksi tahunan | lihat §4 |

---

## 7. Ide lanjutan

**Prioritas tinggi**

1. Filter rentang tanggal (dari–sampai) di samping filter periode.
2. Perbandingan periode: bulan ini vs bulan lalu vs bulan yang sama tahun lalu, per mata uang.
3. Drill-down: klik satker → daftar transaksi terfilter.
4. Bookmark filter di URL (`?period=month&currency=USD&satker=…`).
5. Target per kode tarif (§4.6).

**Prioritas menengah**

6. Dekomposisi pertumbuhan: kontribusi per satker terhadap Δ setoran.
7. Retensi wajib bayar (aktif → tidak aktif 2 bulan).
8. Indeks musiman per bulan kalender.
9. Peta sebaran satker dengan koordinat resmi (bukan kamus karangan).
10. Notifikasi otomatis (email/WA) bila realisasi bulanan turun > 20%.

**Prioritas rendah / eksperimen**

11. Klasifikasi teks `KETERANGAN` (proyek, asuransi, pelabuhan, penelitian) untuk melengkapi dimensi layanan.
12. Model musiman (Holt-Winters) dengan backtest MAPE sebelum dipakai.
13. Deteksi anomali multivariat (tarif, volume, setoran) per mata uang.

---

## 8. Metodologi & batasnya

- **Tanpa kurs**: seluruh perbandingan bersifat within-currency. Pertanyaan lintas mata uang dijawab dengan dua angka, bukan satu.
- **Anomali**: z-score per mata uang; data < 5 baris tidak dianalisis. Alternatif yang lebih tahan outlier: median ± 3×MAD.
- **Proyeksi**: regresi linear pada agregat periode + interval prediksi 95% (`σ√(1 + 1/n + (x−x̄)²/Sxx)`). Tidak menangkap musiman; periode terakhir yang belum lengkap diberi peringatan.
- **Kualitas data**: skor 0–100 dengan penalti berbobot (kritis 1,0 / perhatian 0,35 / info 0,15, batas 20 poin per temuan). Indikator relatif, bukan audit.
- **Target**: pencocokan berbasis teks, bukan foreign key. Selalu periksa kolom `matchType` sebelum memakai angka capaian dalam laporan resmi.

---

## 9. Rencana kerja

**Minggu 1 — fondasi**
- Deploy `Code.gs`, set endpoint di dashboard, verifikasi `/exec?action=health`.
- Buat sheet `TARGET` format panjang untuk tahun berjalan.
- Rapikan format kolom kode & tanggal di sheet transaksi.

**Minggu 2 — akurasi**
- Normalisasi nama wajib bayar (daftar baku).
- Lengkapi `NOMINAL TARIF`/`VOLUME` yang kosong agar audit tarif berjalan.
- Tetapkan siapa pemilik sheet target dan kapan diperbarui.

**Minggu 3–4 — nilai tambah**
- Filter rentang tanggal + perbandingan periode.
- Target per kode tarif dan target triwulanan.
- Notifikasi penurunan tajam.

---

## 10. Yang perlu dikonfirmasi

1. Nama sheet transaksi & sheet target yang sebenarnya (kode mendeteksi otomatis, tetapi belum diuji pada file asli).
2. Apakah `NTPN` memang berisi teks nama layanan di seluruh sheet, atau ada kolom nomor NTPN lain.
3. Kolom apa saja di spreadsheet yang tidak boleh tampil publik (perlu disaring sebelum dikirim GAS).
4. Apakah target resmi tersedia per satker, per kode tarif, atau hanya total nasional.
5. Siapa yang berwenang memperbarui sheet target dan seberapa sering.
