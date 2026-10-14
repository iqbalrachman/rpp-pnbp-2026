import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gvizToRows, hierarchy, normPP47, normRpp, parseCSV, sortRows,
} from '../data.js';

const HEADERS = [
  'No', 'ID LAMA', 'ID BARU', 'UKE II', 'Kategori', 'Jenis', 'Subjenis',
  'Nama Layanan', 'Nama Detil Layanan', 'Satuan', 'Tarif',
  'Output/Tipe Data (Kolom J)',
  'Dasar Hukum (selain UU 31/2009 dan Perpres 20/2024)',
  'Deskripsi Layanan dan Parameter Layanan',
  'Pengguna Saat Ini dan/atau Sasaran Pengguna',
  'Rata-rata Permintaan Layanan (3 Tahun Terakhir)', 'Proyeksi Permintaan',
  'Pendapatan dalam 3 Tahun Terakhir dan/atau Perkiraan Pendapatan',
  'Benchmarking Layanan dari Instansi Lain dan/atau Pihak Swasta (jika ada)',
  'Link Surat',
];

function sampleValues(overrides = {}) {
  const values = [
    '1', '120180047000003', '3', 'DMP', 'UBAH', 'Jenis', 'Subjenis', 'Nama', 'Detil',
    'route', '4%', 'Output', 'Hukum A\n- Hukum B', 'Deskripsi', 'Pengguna', 'Rata-rata',
    'Sejumlah penerbangan pesawat di Indonesia dan termasuk lintas luar Indonesia',
    '2023 : 115.535.087.926\n2024 : 187.586.467.960\n2025 : 159.388.604.189\nRata-rata: 154,170,053,359',
    'Benchmark', 'Nama dokumen.pdf',
  ];
  for (const [key, value] of Object.entries(overrides)) values[Number(key)] = value;
  return values;
}

test('RPP maps Proyeksi and Pendapatan from their own columns and keeps full text', () => {
  const values = sampleValues();
  const row = normRpp([HEADERS, values])[0];
  assert.equal(row.idBaru, 3);
  assert.equal(row.proyeksi, values[16]);
  assert.equal(row.pendapatan, values[17]);
  assert.equal(row.hukum, 'Hukum A\n- Hukum B');
});

test('CSV parser and RPP normalizer preserve newlines, punctuation, and literal hyphens', () => {
  const values = sampleValues();
  const csv = [HEADERS, values].map((line) => line.map((value) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\n');
  const row = normRpp(parseCSV(csv))[0];
  assert.equal(row.pendapatan, values[17]);
  assert.equal(row.hukum, values[12]);
  assert.equal(row.rata3, 'Rata-rata');
});

test('incomplete recognized headers are rejected instead of silently mapping blanks', () => {
  assert.throws(
    () => normRpp([['ID BARU', 'KATEGORI', 'JENIS'], ['3', 'UBAH', 'Jenis']]),
    /Header RPP tidak lengkap/,
  );
});

test('positional fallback is available only for a complete-width feed', () => {
  const values = Array(21).fill('');
  Object.assign(values, {
    1: '120180047000003', 2: '0', 3: '3', 4: 'DMP', 5: 'UBAH', 6: 'Jenis',
    7: 'Subjenis', 8: 'Nama', 9: 'Detil', 10: 'route', 11: '4%', 12: 'Output',
    13: 'Hukum', 14: 'Deskripsi', 15: 'Pengguna', 16: 'Rata-rata', 17: 'Proyeksi',
    18: 'Pendapatan', 19: 'Benchmark', 20: 'Link',
  });
  assert.equal(normRpp([values])[0].link, 'Link');
  assert.throws(() => normRpp([values.slice(0, 20)]), /Feed tanpa header/);
});

test('gviz keeps cell text and extracts available hyperlink targets', () => {
  const rows = gvizToRows({
    table: {
      cols: [{ label: 'Link Surat' }],
      rows: [{ c: [{ v: 'Nama dokumen.pdf', f: '<a href="https://example.test/doc">Nama dokumen.pdf</a>', p: { href: 'https://example.test/doc' } }] }],
    },
  });
  assert.equal(rows[1][0].text, 'Nama dokumen.pdf');
  assert.equal(rows[1][0].links[0].href, 'https://example.test/doc');
});

test('hierarchy and service sorting use detail-to-parent order', () => {
  assert.deepEqual(hierarchy({ jenis: 'Jenis', subjenis: 'Subjenis', nama: 'Nama', detil: 'Detil' }).bottomUp,
    ['Detil', 'Nama', 'Subjenis', 'Jenis']);
  const rows = sortRows([
    { jenis: 'B', subjenis: 'Z', nama: 'Z', detil: 'Z' },
    { jenis: 'A', subjenis: 'A', nama: 'A', detil: 'A' },
  ], false, 'service', 'asc');
  assert.equal(rows[0].detil, 'A');
});

test('HAPUS drawer source fields preserve full multiline text', () => {
  const header = Array(24).fill('');
  header[0] = 'ID_LAMA';
  const values = Array(24).fill('');
  Object.assign(values, {
    0: '120180047000003', 1: 'Jenis', 2: 'Subjenis', 3: 'Nama', 4: 'Detil',
    5: 'Satuan', 6: 'Tarif', 15: 'DIHAPUS karena alasan\n- rincian lengkap',
    18: 'UKE', 19: 'Keterangan', 23: 'Penjelasan lengkap - apa adanya\nBaris kedua',
  });
  const { hapusList } = normPP47([header, values]);
  assert.equal(hapusList[0].alasan, values[15]);
  assert.equal(hapusList[0].penjelasan, values[23]);
});
