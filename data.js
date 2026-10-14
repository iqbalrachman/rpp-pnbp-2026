/* ============================================================================
 * data.js — pure data layer for RPP PNBP BMKG 2026
 * No DOM, no framework. Safe to import from node for testing.
 * ==========================================================================*/

export const CONFIG = {
  // Primary workbook (DATA_DUKUNG) — supports gviz + JSONP
  DATA_DUKUNG_ID: '1WkxCayIVb0I4AjCscD2ICFQDWh2eBiDwnroi4usIsLs',
  // "Publish to web" ids (CORS enabled: Access-Control-Allow-Origin: *)
  PUB_RPP: '2PACX-1vQio69IIRv2PuVTLX-s0rCs1dlBC2JEkoYIc6-6QdRTo990YeaY_ejlyS0sDSLm7n9B-VGnK-DRg3Mz',
  PUB_HAPUS: '2PACX-1vQl8WD78QiZyVbKSJe6uP0h2jFmJig16b4LG-GLgB8zmg9KmpggcYVkAD_BA7U6TtUa3ZVzSdi5vxnf',
  // Human links (for empty-state / provenance)
  RPP_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1WkxCayIVb0I4AjCscD2ICFQDWh2eBiDwnroi4usIsLs/edit',
  HAPUS_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1vYuEb3PUA7UVfamqrWwhjXMvXstAihYfwSEG7fcscAE/edit',
  RPP_SHEET_NAME: 'DATA_DUKUNG',
};

/* ---------------------------------------------------------------------------
 * Source candidates. Each entry: { id, label, kind: 'jsonp'|'fetch', format }
 * Tried in order; first one that yields usable rows wins.
 * -------------------------------------------------------------------------*/
export function rppSources() {
  const d = CONFIG.DATA_DUKUNG_ID;
  const gviz = `https://docs.google.com/spreadsheets/d/${d}/gviz/tq`;
  return [
    { id: 'gviz-jsonp', label: 'gviz JSON (JSONP)', kind: 'jsonp', format: 'json',
      url: `${gviz}?tqx=out:json&sheet=${CONFIG.RPP_SHEET_NAME}` },
    { id: 'pub-csv', label: 'Published CSV (CORS ok)', kind: 'fetch', format: 'csv',
      url: `https://docs.google.com/spreadsheets/d/e/${CONFIG.PUB_RPP}/pub?output=csv&gid=0` },
    { id: 'gviz-json', label: 'gviz JSON (fetch)', kind: 'fetch', format: 'json',
      url: `${gviz}?tqx=out:json&sheet=${CONFIG.RPP_SHEET_NAME}` },
    { id: 'gviz-csv', label: 'gviz CSV (fetch)', kind: 'fetch', format: 'csv',
      url: `${gviz}?tqx=out:csv&sheet=${CONFIG.RPP_SHEET_NAME}` },
    { id: 'export-csv', label: 'Export CSV (fetch)', kind: 'fetch', format: 'csv',
      url: `https://docs.google.com/spreadsheets/d/${d}/export?format=csv&sheet=${CONFIG.RPP_SHEET_NAME}` },
  ];
}

// HAPUS detail: only the published (CORS) copy is reachable; gviz 404s on /d/e/.
// We still loop gid 0..10 as the spec requires, and stop at the first usable tab.
export function hapusSources() {
  const out = [];
  for (let gid = 0; gid <= 10; gid++) {
    out.push({
      id: `pub-csv-gid${gid}`,
      label: `Published CSV gid=${gid}`,
      kind: 'fetch',
      format: 'csv',
      url: `https://docs.google.com/spreadsheets/d/e/${CONFIG.PUB_HAPUS}/pub?output=csv&gid=${gid}`,
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * CSV parser (RFC 4180: quotes, "" escapes, embedded newlines).
 * -------------------------------------------------------------------------*/
export function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

/* Extract cell text and hyperlink metadata without flattening gviz cells to strings. */
function decodeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripCellHtml(value) {
  const source = String(value == null ? '' : value);
  if (!/<(?:a|br|div|p|span)\b/i.test(source)) return source;
  return decodeHtml(source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ''));
}

function safeHref(value) {
  const href = decodeHtml(String(value == null ? '' : value).trim());
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : '';
}

function extractCellLinks(value) {
  const source = String(value == null ? '' : value);
  const links = [];
  const add = (href, label = '') => {
    const safe = safeHref(href);
    if (safe && !links.some((link) => link.href === safe)) links.push({ href: safe, label: stripCellHtml(label) || safe });
  };
  const anchors = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = anchors.exec(source))) add(match[2], match[3]);
  const urls = source.match(/https?:\/\/[^\s<>"']+/gi) || [];
  urls.forEach((url) => add(url.replace(/[),.;!?]+$/, ''), url.replace(/[),.;!?]+$/, '')));
  return links;
}

function linksFromMetadata(meta) {
  const links = [];
  const visit = (value, key = '', depth = 0) => {
    if (depth > 6 || value == null) return;
    if (typeof value === 'string') {
      if (/href|url|link|hyperlink|target/i.test(key)) {
        const direct = safeHref(value);
        if (direct) links.push({ href: direct, label: direct });
      }
      for (const link of extractCellLinks(value)) links.push(link);
      return;
    }
    if (Array.isArray(value)) { value.forEach((item) => visit(item, key, depth + 1)); return; }
    if (typeof value === 'object') {
      Object.entries(value).forEach(([childKey, child]) => visit(child, childKey, depth + 1));
    }
  };
  visit(meta);
  return links.filter((link, index) => links.findIndex((x) => x.href === link.href) === index);
}

function makeGvizCell(cell) {
  if (!cell) return { __sheetCell: true, text: '', links: [] };
  const formatted = cell.f !== undefined && cell.f !== null && cell.f !== '' ? cell.f : cell.v;
  const rawText = formatted === undefined || formatted === null ? '' : String(formatted);
  const links = [
    ...extractCellLinks(rawText),
    ...extractCellLinks(cell.v),
    ...linksFromMetadata(cell),
  ].filter((link, index, all) => all.findIndex((item) => item.href === link.href) === index);
  return { __sheetCell: true, text: stripCellHtml(rawText), links };
}

/* gviz JSON -> rows, preserving both formatted text and any exposed cell links. */
export function gvizToRows(json) {
  const table = (json && json.table) || {};
  const rows = table.rows || [];
  const values = rows.map((row) => (row.c || []).map(makeGvizCell));
  const headers = (table.cols || []).map((column) => String((column && (column.label || column.id)) || ''));
  return headers.some(Boolean) ? [headers, ...values] : values;
}

/* ---------------------------------------------------------------------------
 * Positional fallback for sources that do not provide column headers.
 * When headers exist, normRpp resolves columns by their names first.
 * -------------------------------------------------------------------------*/
export const DD = {
  NO: 1, ID_LAMA: 2, ID_BARU: 3, UKE: 4, KATEGORI: 5, JENIS: 6, SUBJENIS: 7,
  NAMA: 8, DETIL: 9, SATUAN: 10, TARIF: 11, OUTPUT: 12, HUKUM: 13,
  DESKRIPSI: 14, PENGGUNA: 15, RATA3: 16, PROYEKSI: 17, PENDAPATAN: 18,
  BENCH: 19, LINK: 20,
};

const KATEGORI_SET = new Set(['BARU', 'UBAH', 'TETAP', 'HAPUS']);

const RPP_HEADER_ALIASES = {
  NO: ['NO', 'NOMOR'],
  ID_LAMA: ['IDLAMA'],
  ID_BARU: ['IDBARU'],
  UKE: ['UKEII', 'UKE2', 'UKE'],
  KATEGORI: ['KATEGORI'],
  JENIS: ['JENIS'],
  SUBJENIS: ['SUBJENIS'],
  NAMA: ['NAMALAYANAN', 'NAMA'],
  DETIL: ['NAMADETILLAYANAN', 'NAMADETAILLAYANAN', 'DETILLAYANAN', 'DETAILLAYANAN', 'DETIL', 'DETAIL'],
  SATUAN: ['SATUAN'],
  TARIF: ['TARIF'],
  OUTPUT: ['OUTPUTTIPEDATA', 'OUTPUT'],
  HUKUM: ['DASARHUKUM', 'HUKUM'],
  DESKRIPSI: ['DESKRIPSILAYANAN', 'DESKRIPSI'],
  PENGGUNA: ['PENGGUNASAATINIDANATAUSASARANPENGGUNA', 'PENGGUNA'],
  RATA3: ['RATARATAPERMINTAANLAYANAN', 'RATARATA', 'RATA3'],
  PROYEKSI: ['PROYEKSI', 'PROYEKSIPEMINTAAN'],
  PENDAPATAN: ['PENDAPATANDALAM3TAHUN', 'PENDAPATAN'],
  BENCH: ['BENCHMARKINGLAYANAN', 'BENCHMARKING', 'BENCH'],
  LINK: ['LINKSURAT', 'LINK'],
};

const normalizeHeader = (value) => String(value == null ? '' : value)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]/g, '');

const REQUIRED_RPP_COLUMNS = Object.keys(DD).filter((field) => field !== 'NO');

function headerText(value) {
  return value && typeof value === 'object' && value.__sheetCell === true
    ? value.text : String(value == null ? '' : value);
}

function findHeaderIndex(headers, field, aliases) {
  const matches = [];
  headers.forEach((header, index) => {
    const value = normalizeHeader(headerText(header));
    if (!value || (field === 'NAMA' && /DETIL|DETAIL/.test(value))) return;
    let score = -1;
    for (const alias of aliases) {
      if (value === alias) score = Math.max(score, 1000 + alias.length);
      else if (value.startsWith(alias)) score = Math.max(score, alias.length);
    }
    if (score >= 0) matches.push({ index, score });
  });
  if (!matches.length) return -1;
  const bestScore = Math.max(...matches.map((match) => match.score));
  const best = matches.filter((match) => match.score === bestScore);
  if (best.length > 1) throw new Error(`Header RPP ambigu untuk kolom ${field}`);
  return best[0].index;
}

function resolveRppColumns(rows) {
  const limit = Math.min(rows.length, 25);
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const headers = rows[rowIndex] || [];
    const headerValues = headers.map((header) => normalizeHeader(headerText(header)));
    const hasCategory = headerValues.some((value) => value === 'KATEGORI' || value.startsWith('KATEGORI'));
    const hasAnyId = headerValues.some((value) => value === 'IDBARU' || value === 'IDLAMA' || value.startsWith('IDBARU') || value.startsWith('IDLAMA'));
    if (!hasCategory || !hasAnyId) continue;

    const columns = Object.fromEntries(Object.entries(RPP_HEADER_ALIASES).map(([field, aliases]) => [
      field, findHeaderIndex(headers, field, aliases),
    ]));
    const missing = REQUIRED_RPP_COLUMNS.filter((field) => columns[field] < 0);
    if (missing.length) throw new Error(`Header RPP tidak lengkap: ${missing.join(', ')}`);
    const used = new Map();
    for (const field of REQUIRED_RPP_COLUMNS) {
      const index = columns[field];
      if (used.has(index)) throw new Error(`Header RPP ${field} bertabrakan dengan ${used.get(index)}`);
      used.set(index, field);
    }
    return { columns: { NO: findHeaderIndex(headers, 'NO', RPP_HEADER_ALIASES.NO), ...columns }, headerRow: rowIndex, mode: 'header' };
  }

  // Positional fallback is only used when the feed provides no recognizable header row.
  // Require the complete expected width so a short/partial feed is never accepted as a full row.
  const requiredWidth = Math.max(...Object.values(DD)) + 1;
  if (!rows.some((row) => Array.isArray(row) && row.length >= requiredWidth)) {
    throw new Error(`Feed tanpa header hanya memiliki ${Math.max(0, ...rows.map((row) => row?.length || 0))} kolom; perlu minimal ${requiredWidth}`);
  }
  return { columns: { ...DD }, headerRow: -1, mode: 'positional' };
}

/* Normalize an old-service id. The source has real quirks:
 *   "0"           -> sentinel used on BARU rows (means "none")
 *   "120180047000156." -> stray trailing dot
 *   "120180047000038A" -> variant with a letter suffix
 * Returns '' when the value is not a usable id. */
export function normId(s) {
  const v = String(s == null ? '' : s).trim().replace(/\.$/, '');
  return /^\d{6,}[A-Z]?$/.test(v) ? v : '';
}

function cellData(row, index) {
  const source = row && index >= 0 ? row[index] : null;
  if (source && typeof source === 'object' && source.__sheetCell === true) {
    return {
      text: String(source.text == null ? '' : source.text).replace(/\u00a0/g, ' '),
      links: Array.isArray(source.links) ? source.links.map((link) => ({ ...link })) : [],
      present: true,
    };
  }
  const text = source == null ? '' : String(source).replace(/\u00a0/g, ' ');
  return { text, links: extractCellLinks(text), present: !!row && index >= 0 && index < row.length };
}
const cell = (row, index) => cellData(row, index).text.trim();

/* DATA_DUKUNG rows -> normalized RPP rows. Never invents or shortens field text. */
export function normRpp(rows) {
  const out = [];
  const { columns, headerRow } = resolveRppColumns(rows || []);
  const detailFields = ['OUTPUT', 'HUKUM', 'DESKRIPSI', 'PENGGUNA', 'RATA3', 'PROYEKSI', 'PENDAPATAN', 'BENCH', 'LINK'];
  for (let rowIndex = 0; rowIndex < (rows || []).length; rowIndex++) {
    if (rowIndex === headerRow) continue;
    const r = rows[rowIndex];
    if (!r) continue;
    const kategori = cell(r, columns.KATEGORI).toUpperCase();
    const idBaru = cell(r, columns.ID_BARU);
    const idLama = normId(cell(r, columns.ID_LAMA));
    if (!KATEGORI_SET.has(kategori)) continue;
    if (!/^\d+$/.test(idBaru) && !idLama) continue;

    const raw = Object.fromEntries(detailFields.map((field) => [field, cellData(r, columns[field])]));
    out.push({
      type: 'rpp',
      no: cell(r, columns.NO),
      idBaru: /^\d+$/.test(idBaru) ? Number(idBaru) : null,
      idLama,
      kategori,
      uke: cell(r, columns.UKE),
      jenis: cell(r, columns.JENIS),
      subjenis: cell(r, columns.SUBJENIS),
      nama: cell(r, columns.NAMA),
      detil: cell(r, columns.DETIL),
      satuan: cell(r, columns.SATUAN),
      tarif: cell(r, columns.TARIF),
      output: raw.OUTPUT.text,
      hukum: raw.HUKUM.text,
      deskripsi: raw.DESKRIPSI.text,
      pengguna: raw.PENGGUNA.text,
      rata3: raw.RATA3.text,
      proyeksi: raw.PROYEKSI.text,
      pendapatan: raw.PENDAPATAN.text,
      bench: raw.BENCH.text,
      link: raw.LINK.text,
      richCells: { hukum: raw.HUKUM, link: raw.LINK },
    });
  }
  return out;
}

/* PP47-2018 rows -> { oldMap, hapusList }
 * gid 0 is the SEBELUM/MENJADI sheet with columns:
 *   A=ID_LAMA  B..E=nama lama  F=SATUAN_LAMA  G=TARIF_LAMA
 *   I=ID_BARU  S=UKE_II  T=KET  P=alasan HAPUS  X=penjelasan
 * Hierarchy cells are merged in the sheet, so we forward-fill B..D. */
export function normPP47(rows) {
  const oldMap = Object.create(null);
  const hapusList = [];
  if (!rows || !rows.length) return { oldMap, hapusList };

  // locate the header row (contains "ID_LAMA")
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] || []).some((c) => /^ID_LAMA$/i.test(cell([c], 0)))) { h = i; break; }
  }
  if (h === -1) h = 0;

  let fillB = '', fillC = '', fillD = '';
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (cell(r, 1)) fillB = cell(r, 1);
    if (cell(r, 2)) fillC = cell(r, 2);
    if (cell(r, 3)) fillD = cell(r, 3);
    const idLama = normId(cell(r, 0));
    if (!idLama) continue; // skip blank / non-id rows
    const tarifLama = cell(r, 6);
    const satuanLama = cell(r, 5);
    const namaE = cell(r, 4);
    const rec = {
      idLama,
      namaLama: cell(r, 4) || fillD || fillC || fillB || idLama,
      pathLama: [fillB, fillC, fillD, namaE].filter((v, idx, a) => v && a.indexOf(v) === idx),
      satuanLama,
      tarifLama,
      ukeLama: cell(r, 18),
      ket: cell(r, 19),
      alasan: cellData(r, 15).text, // column P
      penjelasan: cellData(r, 23).text, // column X
    };
    const isLeaf = !!(tarifLama || satuanLama);
    if (isLeaf) oldMap[idLama] = rec;
    if (/^DIHAPUS/i.test(rec.alasan)) hapusList.push({ type: 'hapus', ...rec });
  }
  return { oldMap, hapusList };
}

/* ---------------------------------------------------------------------------
 * Bottom-up hierarchy (spec §3)
 * -------------------------------------------------------------------------*/
export function hierarchy(row) {
  const jenis = row.jenis || '';
  const subjenis = row.subjenis || '';
  const nama = row.nama || '';
  const detil = row.detil || '';
  let level, leaf, parents;
  if (detil) { level = 4; leaf = detil; parents = [jenis, subjenis, nama].filter(Boolean); }
  else if (nama) { level = 3; leaf = nama; parents = [jenis, subjenis].filter(Boolean); }
  else if (subjenis) { level = 2; leaf = subjenis; parents = [jenis].filter(Boolean); }
  else { level = 1; leaf = jenis || '—'; parents = []; }
  const bottomUp = [leaf, ...parents.slice().reverse()].filter((part) => part && part !== '—');
  return { level, leaf, parents, bottomUp };
}

/* ---------------------------------------------------------------------------
 * Tarif parsing / formatting (spec §6)
 * Types: rupiah, percent, other, none
 * -------------------------------------------------------------------------*/
export function classifyTarif(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t || t === '-') return { type: 'none', raw: t };
  if (/^[\d.,]+\s*%$/.test(t)) return { type: 'percent', raw: t, num: parseFloat(t.replace(',', '.')) };
  const m = t.match(/Rp\s*([\d.,]+)/i);
  if (m) {
    const num = Number(m[1].replace(/[.,]/g, ''));
    if (!isNaN(num)) return { type: 'rp', raw: t, num };
  }
  return { type: 'other', raw: t };
}

export function fmtTarif(t) {
  if (!t) return '';
  if (t.type === 'rp') return 'Rp' + t.num.toLocaleString('id-ID');
  if (t.type === 'percent') return (Number.isInteger(t.num) ? t.num : t.num.toFixed(2).replace(/\.?0+$/, '')) + '%';
  return t.raw;
}

// % change between old and new tarif, only when both are the same numeric kind
export function percentChange(oldT, newT) {
  if (!oldT || !newT) return null;
  if (oldT.type === 'rp' && newT.type === 'rp' && oldT.num > 0) {
    return Math.round(((newT.num - oldT.num) / oldT.num) * 1000) / 10;
  }
  return null;
}

/* Group key used for UKE inheritance (spec §4) */
export function groupKey(row) {
  return `${row.jenis || ''}||${row.subjenis || ''}`;
}

/* Resolve UKE badges for a display-ordered list.
 * - explicit UKE -> solid badge
 * - empty -> inherit last non-empty within the same Jenis+Subjenis group
 *   (italic, 60% opacity, tooltip in the renderer) */
export function resolveUke(list) {
  const lastByGroup = new Map();
  let lastUke = '';
  return list.map((row) => {
    const explicit = (row.uke || row.ukeLama || '').trim();
    if (explicit) {
      lastUke = explicit;
      lastByGroup.set(groupKey(row), explicit);
      return { uke: explicit, inherited: false };
    }
    const g = groupKey(row);
    const fromGroup = lastByGroup.get(g) || lastUke;
    return { uke: fromGroup || '', inherited: !!fromGroup };
  });
}

/* Sort visible records by a selected field. Empty values stay at the end. */
export function sortRows(list, showHapus, sortKey = 'id', direction = 'asc') {
  const arr = list.slice();
  const dir = direction === 'desc' ? -1 : 1;
  const text = (value) => String(value == null ? '' : value).trim();
  const compareText = (a, b) => text(a).localeCompare(text(b), 'id', { numeric: true, sensitivity: 'base' });
  const compareNullable = (a, b, compare) => {
    const aEmpty = a == null || text(a) === '';
    const bEmpty = b == null || text(b) === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    return compare(a, b) * dir;
  };
  const compareNewId = (a, b) => {
    const aValue = a.idBaru, bValue = b.idBaru;
    const aEmpty = aValue == null || text(aValue) === '';
    const bEmpty = bValue == null || text(bValue) === '';
    if (aEmpty && bEmpty) return 0;
    if (aEmpty) return 1;
    if (bEmpty) return -1;
    const aNumber = Number(aValue), bNumber = Number(bValue);
    const aNumeric = Number.isFinite(aNumber), bNumeric = Number.isFinite(bNumber);
    if (aNumeric && bNumeric) return (aNumber - bNumber) * dir;
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return compareText(aValue, bValue) * dir;
  };

  arr.sort((a, b) => {
    if (sortKey === 'id') {
      if (showHapus) {
        const oldA = a.idLama || '', oldB = b.idLama || '';
        if (oldA && oldB) return compareText(oldA, oldB) * dir;
        if (oldA) return -1;
        if (oldB) return 1;
      }
      return compareNewId(a, b);
    }
    if (sortKey === 'service') {
      const path = (row) => {
        if (row.type !== 'hapus') return [row.detil, row.nama, row.subjenis, row.jenis].filter(Boolean).join(' ');
        const parents = [...(row.pathLama || [])];
        if (parents.length && parents[parents.length - 1] === row.namaLama) parents.pop();
        return [row.namaLama || '', ...parents.reverse()].filter(Boolean).join(' ');
      };
      return compareNullable(path(a), path(b), compareText);
    }
    if (sortKey === 'uke') return compareNullable(a._resolvedUke || a.uke || a.ukeLama, b._resolvedUke || b.uke || b.ukeLama, compareText);
    if (sortKey === 'kategori') {
      const order = { BARU: 0, UBAH: 1, TETAP: 2, HAPUS: 3 };
      const ka = a.type === 'hapus' ? 'HAPUS' : (a.kategori || '');
      const kb = b.type === 'hapus' ? 'HAPUS' : (b.kategori || '');
      return compareNullable(ka, kb, (x, y) => (order[x] ?? 99) - (order[y] ?? 99));
    }
    if (sortKey === 'tarif') {
      const getTarif = (row) => classifyTarif(row.type === 'hapus' ? row.tarifLama : row.tarif);
      const ta = getTarif(a), tb = getTarif(b);
      const rank = { rp: 0, percent: 1, other: 2, none: 3 };
      if (ta.type !== tb.type) return rank[ta.type] - rank[tb.type];
      if (ta.type === 'rp' || ta.type === 'percent') {
        const aNumeric = Number.isFinite(ta.num), bNumeric = Number.isFinite(tb.num);
        if (aNumeric && bNumeric) return (ta.num - tb.num) * dir;
        if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
      }
      return compareNullable(ta.raw, tb.raw, compareText);
    }
    return 0;
  });
  return arr;
}

/* Aggregate stats used by the hero (computed from real rows, never hardcoded) */
export function computeStats(rpp, hapusList, semulaIds) {
  const c = { BARU: 0, UBAH: 0, TETAP: 0 };
  const oldIds = new Set();
  rpp.forEach((r) => {
    if (c[r.kategori] != null) c[r.kategori]++;
    if ((r.kategori === 'UBAH' || r.kategori === 'TETAP') && r.idLama) oldIds.add(r.idLama);
  });
  hapusList.forEach((h) => { if (h.idLama) oldIds.add(h.idLama); });
  // SEMULA = the full universe of old PP47 leaf services (authoritative when supplied).
  const semula = Array.isArray(semulaIds) && semulaIds.length ? semulaIds.length : oldIds.size;
  const totals = {
    rpp: rpp.length,
    baru: c.BARU, ubah: c.UBAH, tetap: c.TETAP,
    hapus: hapusList.length,
    semula,
  };
  return totals;
}
