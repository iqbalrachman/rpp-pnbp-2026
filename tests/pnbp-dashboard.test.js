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
  assert.ok(appScript.length > 50000, 'script aplikasi terlalu pendek');
});

test('script aplikasi lolos pemeriksaan sintaks Node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pnbp-'));
  const file = join(dir, 'app.cjs');
  writeFileSync(file, appScript);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'sintaks tidak valid');
});

test('semua elemen yang dipakai script tersedia di markup', () => {
  const ids = [
    'global-loader', 'loader-title', 'loader-text', 'right-sidebar',
    'global-search', 'table-currency-filter', 'export-btn', 'refresh-btn', 'rs-reload',
    'kpi-tx', 'kpi-vol', 'kpi-avg', 'kpi-entities', 'kpi-satker',
    'insight-total-idr', 'insight-total-usd', 'insight-combined', 'insight-fx-note', 'insight-source',
    'chart-forecast', 'chart-trend', 'chart-top-satker', 'chart-akun', 'chart-cumulative',
    'chart-satker-line', 'chart-layanan-bar', 'chart-payer-pie',
    'forecast-note', 'anomaly-list', 'anomaly-note',
    'top-entity-name', 'top-entity-idr', 'top-entity-usd', 'top-entity-tx', 'top-entity-share',
    'table-body', 'table-info', 'table-pagination',
    'satker-kpi-1', 'satker-kpi-2', 'satker-kpi-3', 'satker-tbody', 'satker-pagination',
    'layanan-kpi-1', 'layanan-kpi-2', 'layanan-kpi-3', 'layanan-tbody', 'layanan-pagination',
    'payer-kpi-1', 'payer-kpi-2', 'payer-kpi-3', 'payer-tbody', 'payer-pagination',
    'quality-score', 'quality-caption', 'quality-bars', 'quality-list', 'quality-export',
    'chat-log', 'chat-input', 'chat-send',
    'settings-dialog', 'cfg-endpoint', 'cfg-fx', 'cfg-cache', 'cfg-snapshot', 'cfg-save', 'cfg-reset',
  ];
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('dashboard punya jalur data GAS, JSONP, snapshot, dan demo', () => {
  assert.match(appScript, /google\.script\.run/);
  assert.match(appScript, /getDashboardPayload/);
  assert.match(appScript, /getDashboardData/);
  assert.match(appScript, /action', 'data'/);
  assert.match(appScript, /callback/);
  assert.match(appScript, /data\/latest\.json/);
  assert.match(appScript, /DEMO_ROWS/);
});

test('snapshot contoh sesuai skema kolom spreadsheet', () => {
  assert.ok(Array.isArray(snapshot.rows) && snapshot.rows.length > 0);
  assert.equal(snapshot.meta.demo, true, 'snapshot contoh harus ditandai demo');
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
});

test('Code.gs menyajikan HTML dan data (JSON/JSONP) tanpa menulis ke sheet', () => {
  assert.match(codeGs, /function doGet\(e\)/);
  assert.match(codeGs, /function getDashboardPayload\(\)/);
  assert.match(codeGs, /function getDashboardData\(\)/);
  assert.match(codeGs, /ContentService[\s\S]*MimeType\.JAVASCRIPT/);
  assert.match(codeGs, /sanitizeCallback_/);
  assert.match(codeGs, /HtmlService\.createHtmlOutputFromFile\('index'\)/);
  assert.doesNotMatch(codeGs, /\.setValue\(|\.appendRow\(|\.setValues\(/);
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

  await new Promise((resolve) => setTimeout(resolve, 1200));
  const doc = dom.window.document;
  const text = (selector) => {
    const el = doc.querySelector(selector);
    return el ? el.textContent.trim() : '';
  };

  assert.equal(text('#kpi-tx'), String(snapshot.rows.length));
  assert.equal(text('#rs-rows'), String(snapshot.rows.length));
  assert.match(text('#insight-total-idr'), /^Rp/);
  assert.ok(doc.querySelectorAll('#table-body tr').length > 1);
  assert.ok(doc.querySelectorAll('#quality-list > div').length > 0);
  assert.deepEqual(errors, []);

  dom.window.close();
});
