import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(join(root, 'pnbp-dashboard/index.html'), 'utf8');
const codeGs = readFileSync(join(root, 'pnbp-dashboard/Code.gs'), 'utf8');
const snapshot = JSON.parse(readFileSync(join(root, 'pnbp-dashboard/data/latest.json'), 'utf8'));

const scriptMatch = html.match(/<script id="app-js">([\s\S]*?)<\/script>/);
const appScript = scriptMatch ? scriptMatch[1] : '';

test('dashboard adalah satu file HTML mandiri dengan blok script aplikasi', () => {
  assert.ok(scriptMatch, 'blok <script id="app-js"> tidak ditemukan');
  assert.match(html, /^<!DOCTYPE html>/i);
  assert.ok(html.trim().endsWith('</html>'));
  assert.ok(appScript.length > 60000, 'script aplikasi terlalu pendek');
});

test('script aplikasi lolos pemeriksaan sintaks Node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pnbp-'));
  const file = join(dir, 'app.cjs');
  writeFileSync(file, appScript);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'sintaks tidak valid');
});

test('tidak ada konversi kurs dan tidak ada kurs hardcoded', () => {
  assert.doesNotMatch(appScript, /fxUsdIdr|cfg-fx|ekuivalen|equivalent/);
  assert.doesNotMatch(html, /id="cfg-fx"/);
  assert.ok(!/kurs asumsi/i.test(html), 'masih ada teks kurs asumsi');
  assert.match(html, /tidak ada konversi kurs/i);
  assert.match(appScript, /const valueOfItem = /);
  assert.match(appScript, /valueView === 'USD'/);
});

test('IDR dan USD dipisah di seluruh permukaan data', () => {
  for (const field of ['totalIdr', 'totalUsd', 'avgIdr', 'avgUsd', 'shareIdr', 'shareUsd']) {
    assert.ok(appScript.includes(field), `metrik ${field} tidak ada`);
  }
  // Panel chart terpisah per mata uang
  assert.match(appScript, /function dualPanels/);
  assert.match(appScript, /gridIndex/);
  assert.match(appScript, /IDR \(tanpa konversi\)/);
});

test('semua elemen yang dipakai script tersedia di markup', () => {
  const ids = [
    'global-loader', 'loader-title', 'loader-text', 'right-sidebar',
    'global-search', 'table-currency-filter', 'export-btn', 'refresh-btn', 'rs-reload',
    'global-filter-container', 'value-view-toggle',
    'kpi-idr', 'kpi-usd', 'kpi-tx', 'kpi-vol', 'kpi-entities', 'kpi-satker',
    'kpi-idr-note', 'kpi-usd-note', 'kpi-tx-note', 'kpi-vol-note', 'kpi-entities-note', 'kpi-satker-note',
    'insight-total-idr', 'insight-total-usd', 'insight-count-idr', 'insight-count-usd',
    'insight-source', 'insight-source-dot', 'insight-period',
    'chart-forecast', 'chart-trend', 'chart-top-satker', 'chart-akun', 'chart-cumulative',
    'chart-satker-line', 'chart-ntpn-bar', 'chart-payer-pie', 'chart-target',
    'forecast-note', 'anomaly-list', 'anomaly-note',
    'top-entity-name', 'top-entity-idr', 'top-entity-usd', 'top-entity-tx', 'top-entity-share', 'top-entity-chip',
    'table-body', 'table-info', 'table-pagination',
    'target-kpi-1', 'target-kpi-1-note', 'target-kpi-2', 'target-kpi-2-note',
    'target-kpi-3', 'target-kpi-3-note', 'target-source-chip', 'target-method-note',
    'target-chart-caption', 'target-tbody', 'target-pagination', 'target-export',
    'satker-kpi-1', 'satker-kpi-2', 'satker-kpi-3', 'satker-tbody', 'satker-pagination',
    'ntpn-kpi-1', 'ntpn-kpi-2', 'ntpn-kpi-3', 'ntpn-tbody', 'ntpn-pagination',
    'payer-kpi-1', 'payer-kpi-2', 'payer-kpi-3', 'payer-tbody', 'payer-pagination',
    'quality-score', 'quality-caption', 'quality-bars', 'quality-list', 'quality-export',
    'chat-log', 'chat-input', 'chat-send',
    'settings-dialog', 'cfg-endpoint', 'cfg-cache', 'cfg-snapshot', 'cfg-save', 'cfg-reset',
  ];
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('satu-satunya koneksi data adalah Apps Script (JSONP /exec)', () => {
  assert.match(appScript, /google\.script\.run/);
  assert.match(appScript, /getDashboardPayload/);
  assert.match(appScript, /getDashboardData/);
  assert.match(appScript, /action', 'data'/);
  assert.match(appScript, /callback/);
  assert.match(appScript, /data\/latest\.json/);
  assert.match(appScript, /DEMO_ROWS/);
  // Tidak boleh ada akses langsung ke Google Sheets dari browser
  assert.doesNotMatch(html, /docs\.google\.com|gviz|pub\?output=csv|export\?format=csv/i);
  assert.doesNotMatch(html, /spreadsheets\/d\//);
});

test('NTPN ditampilkan apa adanya (tanpa penggantian label)', () => {
  assert.match(appScript, /ntpn:/);
  assert.doesNotMatch(appScript, /row\.layanan/);
  assert.ok(!/layanan/i.test(appScript.split('FIELD_ALIASES')[1].split('function pickField')[0].replace(/LAYANAN|JENIS LAYANAN|NAMA LAYANAN/g, '')),
    'masih ada field "layanan" terpisah');
  assert.match(html, /NTPN[\s\S]{0,200}apa adanya/);
});

test('target vs realisasi punya mesin pencocokan dan agregasi anti dobel', () => {
  assert.match(appScript, /function evaluateTargets/);
  assert.match(appScript, /function matchTargetRows/);
  assert.match(appScript, /function parseTargetPeriod/);
  assert.match(appScript, /function buildBaselineTargets/);
  assert.match(appScript, /dimension === 'total'/);
  assert.match(appScript, /basis: totalRows\.length \? 'total' : 'unit'/);
  // mencocokkan lewat kode satker, nama satker, wajib bayar, NTPN
  for (const matchType of ["'satker'", "'payer'", "'ntpn'", "'total'"]) {
    assert.ok(appScript.includes(matchType), `matchType ${matchType} tidak ada`);
  }
});

test('snapshot contoh memuat baris + target dan ditandai demo', () => {
  assert.ok(Array.isArray(snapshot.rows) && snapshot.rows.length > 0);
  assert.equal(snapshot.meta.demo, true, 'snapshot contoh harus ditandai demo');
  assert.ok(Array.isArray(snapshot.targets) && snapshot.targets.length > 0, 'target contoh harus ada');

  const required = [
    'NAMA WAJIB BAYAR / SETOR', 'TANGGAL BAYAR', 'KODE KL/UNIT/SATKER', 'KODE BILLING',
    'KODE BANK/POS', 'NTPN', 'NTB/NTP', 'KODE PENERIMAAN', 'KODE PP', 'KODE TARIF',
    'NOMINAL TARIF', 'VOLUME', 'MATA UANG', 'KODE AKUN', 'SETORAN PER AKUN', 'KETERANGAN',
  ];
  for (const row of snapshot.rows) {
    for (const key of required) assert.ok(key in row, `kolom ${key} tidak ada`);
    assert.ok(['IDR', 'USD'].includes(row['MATA UANG']));
    assert.ok(Number(row['SETORAN PER AKUN']) > 0);
  }

  for (const target of snapshot.targets) {
    assert.ok(target.label, 'target tanpa label');
    assert.ok(['IDR', 'USD'].includes(target.currency), 'mata uang target harus IDR/USD');
    assert.ok(Number(target.value) > 0);
    assert.ok(/^\d{4}(-\d{2}|-Q[1-4])?$/.test(target.period), 'periode target tidak valid');
  }
});

test('Code.gs menyajikan HTML, data JSON/JSONP, dan target (read-only)', () => {
  assert.match(codeGs, /function doGet\(e\)/);
  assert.match(codeGs, /function getDashboardPayload\(\)/);
  assert.match(codeGs, /function getDashboardData\(\)/);
  assert.match(codeGs, /function getDashboardTargets\(\)/);
  assert.match(codeGs, /function readWorkbook_\(\)/);
  assert.match(codeGs, /function readTargets_\(\)/);
  assert.match(codeGs, /function detectTargetHeader_\(/);
  assert.match(codeGs, /action === 'targets'/);
  assert.match(codeGs, /ContentService[\s\S]*MimeType\.JAVASCRIPT/);
  assert.match(codeGs, /sanitizeCallback_/);
  assert.match(codeGs, /HtmlService\.createHtmlOutputFromFile\('index'\)/);
  assert.match(codeGs, /CacheService/);
  assert.doesNotMatch(codeGs, /\.setValue\(|\.appendRow\(|\.setValues\(/);
  // Tanpa konstanta kurs / konversi di backend
  assert.doesNotMatch(codeGs, /exchangeRate|KURS_ASUMSI|KURS_RATE|fxUsdIdr/);
  assert.match(codeGs, /Tidak ada konversi kurs/);
});

test('smoke test DOM (dilewati bila jsdom tidak terpasang)', async (t) => {
  let JSDOM;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch (error) {
    t.skip('jsdom tidak terpasang');
    return;
  }

  const errors = [];
  const snapshotText = JSON.stringify(snapshot);
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.github.io/pnbp/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = async (url) => {
        if (String(url).includes('latest.json')) {
          return { ok: true, status: 200, json: async () => JSON.parse(snapshotText) };
        }
        throw new Error('offline');
      };
      window.console.error = (...args) => errors.push(args.join(' '));
      window.echarts = {
        init: () => ({ setOption() {}, clear() {}, resize() {}, isDisposed: () => false }),
      };
      window.addEventListener('error', (event) => errors.push(String(event.message)));
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 1400));
  const doc = dom.window.document;
  const text = (selector) => {
    const el = doc.querySelector(selector);
    return el ? el.textContent.trim() : '';
  };

  assert.equal(text('#kpi-tx'), String(snapshot.rows.length));
  assert.equal(text('#rs-rows'), String(snapshot.rows.length));
  assert.match(text('#insight-total-idr'), /^Rp/);
  assert.match(text('#insight-total-usd'), /^\$/);
  assert.ok(doc.querySelectorAll('#table-body tr').length > 1);
  assert.equal(doc.querySelectorAll('#target-tbody tr').length, Math.min(10, snapshot.targets.length));
  assert.match(text('#target-kpi-2'), /%$/);
  assert.ok(doc.querySelectorAll('#ntpn-tbody tr').length > 0);
  assert.ok(doc.querySelectorAll('#quality-list > div').length > 0);
  assert.deepEqual(errors, []);

  dom.window.close();
});
