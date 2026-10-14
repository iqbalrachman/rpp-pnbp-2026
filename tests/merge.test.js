import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRpp, normRpp } from '../data.js';

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

// Synthetic fixture only; no real service data.
function fixtureValues(overrides = {}) {
  const values = [
    '1', '120180047000003', '3', 'DMP', 'UBAH', 'Jenis', 'Subjenis', 'Nama', 'Detil',
    'route', '4%', 'Output', 'Hukum A', 'Deskripsi', 'Pengguna', 'Rata-rata',
    'Proyeksi contoh', 'Pendapatan contoh', 'Benchmark', 'Dokumen contoh',
  ];
  for (const [key, value] of Object.entries(overrides)) values[Number(key)] = value;
  return values;
}

const rowFrom = (overrides) => normRpp([HEADERS, fixtureValues(overrides)])[0];

test('normRpp emits cols with the same length as the source row', () => {
  const values = fixtureValues();
  const row = normRpp([HEADERS, values])[0];
  assert.equal(row.cols.length, values.length);
  assert.equal(row.cols[16].label, 'Proyeksi Permintaan');
  assert.equal(row.cols[16].text, 'Proyeksi contoh');
});

test('mergeRpp fills empty base cells from other and counts filled', () => {
  const base = [rowFrom({ 16: '', 17: '' })];
  const other = [rowFrom({ 16: 'Proyeksi dari gviz', 17: 'Pendapatan dari gviz' })];
  const result = mergeRpp(base, other);
  assert.equal(base[0].proyeksi, 'Proyeksi dari gviz');
  assert.equal(base[0].pendapatan, 'Pendapatan dari gviz');
  assert.equal(result.filled >= 2, true);
  assert.equal(result.diff, 0);
});

test('mergeRpp keeps base text when both sides differ and counts diff', () => {
  const base = [rowFrom({ 17: 'Pendapatan CSV' })];
  const other = [rowFrom({ 17: 'Pendapatan gviz' })];
  const result = mergeRpp(base, other);
  assert.equal(base[0].pendapatan, 'Pendapatan CSV');
  assert.equal(result.diff, 1);
});

test('mergeRpp does not overwrite rows with duplicate IDs', () => {
  const base = [rowFrom({ 16: '' }), rowFrom({ 16: '' })];
  const other = [rowFrom({ 16: 'Pertama' }), rowFrom({ 16: 'Kedua' })];
  mergeRpp(base, other);
  assert.equal(base[0].proyeksi, 'Pertama');
  assert.equal(base[1].proyeksi, 'Kedua');
});

test('mergeRpp copies richCells.link.links when base has link text but no links', () => {
  const base = [rowFrom({ 19: 'Dokumen contoh' })];
  const other = [rowFrom({ 19: 'Dokumen contoh' })];
  other[0].richCells.link.links = [{ label: 'Dokumen contoh', href: 'https://example.test/doc' }];
  base[0].richCells.link.links = [];
  mergeRpp(base, other);
  assert.equal(base[0].richCells.link.links.length, 1);
  assert.equal(base[0].richCells.link.links[0].href, 'https://example.test/doc');
});

test('mergeRpp leaves cols untouched when lengths differ', () => {
  const base = [rowFrom({ 16: '' })];
  const other = [rowFrom({ 16: 'Proyeksi dari gviz' })];
  other[0].cols = other[0].cols.slice(0, 5);
  mergeRpp(base, other);
  assert.equal(base[0].cols[16].text, '');
});

test('mergeRpp fills cols text by index when lengths match', () => {
  const base = [rowFrom({ 16: '' })];
  const other = [rowFrom({ 16: 'Proyeksi dari gviz' })];
  mergeRpp(base, other);
  assert.equal(base[0].cols[16].text, 'Proyeksi dari gviz');
});
