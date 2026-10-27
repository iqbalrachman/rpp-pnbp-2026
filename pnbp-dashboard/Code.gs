/**
 * ============================================================================
 * Pembayaran PNBP BMKG — Backend Google Apps Script
 * ----------------------------------------------------------------------------
 * Satu project Apps Script berisi dua file:
 *   1. Code.gs   (file ini)
 *   2. index.html (dashboard hasil ekspor, file HTML tunggal)
 *
 * Fungsi utama:
 *   - doGet()  -> menyajikan dashboard (HTML) atau data (JSON / JSONP)
 *   - getDashboardPayload() / getDashboardData() -> untuk google.script.run
 *
 * Deploy:
 *   Deploy > New deployment > Web app
 *     Execute as        : Me
 *     Who has access    : Anyone
 *   Salin URL /exec, tempel ke APP_CONFIG.gasEndpoint di index.html.
 *
 * Spreadsheet bersifat credential: hanya script ini yang membukanya (execute as
 * pemilik). Dashboard di GitHub Pages hanya menerima data olahan lewat JSONP,
 * sehingga ID spreadsheet tidak pernah terekspos ke browser.
 *
 * Tidak ada konversi kurs. Setoran IDR dan USD dikirim apa adanya dengan label
 * mata uangnya; dashboard memisahkan keduanya.
 *
 * Tidak ada fungsi yang menulis ke spreadsheet. Hanya baca.
 * ============================================================================
 */

/** ------------------------------- KONFIGURASI ------------------------------ */
const SHEET_CONFIG = {
  // Kosongkan bila script terpasang langsung di spreadsheet (container-bound).
  SPREADSHEET_ID: '',
  // Kosongkan untuk memakai sheet pertama.
  SHEET_NAME: '',
  // Baris header dicari otomatis pada N baris pertama.
  HEADER_SCAN_ROWS: 25,
  // Cache payload (detik). 0 = tanpa cache.
  CACHE_SECONDS: 300,
  // Versi payload; naikkan bila struktur berubah agar cache lama tidak dipakai.
  API_VERSION: '3',
};

const CACHE_PREFIX = 'pnbp:payload:v' + SHEET_CONFIG.API_VERSION + ':';
const CACHE_CHUNK_SIZE = 90000; // batas aman per item CacheService (100 KB)

/**
 * Alias header. Kunci = nama field internal, nilai = kemungkinan header di sheet.
 * Pencocokan: persis -> case-insensitive -> mengandung.
 */
const FIELD_ALIASES = {
  payer: ['NAMA WAJIB BAYAR / SETOR', 'NAMA WAJIB BAYAR/SETOR', 'NAMA WAJIB BAYAR', 'WAJIB BAYAR', 'PAYER'],
  date: ['TANGGAL BAYAR', 'TANGGAL SETOR', 'TANGGAL', 'DATE'],
  satker: ['KODE KL/UNIT/SATKER', 'KODE KL / UNIT / SATKER', 'KODE KL', 'SATKER', 'UNIT'],
  billing: ['KODE BILLING', 'BILLING'],
  bankPos: ['KODE BANK/POS', 'KODE BANK / POS', 'KODE BANK', 'BANK POS'],
  ntpn: ['NTPN', 'LAYANAN', 'JENIS LAYANAN', 'NAMA LAYANAN'],
  ntb: ['NTB/NTP', 'NTB / NTP', 'NTB', 'NTP'],
  penerimaan: ['KODE PENERIMAAN', 'KODE PENERIMAAN (F)'],
  kodePP: ['KODE PP', 'PP'],
  kodeTarif: ['KODE TARIF', 'TARIF'],
  nominalTarif: ['NOMINAL TARIF', 'TARIF SATUAN', 'NOMINAL'],
  volume: ['VOLUME', 'VOL'],
  currency: ['MATA UANG', 'CURRENCY'],
  akun: ['KODE AKUN', 'AKUN'],
  amount: ['SETORAN PER AKUN', 'SETORAN', 'JUMLAH SETORAN', 'NILAI SETORAN', 'AMOUNT'],
  keterangan: ['KETERANGAN', 'DESKRIPSI', 'CATATAN', 'KET'],
};

/** ------------------------------- KONFIGURASI TARGET ----------------------- */
const TARGET_CONFIG = {
  // Nama sheet target. Kosong = dicari otomatis (nama mengandung "target"/"pagu").
  SHEET_NAME: '',
  HEADER_SCAN_ROWS: 15,
};

/**
 * Alias kolom sheet target. Dicocokkan persis -> case-insensitive -> mengandung.
 * Semua opsional: yang wajib hanya kolom nilai target.
 */
const TARGET_ALIASES = {
  satkerCode: ['KODE KL/UNIT/SATKER', 'KODE KL / UNIT / SATKER', 'KODE SATKER', 'KODE UNIT', 'KODE KL', 'KODE'],
  satkerName: ['NAMA SATKER', 'SATKER', 'UNIT', 'URAIAN SATKER', 'NAMA UNIT'],
  payerName: ['NAMA WAJIB BAYAR / SETOR', 'NAMA WAJIB BAYAR', 'WAJIB BAYAR'],
  ntpnName: ['NTPN', 'LAYANAN'],
  label: ['LABEL', 'URAIAN', 'NAMA', 'TARGET'],
  period: ['PERIODE', 'PERIODE TARGET', 'BULAN', 'TAHUN', 'YEAR', 'TRIWULAN'],
  currency: ['MATA UANG', 'CURRENCY', 'KURS'],
  value: ['TARGET', 'NILAI TARGET', 'JUMLAH TARGET', 'TARGET PNBP', 'TARGET PENERIMAAN', 'PAGU', 'PAGU TARGET'],
  note: ['CATATAN', 'KETERANGAN', 'NOTE', 'SUMBER'],
};

/** Satker "437174 - NAMA" -> { code, name } */
function splitSatker_(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{3,})\s*[-–—:]\s*(.+)$/);
  if (match) return { code: match[1], name: match[2].trim() };
  return { code: '', name: text };
}

function lookupAlias_(label, aliases) {
  const normalized = String(label || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (aliases.indexOf(normalized) >= 0) return true;
  for (let i = 0; i < aliases.length; i += 1) {
    if (normalized.indexOf(aliases[i]) >= 0) return true;
  }
  return false;
}

/**
 * Deteksi header sheet target.
 * Mendukung dua bentuk:
 *  a) panjang : satu kolom TARGET + kolom PERIODE/TAHUN (+ MATA UANG)
 *  b) lebar   : beberapa kolom "TARGET 2026", "TARGET 2026 IDR", "TARGET Q1 2026"
 */
function detectTargetHeader_(display) {
  const scanLimit = Math.min(display.length, TARGET_CONFIG.HEADER_SCAN_ROWS);
  let best = null;

  for (let r = 0; r < scanLimit; r += 1) {
    const labels = (display[r] || []).map(function (value) { return String(value || '').trim(); });
    if (!labels.length) continue;

    const columns = { value: [], period: [], currency: [], satkerCode: [], satkerName: [], payerName: [], ntpnName: [], label: [], note: [] };
    let hits = 0;

    labels.forEach(function (label, c) {
      if (!label) return;
      const upper = label.toUpperCase().replace(/\s+/g, ' ');

      // kolom target per tahun / per tahun+mata uang
      const yearMatch = upper.match(/^(?:TARGET|PAGU)\s*(?:20\d{2}|TAHUN\s*20\d{2}|Q[1-4]\s*20\d{2}|20\d{2}\s*Q[1-4])/);
      const isTargetHeader = lookupAlias_(upper, TARGET_ALIASES.value);
      if (yearMatch || (isTargetHeader && !lookupAlias_(upper, TARGET_ALIASES.period))) {
        const yearInHeader = upper.match(/(20\d{2})/);
        const quarterInHeader = upper.match(/Q([1-4])/);
        let currencyInHeader = '';
        if (/\bUSD\b/.test(upper)) currencyInHeader = 'USD';
        else if (/\bIDR\b/.test(upper)) currencyInHeader = 'IDR';

        let period = '';
        if (yearInHeader) {
          period = quarterInHeader
            ? yearInHeader[1] + '-Q' + quarterInHeader[1]
            : yearInHeader[1];
        }
        columns.value.push({ column: c, year: yearInHeader ? yearInHeader[1] : '', period: period, currency: currencyInHeader });
        hits += 1;
        return;
      }

      if (lookupAlias_(upper, TARGET_ALIASES.satkerCode)) { columns.satkerCode.push(c); return; }
      if (lookupAlias_(upper, TARGET_ALIASES.satkerName)) { columns.satkerName.push(c); return; }
      if (lookupAlias_(upper, TARGET_ALIASES.payerName)) { columns.payerName.push(c); return; }
      if (lookupAlias_(upper, TARGET_ALIASES.ntpnName)) { columns.ntpnName.push(c); return; }
      if (lookupAlias_(upper, TARGET_ALIASES.period)) { columns.period.push(c); return; }
      if (lookupAlias_(upper, TARGET_ALIASES.currency)) { columns.currency.push(c); return; }
      if (lookupAlias_(upper, TARGET_ALIASES.label)) { columns.label.push(c); return; }
      if (lookupAlias_(upper, TARGET_ALIASES.note)) { columns.note.push(c); return; }
    });

    if (columns.value.length && hits >= 1) {
      const score = hits + (columns.satkerCode.length || columns.satkerName.length ? 2 : 0);
      if (!best || score > best.score) {
        best = { rowIndex: r, labels: labels, columns: columns, score: score };
      }
    }
  }

  return best;
}

/**
 * Baca sheet target dan normalisasi menjadi daftar target.
 * Setiap entri: { label, dimension, satkerCode, satkerName, payerName, ntpnName,
 *                period, currency, value, source, note }
 */
function readTargets_() {
  const spreadsheet = SHEET_CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(SHEET_CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) {
    return { targets: [], meta: { mode: 'none', note: 'Spreadsheet tidak ditemukan.' } };
  }

  let sheets = TARGET_CONFIG.SHEET_NAME
    ? [spreadsheet.getSheetByName(TARGET_CONFIG.SHEET_NAME)].filter(Boolean)
    : spreadsheet.getSheets().filter(function (sheet) {
      return /target|pagu/i.test(sheet.getName());
    });

  // Fallback "pintar": bila tidak ada sheet bernama target, periksa sheet lain
  // (kecuali sheet data transaksi) dan pakai yang punya header target.
  if (!sheets.length) {
    const dataSheetName = SHEET_CONFIG.SHEET_NAME
      || (spreadsheet.getSheets()[0] && spreadsheet.getSheets()[0].getName());
    const others = spreadsheet.getSheets().filter(function (sheet) {
      return sheet.getName() !== dataSheetName;
    });
    const detected = [];
    others.forEach(function (sheet) {
      const display = sheet.getDataRange().getDisplayValues();
      if (detectTargetHeader_(display)) detected.push(sheet);
    });
    sheets = detected;
  }

  if (!sheets.length) {
    return {
      targets: [],
      meta: {
        mode: 'none',
        note: 'Sheet bernama "TARGET"/"PAGU" tidak ditemukan. Buat sheet target berisi kolom: label satker, periode, mata uang, dan nilai target.',
        candidates: spreadsheet.getSheets().map(function (sheet) { return sheet.getName(); }),
      },
    };
  }

  const targets = [];
  const usedSheets = [];

  sheets.forEach(function (sheet) {
    const range = sheet.getDataRange();
    const values = range.getValues();
    const display = range.getDisplayValues();
    const header = detectTargetHeader_(display);
    if (!header) return;

    usedSheets.push({ name: sheet.getName(), headerRow: header.rowIndex + 1, columns: header.columns.value.length });

    for (let r = header.rowIndex + 1; r < values.length; r += 1) {
      const rawRow = values[r] || [];
      const displayRow = display[r] || [];
      if (isBlankRow_(displayRow)) continue;

      const codeRaw = header.columns.satkerCode.length ? displayRow[header.columns.satkerCode[0]] : '';
      const nameRaw = header.columns.satkerName.length ? displayRow[header.columns.satkerName[0]] : '';
      const payerRaw = header.columns.payerName.length ? displayRow[header.columns.payerName[0]] : '';
      const ntpnRaw = header.columns.ntpnName.length ? displayRow[header.columns.ntpnName[0]] : '';
      const labelRaw = header.columns.label.length ? displayRow[header.columns.label[0]] : '';
      const periodRaw = header.columns.period.length ? String(displayRow[header.columns.period[0]] || '').trim() : '';
      const currencyRaw = header.columns.currency.length
        ? String(displayRow[header.columns.currency[0]] || '').trim().toUpperCase()
        : '';
      const noteRaw = header.columns.note.length ? displayRow[header.columns.note[0]] : '';

      const fromCode = splitSatker_(codeRaw);
      const fromName = splitSatker_(nameRaw);
      const satkerCode = fromCode.code || fromName.code || '';
      const satkerName = fromName.name || fromCode.name || String(nameRaw || '').trim();
      const payerName = String(payerRaw || '').trim();
      const ntpnName = String(ntpnRaw || '').trim();

      let dimension = 'total';
      if (satkerCode || satkerName) dimension = 'satker';
      else if (payerName) dimension = 'payer';
      else if (ntpnName) dimension = 'ntpn';

      const label = String(labelRaw || '').trim()
        || (satkerCode && satkerName ? satkerCode + ' - ' + satkerName : '')
        || satkerName || payerName || ntpnName || 'Seluruh satker';

      header.columns.value.forEach(function (entry) {
        const rawValue = rawRow[entry.column];
        const value = typeof rawValue === 'number' ? rawValue : parseNumber_(rawValue);
        if (!isFinite(value)) return;

        let currency = entry.currency || currencyRaw;
        if (currency !== 'USD') currency = 'IDR'; // default IDR

        const period = entry.period || periodRaw;
        if (!period && !entry.period) {
          // tanpa periode: target dianggap berlaku untuk semua periode
        }

        targets.push({
          label: label,
          dimension: dimension,
          satkerCode: satkerCode,
          satkerName: satkerName,
          payerName: payerName,
          ntpnName: ntpnName,
          period: period || '',
          currency: currency,
          value: value,
          source: 'sheet:' + sheet.getName(),
          note: String(noteRaw || '').trim(),
        });
      });
    }
  });

  return {
    targets: targets,
    meta: {
      mode: targets.length ? 'sheet' : 'none',
      sheets: usedSheets,
      count: targets.length,
      note: targets.length
        ? 'Target dibaca dari sheet ' + usedSheets.map(function (item) { return item.name; }).join(', ')
          + ' dan dicocokkan otomatis dengan kode satker, nama satker, wajib bayar, atau NTPN.'
        : 'Sheet target ditemukan tetapi tidak ada nilai target yang terbaca. Pastikan ada kolom TARGET (atau TARGET 2026) berisi angka.',
    },
  };
}

/** Jalankan dari editor untuk memeriksa hasil baca sheet target. */
function debugReadTargets() {
  const result = readTargets_();
  Logger.log(JSON.stringify(result.meta, null, 2));
  Logger.log(JSON.stringify(result.targets.slice(0, 5), null, 2));
  return result.meta;
}

/** --------------------------------- ROUTER -------------------------------- */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || '').toLowerCase();

  if (action === 'data' || action === 'json') return respondData_(params);
  if (action === 'health') return respondJson_({ ok: true, version: SHEET_CONFIG.API_VERSION, time: new Date().toISOString() });
  if (action === 'meta') return respondJson_({ ok: true, meta: readWorkbook_().meta });
  if (action === 'targets') {
    const info = readTargets_();
    return respondJson_({ ok: true, targets: info.targets, meta: info.meta });
  }

  return renderDashboard_();
}

/** Sajikan dashboard (HTML tunggal). */
function renderDashboard_() {
  const template = HtmlService.createHtmlOutputFromFile('index');
  return template
    .setTitle('Pembayaran PNBP BMKG')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Endpoint data: JSONP bila ada ?callback=, selain itu JSON biasa. */
function respondData_(params) {
  const callback = sanitizeCallback_(params.callback);
  let payload;

  try {
    payload = getPayload_();
  } catch (err) {
    payload = {
      ok: false,
      error: String((err && err.message) || err),
      rows: [],
      meta: { error: true, version: SHEET_CONFIG.API_VERSION },
    };
  }

  const body = JSON.stringify(payload);

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

function respondJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Hanya izinkan nama callback JS yang valid (mencegah injeksi skrip). */
function sanitizeCallback_(callback) {
  const value = String(callback || '').trim();
  if (!value) return '';
  return /^[A-Za-z_$][A-Za-z0-9_$.]{0,80}$/.test(value) ? value : '';
}

/** -------------------------- API UNTUK google.script.run ------------------ */
/** Payload lengkap (rows + meta) — dipakai dashboard versi baru. */
function getDashboardPayload() {
  return getPayload_();
}

/** Array baris saja — kompatibel dengan dashboard versi lama. */
function getDashboardData() {
  return getPayload_().rows;
}

/** Target saja (untuk integrasi lain). */
function getDashboardTargets() {
  const result = readTargets_();
  return { ok: true, targets: result.targets, meta: result.meta };
}

/** Info ringkas untuk debugging di editor Apps Script. */
function getDashboardMeta() {
  return getPayload_().meta;
}

/**
 * Payload dengan cache. Cache dipecah per 90 KB agar tidak melewati
 * batas 100 KB per item CacheService.
 */
function getPayload_() {
  if (!(SHEET_CONFIG.CACHE_SECONDS > 0)) return readWorkbook_();

  const key = CACHE_PREFIX + (SHEET_CONFIG.SHEET_NAME || 'first') + ':' + (SHEET_CONFIG.SPREADSHEET_ID || 'bound');
  try {
    const cached = cacheRead_(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.rows) && parsed.rows.length) {
        parsed.meta = Object.assign({}, parsed.meta, { cached: true });
        return parsed;
      }
    }
  } catch (err) {
    // cache korup / gagal: lanjut baca sheet
  }

  const fresh = readWorkbook_();
  try {
    cacheWrite_(key, JSON.stringify(fresh), SHEET_CONFIG.CACHE_SECONDS);
  } catch (err) {
    // kuota cache habis: abaikan
  }
  return fresh;
}

function cacheRead_(key) {
  const cache = CacheService.getScriptCache();
  const count = Number(cache.get(key + ':n') || 0);
  if (!count) return null;
  const keys = [];
  for (let i = 0; i < count; i += 1) keys.push(key + ':' + i);
  const parts = cache.getAll(keys);
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const part = parts[key + ':' + i];
    if (part == null) return null;
    out += part;
  }
  return out;
}

function cacheWrite_(key, value, seconds) {
  const cache = CacheService.getScriptCache();
  const chunks = [];
  for (let i = 0; i < value.length; i += CACHE_CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CACHE_CHUNK_SIZE));
  }
  // Batas CacheService adalah 1000 key; batasi jumlah chunk.
  if (chunks.length > 40) return;

  const map = {};
  chunks.forEach((chunk, i) => { map[key + ':' + i] = chunk; });
  map[key + ':n'] = String(chunks.length);
  cache.putAll(map, Math.min(seconds, 21600));
}

/** ------------------------------- BACA SHEET ------------------------------ */

/**
 * Payload lengkap: baris transaksi + target.
 * Baris transaksi dan target dibaca dari spreadsheet yang sama; target dicari
 * pada sheet yang namanya mengandung "target"/"pagu".
 */
function readWorkbook_() {
  const payload = readSheet_();
  const targetInfo = readTargets_();
  if (targetInfo.targets.length) {
    payload.targets = targetInfo.targets;
    payload.targetsMeta = targetInfo.meta;
  } else {
    payload.targets = [];
    payload.targetsMeta = { mode: 'none', note: targetInfo.meta.note || 'Sheet target tidak ditemukan.' };
  }
  return payload;
}
function readSheet_() {
  const started = Date.now();
  const spreadsheet = SHEET_CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(SHEET_CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!spreadsheet) throw new Error('Spreadsheet tidak ditemukan. Isi SHEET_CONFIG.SPREADSHEET_ID.');

  const sheet = SHEET_CONFIG.SHEET_NAME
    ? spreadsheet.getSheetByName(SHEET_CONFIG.SHEET_NAME)
    : spreadsheet.getSheets()[0];

  if (!sheet) throw new Error('Sheet "' + SHEET_CONFIG.SHEET_NAME + '" tidak ditemukan.');

  const range = sheet.getDataRange();
  const raw = range.getValues();
  const display = range.getDisplayValues();
  const timezone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'Asia/Jakarta';

  const header = detectHeader_(display);
  if (!header) {
    throw new Error('Header tidak dikenali. Pastikan ada kolom seperti "NAMA WAJIB BAYAR / SETOR" dan "SETORAN PER AKUN".');
  }

  const rows = [];

  for (let r = header.rowIndex + 1; r < raw.length; r += 1) {
    const rawRow = raw[r] || [];
    const displayRow = display[r] || [];
    if (isBlankRow_(displayRow)) continue;

    const row = {};
    const used = {};
    header.entries.forEach((entry) => {
      if (!entry.label) return;
      // Header duplikat diberi akhiran agar tidak saling menimpa.
      used[entry.label] = (used[entry.label] || 0) + 1;
      const key = used[entry.label] > 1 ? entry.label + ' (' + used[entry.label] + ')' : entry.label;
      row[key] = cellValue_(rawRow[entry.column], displayRow[entry.column], entry.field, timezone);
    });

    // Baris tetap dikirim apa adanya; pemeriksaan kualitas (tanggal kosong,
    // setoran nol, duplikat NTB, dan lain-lain) dilakukan di dashboard.
    rows.push(row);
  }

  return {
    ok: true,
    rows,
    meta: {
      version: SHEET_CONFIG.API_VERSION,
      spreadsheetId: spreadsheet.getId(),
      spreadsheetName: spreadsheet.getName(),
      sheetName: sheet.getName(),
      headerRow: header.rowIndex + 1,
      columns: header.entries.map(function (entry) { return entry.label; }),
      rowCount: rows.length,
      timezone,
      capturedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      cached: false,
    },
  };
}

/**
 * Cari baris header: baris dengan jumlah alias terbanyak (minimal 3).
 * Mengembalikan { rowIndex, labels, mapping } dengan mapping[label] = field.
 */
function detectHeader_(display) {
  const scanLimit = Math.min(display.length, SHEET_CONFIG.HEADER_SCAN_ROWS);
  let best = null;

  for (let r = 0; r < scanLimit; r += 1) {
    const labels = (display[r] || []).map(function (value) { return String(value || '').trim(); });
    const entries = [];
    let hits = 0;

    labels.forEach(function (label, c) {
      if (!label) return;
      const field = fieldForHeader_(label);
      if (field) {
        entries.push({ label: label, column: c, field: field });
        hits += 1;
      }
    });

    if (hits >= 3 && (!best || hits > best.hits)) {
      best = { rowIndex: r, labels: labels, entries: entries, hits: hits };
    }
  }

  return best;
}

function fieldForHeader_(label) {
  const normalized = String(label || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!normalized) return '';
  const fields = Object.keys(FIELD_ALIASES);

  for (let i = 0; i < fields.length; i += 1) {
    const aliases = FIELD_ALIASES[fields[i]];
    if (aliases.indexOf(normalized) >= 0) return fields[i];
  }
  for (let i = 0; i < fields.length; i += 1) {
    const aliases = FIELD_ALIASES[fields[i]];
    for (let j = 0; j < aliases.length; j += 1) {
      if (normalized.indexOf(aliases[j]) >= 0) return fields[i];
    }
  }
  return '';
}

function isBlankRow_(row) {
  for (let i = 0; i < row.length; i += 1) {
    if (String(row[i] || '').trim()) return false;
  }
  return true;
}

/**
 * Konversi satu sel:
 *  - tanggal -> "YYYY-MM-DD"
 *  - nominal  -> Number
 *  - kode panjang -> teks tanpa notasi eksponen bila memungkinkan
 */
function cellValue_(rawValue, displayValue, field, timezone) {
  const display = String(displayValue == null ? '' : displayValue).trim();

  if (field === 'date') {
    if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
      return Utilities.formatDate(rawValue, timezone, 'yyyy-MM-dd');
    }
    return display;
  }

  if (field === 'nominalTarif' || field === 'volume' || field === 'amount') {
    if (typeof rawValue === 'number' && isFinite(rawValue)) return rawValue;
    return parseNumber_(display);
  }

  // Kode panjang: jangan kirim notasi eksponen ke dashboard.
  if (field === 'billing' || field === 'bankPos' || field === 'ntb') {
    if (/E\+/i.test(display) && typeof rawValue === 'number' && isFinite(rawValue)) {
      return bigNumberToString_(rawValue);
    }
    return display;
  }

  if (field === 'currency') {
    const cur = display.toUpperCase().replace(/[^A-Z]/g, '');
    return cur || 'IDR';
  }

  return display;
}

/** 8.2e18 -> "8200000000000000000" (presisi sheet mungkin sudah hilang) */
function bigNumberToString_(value) {
  if (Number.isInteger(value) && Math.abs(value) < 1e21) {
    return value.toLocaleString('fullwide', { useGrouping: false });
  }
  return String(value);
}

/** Parser angka toleran: "1.234,56", "Rp 1.000.000", "(2.500)", "4.20E+5" */
function parseNumber_(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return isFinite(value) ? value : 0;

  let text = String(value).trim();
  if (!text || /^[-–—]+$/.test(text)) return 0;

  const negative = /^\(.*\)$/.test(text) || text.charAt(0) === '-';
  text = text.replace(/[^\d.,]/g, '');
  if (!text) return 0;

  const hasComma = text.indexOf(',') >= 0;
  const hasDot = text.indexOf('.') >= 0;

  if (hasComma && hasDot) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.')
      ? text.replace(/\./g, '').replace(/,/g, '.')
      : text.replace(/,/g, '');
  } else if (hasComma) {
    const parts = text.split(',');
    text = (parts.length === 2 && parts[1].length <= 2) ? text.replace(',', '.') : text.replace(/,/g, '');
  } else if (hasDot) {
    const parts = text.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3)) {
      text = text.replace(/\./g, '');
    }
  }

  const number = Number(text);
  if (!isFinite(number)) return 0;
  return negative ? -number : number;
}

/** ------------------------------- UTILITAS -------------------------------- */

/** Jalankan manual dari editor untuk memeriksa hasil baca sheet. */
function debugReadSheet() {
  const payload = readSheet_();
  Logger.log(JSON.stringify(payload.meta, null, 2));
  Logger.log(JSON.stringify(payload.rows.slice(0, 2), null, 2));
  return payload.meta;
}

/** Hapus cache payload (jalankan setelah memperbarui data penting). */
function clearDashboardCache() {
  const cache = CacheService.getScriptCache();
  const id = SHEET_CONFIG.SPREADSHEET_ID || 'bound';
  const sheet = SHEET_CONFIG.SHEET_NAME || 'first';
  const base = CACHE_PREFIX + sheet + ':' + id;
  const keys = [base + ':n'];
  for (let i = 0; i < 40; i += 1) keys.push(base + ':' + i);
  cache.removeAll(keys);
  Logger.log('Cache dashboard dibersihkan untuk ' + base);
}
