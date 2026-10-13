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

/* gviz JSON -> array-of-arrays, using the *formatted* value `f` when present.
 * This is the critical fix for scientific-notation numbers (ID_LAMA). */
export function gvizToRows(json) {
  const rows = (json && json.table && json.table.rows) || [];
  return rows.map((r) => (r.c || []).map((c) => {
    if (!c) return '';
    if (c.f !== undefined && c.f !== null && c.f !== '') return String(c.f);
    if (c.v === undefined || c.v === null) return '';
    return String(c.v);
  }));
}

/* ---------------------------------------------------------------------------
 * Column indices — identical for the gviz feed and the published CSV
 * (both carry a leading blank column A).
 * -------------------------------------------------------------------------*/
export const DD = {
  NO: 1, ID_LAMA: 2, ID_BARU: 3, UKE: 4, KATEGORI: 5, JENIS: 6, SUBJENIS: 7,
  NAMA: 8, DETIL: 9, SATUAN: 10, TARIF: 11, OUTPUT: 12, HUKUM: 13,
  DESKRIPSI: 14, PENGGUNA: 15, RATA3: 16, PROYEKSI: 17, PENDAPATAN: 18,
  BENCH: 19, LINK: 20,
};

const KATEGORI_SET = new Set(['BARU', 'UBAH', 'TETAP', 'HAPUS']);

/* Normalize an old-service id. The source has real quirks:
 *   "0"           -> sentinel used on BARU rows (means "none")
 *   "120180047000156." -> stray trailing dot
 *   "120180047000038A" -> variant with a letter suffix
 * Returns '' when the value is not a usable id. */
export function normId(s) {
  const v = String(s == null ? '' : s).trim().replace(/\.$/, '');
  return /^\d{6,}[A-Z]?$/.test(v) ? v : '';
}
const cell = (r, i) => String((r && r[i] != null ? r[i] : '')).replace(/\u00a0/g, ' ').trim();

/* DATA_DUKUNG rows -> normalized RPP rows (154). Never invents a row. */
export function normRpp(rows) {
  const out = [];
  for (const r of rows) {
    if (!r) continue;
    const kategori = cell(r, DD.KATEGORI).toUpperCase();
    const idBaru = cell(r, DD.ID_BARU);
    const idLama = normId(cell(r, DD.ID_LAMA));
    // Header guard: skip the label row and any non-data rows.
    if (!KATEGORI_SET.has(kategori)) continue;
    if (!/^\d+$/.test(idBaru) && !idLama) continue;
    out.push({
      type: 'rpp',
      no: cell(r, DD.NO),
      idBaru: /^\d+$/.test(idBaru) ? Number(idBaru) : null,
      idLama,
      kategori,
      uke: cell(r, DD.UKE),
      jenis: cell(r, DD.JENIS),
      subjenis: cell(r, DD.SUBJENIS),
      nama: cell(r, DD.NAMA),
      detil: cell(r, DD.DETIL),
      satuan: cell(r, DD.SATUAN),
      tarif: cell(r, DD.TARIF),
      output: cell(r, DD.OUTPUT),
      hukum: cell(r, DD.HUKUM),
      deskripsi: cell(r, DD.DESKRIPSI),
      pengguna: cell(r, DD.PENGGUNA),
      rata3: cell(r, DD.RATA3),
      proyeksi: cell(r, DD.PROYEKSI),
      pendapatan: cell(r, DD.PENDAPATAN),
      bench: cell(r, DD.BENCH),
      link: cell(r, DD.LINK),
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
    const namaParts = [cell(r, 1), cell(r, 2), cell(r, 3), namaE].filter(Boolean);
    const rec = {
      idLama,
      namaLama: cell(r, 4) || fillD || fillC || fillB || idLama,
      pathLama: [fillB, fillC, fillD, namaE].filter((v, idx, a) => v && a.indexOf(v) === idx),
      satuanLama,
      tarifLama,
      ukeLama: cell(r, 18),
      ket: cell(r, 19),
      alasan: cell(r, 15),          // column P
      penjelasan: cell(r, 23),      // column X
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
  if (detil) return { level: 4, leaf: detil, parents: [jenis, subjenis, nama].filter(Boolean) };
  if (nama) return { level: 3, leaf: nama, parents: [jenis, subjenis].filter(Boolean) };
  if (subjenis) return { level: 2, leaf: subjenis, parents: [jenis].filter(Boolean) };
  return { level: 1, leaf: jenis || '—', parents: [] };
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

/* ---------------------------------------------------------------------------
 * Sorting (spec §5): default ID_BARU asc numeric;
 * when HAPUS is shown -> ID_LAMA asc as 15-digit string (BigInt-safe).
 * Rows without ID_LAMA keep their ID_BARU order, placed after.
 * -------------------------------------------------------------------------*/
export function sortRows(list, showHapus) {
  const arr = list.slice();
  if (!showHapus) {
    arr.sort((a, b) => (a.idBaru == null ? 1e9 : a.idBaru) - (b.idBaru == null ? 1e9 : b.idBaru));
    return arr;
  }
  arr.sort((a, b) => {
    const al = a.idLama || '', bl = b.idLama || '';
    if (al && bl) return al < bl ? -1 : al > bl ? 1 : 0;
    if (al && !bl) return -1;
    if (!al && bl) return 1;
    return (a.idBaru == null ? 1e9 : a.idBaru) - (b.idBaru == null ? 1e9 : b.idBaru);
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
  totals.pct = {
    baru: totals.semula ? Math.round((totals.baru / totals.semula) * 100) : 0,
    ubah: totals.semula ? Math.round((totals.ubah / totals.semula) * 100) : 0,
    tetap: totals.semula ? Math.round((totals.tetap / totals.semula) * 100) : 0,
    hapus: totals.semula ? Math.round((totals.hapus / totals.semula) * 100) : 0,
  };
  return totals;
}
