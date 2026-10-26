# Brainstorm Data Pembayaran PNBP BMKG

Catatan kerja untuk dashboard `pnbp-dashboard/`. Isinya: apa yang sebenarnya ada di spreadsheet, apa yang layak diukur, masalah data yang harus dibereskan lebih dulu, dan pilihan arsitektur supaya dashboard bisa hidup di GitHub tanpa server.

---

## 1. Profil data

**Grain:** satu baris = satu setoran untuk satu kombinasi *wajib bayar × satker × kode tarif × kode akun × tanggal bayar*. Satu wajib bayar bisa muncul berkali-kali (per bulan, per layanan, per satker).

| Kolom | Tipe sebenarnya | Catatan |
| --- | --- | --- |
| `NAMA WAJIB BAYAR / SETOR` | teks bebas | Bercampur instansi (PERUM LPPNPI), perusahaan (PT …), dan perorangan (“Bustan, S.Si, M.Sc,”). Butuh normalisasi. |
| `TANGGAL BAYAR` | tanggal | Basis semua tren. Sebagian sumber bisa berupa teks. |
| `KODE KL/UNIT/SATKER` | teks `kode - nama` | Kunci satker paling andal; nama saja sering panjang dan tidak konsisten. |
| `KODE BILLING`, `KODE BANK/POS` | angka panjang | Rawan berubah menjadi notasi eksponen saat impor. |
| `NTPN` | **teks nama layanan** | Di contoh data, isinya “Informasi Cuaca untuk Penerbangan”, bukan nomor NTPN. Ini temuan penting: kolom ini sebenarnya dimensi **layanan**, bukan kunci pembayaran. |
| `NTB/NTP` | teks campuran | Ada yang `FT26002375R1`, ada yang `7.62E+16`. Dipakai sebagai kunci transaksi. |
| `KODE PENERIMAAN`, `KODE PP`, `KODE TARIF` | kategori | Kode PP hampir selalu `2018047` pada contoh; kode tarif membedakan jenis layanan. |
| `NOMINAL TARIF` × `VOLUME` | angka | Pada contoh IDR maupun USD, hasil kali keduanya ≈ `SETORAN PER AKUN`. Jadi ini pasangan yang bisa dipakai untuk audit otomatis. |
| `MATA UANG` | IDR / USD | **Dua skala berbeda dalam satu tabel.** Jangan pernah menjumlahkan mentah. |
| `KODE AKUN` | kategori | Mayoritas `425433`; berguna untuk melihat komposisi penerimaan. |
| `SETORAN PER AKUN` | angka | Metrik utama (revenue). |
| `KETERANGAN` | teks bebas | Sering kosong; sebagian memuat nama perusahaan, periode, atau tujuan permintaan. |

**Implikasi cepat**

- Dashboard wajib memisahkan IDR dan USD. Ekuivalen IDR hanya boleh ada bila kursnya eksplisit (di dashboard: kurs asumsi yang bisa diubah).
- Kolom `NTPN` jangan dipakai untuk menghitung “jumlah NTPN unik”; itu jumlah jenis layanan.
- `NOMINAL TARIF × VOLUME` vs `SETORAN PER AKUN` adalah pemeriksaan integritas yang murah dan langsung berguna.
- Normalisasi nama wajib bayar (PT/PT./CV, spasi ganda, tanda baca) akan mengubah angka konsentrasi secara signifikan.

---

## 2. Pertanyaan yang layak dijawab dashboard

1. Berapa setoran bulan ini dibanding bulan lalu dan bulan yang sama tahun lalu?
2. Satker mana yang menyumbang paling besar, dan mana yang turun?
3. Apakah penurunan disebabkan volume atau tarif? (dekomposisi `setoran ≈ tarif × volume`)
4. Berapa konsentrasi pendapatan pada satu wajib bayar? Berapa HHI-nya?
5. Layanan mana yang pertumbuhannya paling cepat, bukan hanya paling besar?
6. Berapa potensi penerimaan sampai akhir tahun bila tren sekarang berlanjut?
7. Transaksi mana yang menyimpang dari pola (rapel, dobel, salah input)?
8. Berapa lama jeda antara pembayaran dan periode layanan yang dibayar?
9. Apakah ada kode tarif yang tidak pernah terpakai, atau justru muncul mendadak?
10. Berapa porsi penerimaan valas (USD) terhadap total, dan bagaimana eksposur kursnya?
11. Satker mana yang realisasinya jauh di bawah rata-rata nasional?
12. Berapa banyak baris yang tidak layak dipercaya (tanggal kosong, duplikat NTB, nominal nol)?

---

## 3. Analitik bertingkat

### Sudah ada di dashboard (quick win)

| Analitik | Cara hitung | Kenapa penting |
| --- | --- | --- |
| Tren setoran & volume | agregasi per hari/bulan/tahun, IDR dan USD terpisah | dasar monitoring |
| Proyeksi 3 periode | regresi linear + interval prediksi 95% | perencanaan target; ada peringatan bila periode terakhir belum lengkap |
| Pertumbuhan periode | `(nilai kini − sebelumnya) / sebelumnya` | mendeteksi perlambatan |
| Deteksi anomali | `z = (x − μ) / σ`, ambang `z > 3`, dihitung **per mata uang** | menemukan rapel/dobel |
| Konsentrasi wajib bayar | porsi top-1 + HHI | risiko ketergantungan satu pelanggan |
| Kekuatan satker & layanan | peringkat berdasarkan setoran | alokasi perhatian |
| Kualitas data | 8 pemeriksaan otomatis + skor | mencegah keputusan dari data rusak |
| Audit tarif | `NOMINAL TARIF × VOLUME` vs setoran (toleransi 2%) | kesalahan input volume/tarif |

### Lapis menengah (butuh kolom tambahan atau praproses)

1. **Dekomposisi volume vs harga**
   `ΔSetoran = ΔVolume × Tarif rata-rata + Volume rata-rata × ΔTarif + interaksi`.
   Cocok untuk menjawab “kenapa turun” tanpa menebak.
2. **Target vs realisasi**
   Butuh sheet target per satker/bulan. Tampilkan capaian, proyeksi akhir tahun, dan status warna.
3. **Pareto 80/20**
   Berapa banyak wajib bayar yang mencakup 80% setoran? Perubahan angka ini antar bulan adalah sinyal risiko.
4. **Analisis keranjang layanan**
   Pasangan layanan yang sering dibeli bersamaan oleh satu wajib bayar (co-occurrence) → peluang paket layanan.
5. **Retensi pelanggan**
   Wajib bayar yang aktif bulan ini tapi tidak aktif 2 bulan berikutnya (churn), dan sebaliknya (new/re-activated).
6. **Musim**
   Rata-rata per bulan kalender + Indeks Musiman; berguna karena pembayaran sering mengikuti siklus proyek.
7. **Jeda bayar**
   Bila ada kolom periode layanan, hitung *days sales outstanding*: tanggal bayar − akhir periode layanan.
8. **Kualitas nama entitas**
   Deteksi kemungkinan duplikat nama (jarak Levenshtein < 3) yang membuat top-1 terpecah.

### Lapis lanjut

- **Forecast musiman** (Holt-Winters) atau regresi dengan dummy bulan, dievaluasi dengan backtest (MAPE) sebelum dipakai.
- **Deteksi anomali multivariat** (Mahalanobis) memakai tarif, volume, dan setoran sekaligus.
- **Klasifikasi teks `KETERANGAN`** sederhana (kata kunci: proyek, asuransi, pelabuhan, penelitian) untuk mengisi dimensi layanan yang hilang.
- **Simulasi kebijakan tarif**: bila tarif kode X naik 10%, dampak ke penerimaan dengan asumsi elastisitas volume.

---

## 4. Kualitas data: temuan & perbaikan di spreadsheet

Skor kualitas dashboard menurunkan nilai untuk temuan berikut. Sebagian besar bisa dicegah di sheet.

| Pemeriksaan | Dampak | Perbaikan di sheet |
| --- | --- | --- |
| Tanggal tidak terbaca | baris hilang dari tren | format kolom sebagai Date; validasi input |
| Kode dalam notasi `E+` | billing/NTB tidak bisa dicocokkan | format kolom `KODE BILLING`, `KODE BANK/POS`, `NTB/NTP` sebagai **Plain text** |
| Nama wajib bayar kosong | segmentasi pincang | isi dari data billing; buat daftar nama baku (dropdown) |
| NTB ganda | risiko double counting | jadikan NTB kunci unik, tambahkan `COUNTIF` penanda |
| Tarif × volume ≠ setoran | salah input / tarif bertingkat | kolom bantu `=NOMINAL*VOLUME`, bandingkan dengan `SETORAN` |
| Setoran nol/negatif | merusak rata-rata | filter baris kosong sebelum ekspor |
| Mata uang selain IDR/USD | ekuivalen bias | validasi daftar `IDR,USD` |
| Tanggal masa depan | salah tahun | validasi tanggal ≤ hari ini |

**Aturan teknis yang disarankan**

- Satu sheet = satu tabel bersih, tanpa baris judul gabungan di atas header (dashboard bisa mendeteksi, tetapi lebih rapuh).
- Tambahkan kolom bantu: `PERIODE` (`yyyy-mm`), `TAHUN`, `BULAN`, `NILAI_IDR` (kurs terkunci saat input).
- Simpan kurs pada sheet terpisah + tanggal berlaku, jangan hardcode di laporan.
- Bekukan header, aktifkan filter, dan beri format angka `#,##0` (IDR) / `#,##0.00` (USD).

---

## 5. Arsitektur: GAS + GitHub

### Kenapa bukan `google.script.run` saja

`google.script.run` hanya tersedia bila halaman disajikan oleh Apps Script. Di GitHub Pages, halaman tidak punya runtime itu, dan GAS tidak mengirim header CORS sehingga `fetch` biasa gagal. Solusi paling murah: **JSONP** — `ContentService` mengembalikan `callback({...})` sehingga bisa dimuat lewat `<script>`.

### Pilihan sumber data

| Opsi | Kelebihan | Kekurangan | Kapan dipakai |
| --- | --- | --- | --- |
| JSONP ke `/exec` | real-time, tanpa build, gratis | bergantung kuota GAS; data terlihat publik | default |
| Snapshot JSON di repo | cepat, tetap hidup saat GAS down | tidak real-time | fallback + arsip |
| Commit snapshot via trigger + GitHub API | riwayat data, bisa di-diff | butuh token, ukuran repo membesar | audit bulanan |
| BigQuery + Sheets export | analitik besar, historis | setup & biaya | bila data > 50 ribu baris |
| Looker Studio | cepat untuk laporan | kustomisasi UI terbatas | laporan pimpinan |

### Batas GAS yang perlu diingat

- Eksekusi maksimum 6 menit; respons web app praktis perlu < 30 detik.
- `CacheService` 100 KB per item → payload dipecah menjadi beberapa potong di `Code.gs`.
- Kuota baca spreadsheet ± 20 juta sel/hari (akun gratis) — cukup untuk puluhan ribu baris, tetapi **jangan** panggil endpoint per keystroke.
- Web App `Anyone` = publik. Bila data sensitif, gunakan deployment `Anyone with Google account` dan buka dashboard dari dalam GAS, atau pindahkan ke hosting ber-auth.

### Strategi agregasi

Saat ini agregasi terjadi di browser (cocok sampai ± 20 ribu baris). Bila data membesar:

1. Tambahkan `?action=summary&period=month` yang mengembalikan agregat siap-chart.
2. Simpan hasil agregasi di CacheService 5–15 menit.
3. Kirim baris detail hanya saat pengguna membuka tabel/detail.

---

## 6. Ide fitur berikutnya (dashboard)

| Prioritas | Fitur | Alasan |
| --- | --- | --- |
| P0 | Filter rentang tanggal (dari–sampai) di samping filter periode | kebutuhan paling sering |
| P0 | Perbandingan periode (bulan ini vs bulan lalu vs tahun lalu) dalam satu chart | menjawab “naik/turun” tanpa hitung manual |
| P0 | Target vs realisasi per satker | indikator kinerja |
| P1 | Drill-down: klik satker → daftar transaksi terfilter | alur investigasi |
| P1 | Bookmark filter di URL (`?period=month&satker=…&from=…`) | bisa dibagikan |
| P1 | Unduh Excel/CSV sesuai filter + ringkasan | kebutuhan laporan |
| P1 | Peringatan otomatis (email/WA) bila setoran bulanan turun > 20% | deteksi dini |
| P2 | Peta sebaran satker dengan koordinat resmi | konteks geografis |
| P2 | Mode gelap & aksesibilitas penuh | kenyamanan |
| P2 | Peran pengguna (admin vs viewer) via GAS `Session` | tata kelola |

Catatan: “AI” pada dashboard ini adalah **aturan statistik** (regresi, z-score) dan asisten tanya-jawab berbasis kata kunci, bukan model bahasa. Labelnya dibuat eksplisit agar tidak menyesatkan.

---

## 7. Metodologi yang dipakai (dan batasnya)

- **Ekuivalen IDR:** `USD × kurs asumsi` (default 16.000, dapat diubah). Angka ini hanya untuk perbandingan relatif, bukan nilai akuntansi.
- **Anomali:** z-score per mata uang, ambang 3σ. Pada data < 5 baris deteksi dimatikan karena tidak stabil. Alternatif yang lebih tahan outlier: median ± 3×MAD.
- **Proyeksi:** regresi linear pada agregat periode + interval prediksi 95% (`σ√(1 + 1/n + (x−x̄)²/Sxx)`). Kelemahan: tidak menangkap musiman, dan periode terakhir yang belum lengkap akan menyeret arah tren — dashboard menampilkan peringatan bila hal itu terdeteksi.
- **Konsentrasi:** porsi top-1 dan HHI dihitung dari ekuivalen IDR, sehingga sangat dipengaruhi asumsi kurs. Untuk laporan resmi, hitung terpisah per mata uang.
- **Kualitas data:** skor 0–100 dengan penalti berbobot (kritis 1,0 / perhatian 0,35 / info 0,15, batas 20 poin per temuan). Skor ini indikator relatif, bukan audit.

---

## 8. Rencana kerja usulan

**Minggu 1 — fondasi**
- Deploy `Code.gs` baru, ganti URL `/exec` di dashboard, verifikasi `/exec?action=health`.
- Bereskan format kolom kode (Teks) dan tanggal di sheet.
- Buat snapshot harian agar GitHub Pages selalu punya data.

**Minggu 2 — akurasi**
- Normalisasi nama wajib bayar (buat daftar baku).
- Tambah kolom bantu periode + tarif×volume.
- Tetapkan sheet target tahunan per satker.

**Minggu 3–4 — nilai tambah**
- Filter rentang tanggal + perbandingan periode.
- Target vs realisasi dan proyeksi akhir tahun.
- Notifikasi otomatis untuk penurunan tajam.

**Setelahnya**
- Evaluasi backtest proyeksi; bila MAPE > 20%, ganti metode (musiman).
- Pertimbangkan BigQuery bila baris > 50 ribu atau butuh histori harian panjang.

---

## 9. Yang masih perlu dikonfirmasi

1. ID/URL spreadsheet dan nama sheet yang benar (kode ini mendeteksi header otomatis, tetapi belum diuji pada file asli).
2. Apakah kolom `NTPN` memang berisi nama layanan, atau ada kolom nomor NTPN lain di sheet?
3. Kurs resmi yang dipakai untuk pelaporan valas, dan apakah penerimaan USD memang dikonversi ke IDR di laporan resmi.
4. Target penerimaan 2026 per satker (untuk fitur target vs realisasi).
5. Apakah data boleh tampil publik di GitHub Pages, atau harus dibatasi.
