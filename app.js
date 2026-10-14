/* ============================================================================
 * app.js — UI + loading orchestration for RPP PNBP BMKG 2026
 * ==========================================================================*/
import {
  CONFIG, rppSources, hapusSources,
  parseCSV, gvizToRows, normRpp, mergeRpp, normPP47,
  hierarchy, classifyTarif, fmtTarif, percentChange,
  resolveUke, sortRows, computeStats,
} from './data.js';

/* ------------------------------- state ---------------------------------- */
const state = {
  rpp: [], hapus: [], oldMap: {},
  visible: [],               // filtered + sorted rows currently rendered
  ukeList: [],
  loading: true,
  loaded: { rpp: null, hapus: null },   // live source + diagnostics
  stats: null,
  sort: { key: 'id', direction: 'asc' },
  filters: { q: '', uke: new Set(), kategori: 'SEMUA', showHapus: false },
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/* ------------------------------ fetching -------------------------------- */
async function fetchText(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

// Load a gviz JSON feed through a <script> tag (immune to the CORS block that
// plain fetch() hits on the /gviz/tq endpoint).
function loadJsonp(url, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const cb = '__gvizCb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      try { delete window[cb]; } catch (e) { window[cb] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    const timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); reject(new Error('timeout')); } }, timeout);
    window[cb] = (data) => { if (settled) return; settled = true; cleanup(); resolve(data); };
    script.onerror = () => { if (!settled) { settled = true; cleanup(); reject(new Error('script load error')); } };
    const liveUrl = url.replace('out:json', 'out:json;responseHandler:' + cb);
    script.src = `${liveUrl}${liveUrl.includes('?') ? '&' : '?'}_live=${Date.now()}`;
    document.head.appendChild(script);
  });
}

function jsonFromGvizText(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('bentuk respons tidak dikenal');
  return JSON.parse(text.slice(a, b + 1));
}

const needsLinkTarget = (value) => {
  const text = String(value == null ? '' : value).trim();
  return !!text && !/^[-–—]+$/.test(text);
};

/* Read one RPP source. Throws on fetch/parse errors or zero valid rows. */
async function readRpp(src) {
  let rows;
  if (src.kind === 'jsonp') {
    rows = gvizToRows(await loadJsonp(src.url));
  } else {
    const text = await fetchText(src.url);
    rows = src.format === 'json' ? gvizToRows(jsonFromGvizText(text)) : parseCSV(text);
  }
  const rpp = normRpp(rows);
  if (!rpp.length) throw new Error('0 baris valid');
  return { rpp, source: src, linkWarnings: findLinkWarnings(rpp) };
}

function findLinkWarnings(rpp) {
  return rpp.filter((row) => needsLinkTarget(row.link) &&
    !(row.richCells && row.richCells.link && row.richCells.link.links.length))
    .map((row) => row.idBaru != null ? row.idBaru : row.idLama);
}

/* CSV (exact sheet text) and gviz (links + typed cells) are read in parallel.
 * CSV is the base; gviz only fills cells that are empty in CSV. Never fabricates.
 * If both primaries fail, the remaining sources are tried in order as fallback. */
async function loadRpp() {
  const attempts = [];
  const sources = rppSources();
  const primaryIds = ['pub-csv', 'gviz-jsonp'];
  const outcomeOf = (src) => readRpp(src).then(
    (res) => ({ src, res }),
    (err) => ({ src, err }),
  );
  const record = (o) => attempts.push(o.res
    ? { id: o.src.id, label: o.src.label, status: 'ok', rows: o.res.rpp.length, linkWarnings: o.res.linkWarnings.length }
    : { id: o.src.id, label: o.src.label, status: 'fail', error: o.err.message });

  const primary = await Promise.all(sources.filter((s) => primaryIds.includes(s.id)).map(outcomeOf));
  primary.forEach(record);
  let ok = primary.filter((o) => o.res).map((o) => o.res);

  if (!ok.length) {
    for (const src of sources.filter((s) => !primaryIds.includes(s.id))) {
      const o = await outcomeOf(src);
      record(o);
      if (o.res) { ok = [o.res]; break; }
    }
  }
  if (!ok.length) return { rpp: [], source: null, attempts, linkWarnings: [] };

  const base = ok.find((r) => r.source.format === 'csv') || ok[0];
  const merge = { filled: 0, diff: 0 };
  for (const other of ok) {
    if (other === base) continue;
    const m = mergeRpp(base.rpp, other.rpp);
    merge.filled += m.filled;
    merge.diff += m.diff;
  }
  return {
    rpp: base.rpp, source: base.source, attempts,
    linkWarnings: findLinkWarnings(base.rpp), merge,
  };
}

/* HAPUS detail: loop gid 0..10, first published tab that has real id rows wins. */
async function loadHapus() {
  const attempts = [];
  for (const src of hapusSources()) {
    try {
      const text = await fetchText(src.url);
      const { oldMap, hapusList } = normPP47(parseCSV(text));
      if (!hapusList.length) throw new Error('tidak ada kolom HAPUS / ID_LAMA');
      attempts.push({ id: src.id, label: src.label, status: 'ok', rows: hapusList.length });
      return { oldMap, hapusList, source: src, attempts };
    } catch (e) {
      attempts.push({ id: src.id, label: src.label, status: 'fail', error: e.message });
    }
  }
  return { oldMap: {}, hapusList: [], source: null, attempts };
}

async function loadAll() {
  state.loading = true;
  renderStatus();
  const [r, h] = await Promise.all([loadRpp(), loadHapus()]);

  state.rpp = r.rpp;
  state.hapus = h.hapusList;
  state.oldMap = h.oldMap;
  state.loaded = {
    rpp: { source: r.source, attempts: r.attempts, linkWarnings: r.linkWarnings || [], merge: r.merge || { filled: 0, diff: 0 } },
    hapus: { source: h.source, attempts: h.attempts },
  };
  state.ukeList = [...new Set(
    [...state.rpp.map((x) => x.uke), ...state.hapus.map((x) => x.ukeLama)]
      .map((v) => (v || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
  state.stats = computeStats(state.rpp, state.hapus, Object.keys(state.oldMap));
  state.loading = false;
  buildUkeFilter();
  renderHero();
  renderTable();
  renderFooter();
  renderStatus();
  renderNotice();
}

function renderNotice() {
  const el = $('#notice');
  if (!el) return;
  const issues = [];
  if (!state.loaded.rpp?.source) issues.push('Sumber live RPP gagal dimuat; data cache tidak digunakan.');
  if (!state.loaded.hapus?.source) issues.push('Sumber live HAPUS gagal dimuat; data cache tidak digunakan.');
  const merge = state.loaded.rpp?.merge;
  if (merge && merge.filled > 0) issues.push(`${merge.filled} sel kosong dilengkapi dari sumber lain.`);
  if (merge && merge.diff > 0) issues.push(`${merge.diff} sel berbeda antar sumber; teks yang ditampilkan adalah versi CSV.`);
  const warnings = state.loaded.rpp?.linkWarnings || [];
  if (warnings.length) {
    const sample = warnings.slice(0, 6).join(', ');
    issues.push(`${warnings.length} Link Surat berisi teks tanpa target hyperlink dari sumber live (ID ${sample}${warnings.length > 6 ? ', …' : ''}). Teks tetap ditampilkan; URL tidak ditebak.`);
  }
  el.hidden = issues.length === 0;
  el.textContent = issues.join(' ');
}

/* ------------------------------- helpers -------------------------------- */
function iconFor(row) {
  // Match the service's own name first, so a parent category does not decide the icon.
  const pick = (text) => {
    if (/penerbangan|navigasi|bandara|airnav|aviation/.test(text)) return '\u2708\ufe0f';
    if (/maritim|laut|pelayaran|pelabuhan|pantai|samudra|ocean|iklim mar/.test(text)) return '\ud83c\udf0a';
    if (/vulkan|gunung|letusan|kegempaan|gempa|seismik|seismolog|geofisika|tsunami/.test(text)) return '\ud83c\udf0b';
    if (/suhu|temperatur|udara atas|rawinsonde|klimatologi|iklim/.test(text)) return '\ud83c\udf21\ufe0f';
    return null;
  };
  const own = [row.detil, row.nama, row.namaLama].filter(Boolean).join(' ').toLowerCase();
  const parent = [row.subjenis, row.jenis, ...(row.pathLama || [])].filter(Boolean).join(' ').toLowerCase();
  return pick(own) || pick(parent) || '\ud83c\udf24\ufe0f';
}

function katBadge(kat) {
  const map = {
    BARU: 'badge-green', UBAH: 'badge-amber', TETAP: 'badge-blue', HAPUS: 'badge-red',
  };
  return `<span class="badge ${map[kat] || ''}">${esc(kat)}</span>`;
}

/* ------------------------------- filtering ------------------------------ */
function currentRows() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let base = state.filters.showHapus ? [...state.rpp, ...state.hapus] : state.rpp.slice();
  const ukeResolved = resolveUke(base);

  const out = [];
  base.forEach((row, i) => {
    const info = ukeResolved[i];
    if (f.uke.size && !f.uke.has(info.uke)) return;
    if (f.kategori === 'HAPUS') {
      if (row.type !== 'hapus') return;
    } else if (f.kategori !== 'SEMUA') {
      if (row.type === 'hapus' || row.kategori !== f.kategori) return;
    }
    if (q) {
      const hay = [
        row.jenis, row.subjenis, row.nama, row.detil,
        row.namaLama, (row.pathLama || []).join(' '),
        row.idBaru != null ? String(row.idBaru) : '', row.idLama, row.tarif, row.uke,
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return;
    }
    out.push({ row, uke: info.uke, inherited: info.inherited });
  });
  return { items: out };
}

/* -------------------------------- render -------------------------------- */
function renderHero() {
  const s = state.stats || { semula: 0, rpp: 0, baru: 0, ubah: 0, tetap: 0, hapus: 0 };
  const categories = [
    { key: 'BARU', count: s.baru, cls: 'seg-green' },
    { key: 'UBAH', count: s.ubah, cls: 'seg-amber' },
    { key: 'TETAP', count: s.tetap, cls: 'seg-blue' },
    { key: 'HAPUS', count: s.hapus, cls: 'seg-red' },
  ];
  const total = categories.reduce((n, item) => n + item.count, 0);
  const denominator = total || 1;
  $('#semulaCount').textContent = s.semula.toLocaleString('id-ID');
  $('#rppCount').textContent = s.rpp.toLocaleString('id-ID');
  $('#datasetSummary').textContent =
    `${s.semula.toLocaleString('id-ID')} layanan semula · ${s.rpp.toLocaleString('id-ID')} layanan dalam usulan RPP 2026`;
  $('#chartTotal').textContent = `${total.toLocaleString('id-ID')} perubahan`;
  $('#progress').setAttribute('aria-label', `Komposisi ${total} baris perubahan`);
  $('#progress').innerHTML = categories.map((item) =>
    `<span class="seg ${item.cls}" style="width:${(item.count / denominator) * 100}%"></span>`
  ).join('');
  $('#chartLegend').innerHTML = categories.map((item) =>
    `<span>${item.key} <b>${Math.round((item.count / denominator) * 100)}%</b></span>`
  ).join('');
  $('#pills').innerHTML = categories.map((item) => {
    const active = state.filters.kategori === item.key;
    const pct = Math.round((item.count / denominator) * 100);
    return `<button type="button" class="filter-chip ${active ? 'active' : ''}" data-filter="${item.key}" aria-pressed="${active}">` +
      `<span class="chip-label">${item.key}</span>` +
      `<span class="chip-value"><b>${item.count.toLocaleString('id-ID')}</b><small>${pct}%</small></span></button>`;
  }).join('');
}

function ukeHue(value) {
  const count = Math.max(state.ukeList.length, 1);
  const index = Math.max(0, state.ukeList.indexOf(value));
  return Math.round((index * 360) / count);
}

function buildUkeFilter() {
  const box = $('#ukeMenuItems');
  box.innerHTML = state.ukeList.map((u) =>
    `<label class="chk" style="--uke-hue:${ukeHue(u)}"><input type="checkbox" value="${esc(u)}" ${state.filters.uke.has(u) ? 'checked' : ''}>` +
    `<span class="uke-swatch" aria-hidden="true"></span><span class="uke-name">${esc(u)}</span></label>`
  ).join('');
  box.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', () => {
      if (inp.checked) state.filters.uke.add(inp.value); else state.filters.uke.delete(inp.value);
      updateUkeLabel(); renderTable();
    });
  });
  updateUkeLabel();
}
function updateUkeLabel() {
  const n = state.filters.uke.size;
  $('#ukeBtn').textContent = n ? `UKE II (${n})` : 'UKE II (semua)';
}

function tarifCell(row) {
  if (row.type === 'hapus') {
    const t = classifyTarif(row.tarifLama);
    return `<div class="tarif"><s class="t-red">${esc(fmtTarif(t) || '—')}</s>` +
      (row.satuanLama ? `<span class="satuan">${esc(row.satuanLama)}</span>` : '') + `</div>`;
  }
  const nt = classifyTarif(row.tarif);
  const newTxt = fmtTarif(nt) || '—';
  if (row.kategori === 'BARU') {
    return `<div class="tarif">` +
      `<b class="t-green">${esc(newTxt)}</b>` +
      (row.satuan ? `<span class="satuan">${esc(row.satuan)}</span>` : '') + `</div>`;
  }
  if (row.kategori === 'UBAH') {
    const oldRec = state.oldMap[row.idLama];
    const oldT = oldRec ? classifyTarif(oldRec.tarifLama) : null;
    const pc = oldT ? percentChange(oldT, nt) : null;
    let badge = '';
    if (pc != null) {
      const tone = Math.abs(pc) < 30 ? 'chip-change-small' : 'chip-change-large';
      const direction = pc > 0 ? '&#9650; ' : (pc < 0 ? '&#9660; ' : '');
      badge = `<span class="chip ${tone}" title="Perubahan tarif: ${Math.abs(pc)}% secara absolut">${direction}${pc > 0 ? '+' : ''}${pc}%</span>`;
    } else if (oldT && oldT.raw) {
      badge = `<span class="chip chip-flat">dari ${esc(fmtTarif(oldT))}</span>`;
    }
    return `<div class="tarif"><b class="t-amber">${esc(newTxt)}</b>${badge}` +
      (row.satuan ? `<span class="satuan">${esc(row.satuan)}</span>` : '') + `</div>`;
  }
  // TETAP
  return `<div class="tarif"><b class="t-blue">${esc(newTxt)}</b>` +
    `<span class="chip chip-change-small" title="Tidak ada perubahan tarif">0%</span>` +
    (row.satuan ? `<span class="satuan">${esc(row.satuan)}</span>` : '') + `</div>`;
}

function idCell(row) {
  const isHapus = row.type === 'hapus';
  const visibleId = isHapus ? row.idLama : (row.idBaru != null ? `ID: ${row.idBaru}` : '—');
  const badge = katBadge(isHapus ? 'HAPUS' : row.kategori);
  const old = !isHapus && row.idLama ? `<div class="idlama">Lama: ${esc(row.idLama)}</div>` : '';
  return `<div class="idcol"><div class="idline"><span class="idbaru ${isHapus ? 'id-hapus' : ''}">${esc(visibleId)}</span>${badge}</div>${old}</div>`;
}

function hierarchyParts(row) {
  if (row.type === 'hapus') {
    const path = row.pathLama || [];
    const parents = path.length && path[path.length - 1] === row.namaLama ? path.slice(0, -1) : path;
    return { kind: 'hapus', primary: row.namaLama || row.idLama || '—', parents };
  }
  const h = hierarchy(row);
  return { kind: 'rpp', primary: h.leaf, parents: h.parents };
}

function hierCell(row, visibleParents, sharedParentCount) {
  const icon = `<span class="icon" aria-hidden="true">${iconFor(row)}</span>`;
  const parts = hierarchyParts(row);
  const leafClass = row.type === 'hapus' ? 'leaf leaf-hapus' : 'leaf';
  // Top-down: parents (Jenis › Subjenis › Nama) above, the service itself below in bold.
  const fullPath = [...parts.parents, parts.primary].filter(Boolean).join(' › ');
  const parentHtml = visibleParents.length
    ? `<span class="parents" style="padding-left:${Math.min(sharedParentCount * 8, 24)}px">${visibleParents.map((p) => esc(p)).join(' <i>›</i> ')}</span>` : '';
  return `<div class="hier" title="${esc(fullPath)}" aria-label="${esc(fullPath)}">${icon}` +
    `${parentHtml}<span class="${leafClass}">${esc(parts.primary)}</span></div>`;
}

function rowHtml(item, visibleParents, sharedParentCount, isGroupStart) {
  const { row, uke, inherited } = item;
  const isHapus = row.type === 'hapus';
  const cls = `${isHapus ? 'row row-hapus' : 'row'}${isGroupStart ? ' row-group-start' : ''}`;
  const hue = uke ? ukeHue(uke) : 0;
  const ukePill = uke
    ? `<span class="ukepill ${inherited ? 'uke-inherited' : ''}" style="--uke-hue:${hue}" title="${inherited ? 'UKE II diwarisi dari baris sebelumnya' : 'UKE II: ' + esc(uke)}">${esc(uke)}</span>`
    : `<span class="uke-empty">—</span>`;
  const act = isHapus
    ? `<button class="act act-hapus" data-act="hapus" title="Penjelasan HAPUS (PP 47/2018)">${ICON_FILE}</button>`
    : `<button class="act" data-act="rpp" title="Lihat seluruh data detail">${ICON_EYE}</button>`;
  return `<tr class="${cls}" data-key="${esc(keyOf(row))}">` +
    `<td class="td-id">${idCell(row)}</td>` +
    `<td class="td-hier">${hierCell(row, visibleParents, sharedParentCount)}</td>` +
    `<td class="td-uke">${ukePill}</td>` +
    `<td class="td-tarif">${tarifCell(row)}</td>` +
    `<td class="td-act">${act}</td></tr>`;
}

const ICON_EYE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

function keyOf(row) {
  return row.type === 'hapus' ? 'H:' + row.idLama : 'R:' + (row.idBaru != null ? row.idBaru : row.idLama);
}

function renderSortControls() {
  const select = $('#sortBy');
  if (select) select.value = state.sort.key;
  const direction = $('#sortDirection');
  if (direction) {
    const ascending = state.sort.direction === 'asc';
    direction.textContent = ascending ? '↑' : '↓';
    direction.title = ascending ? 'Urut menaik' : 'Urut menurun';
    direction.setAttribute('aria-label', direction.title);
  }
  document.querySelectorAll('#tableHead th[data-sort]').forEach((th) => {
    const active = th.dataset.sort === state.sort.key;
    th.setAttribute('aria-sort', active ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    const marker = th.querySelector('.sort-mark');
    if (marker) marker.textContent = active ? (state.sort.direction === 'asc' ? '↑' : '↓') : '↕';
  });
}

function renderTable() {
  const { items } = currentRows();
  const sortableRows = items.map((item) => ({ ...item.row, _resolvedUke: item.uke }));
  const sorted = sortRows(sortableRows, state.filters.showHapus, state.sort.key, state.sort.direction);
  const byKey = new Map(items.map((item) => [keyOf(item.row), item]));
  state.visible = sorted.map((row) => byKey.get(keyOf(row))).filter(Boolean);

  renderSortControls();
  const tbody = $('#tbody');
  if (state.loading) {
    tbody.innerHTML = `<tr><td colspan="5" class="center muted">Memuat data…</td></tr>`;
    return;
  }
  if (!state.rpp.length) { renderEmpty(); return; }
  if (!state.visible.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="center muted">Tidak ada baris yang cocok dengan filter.</td></tr>`;
    $('#count').textContent = '0 baris';
    return;
  }
  tbody.innerHTML = state.visible.map((item, index, list) => {
    const current = hierarchyParts(item.row);
    const previous = index ? hierarchyParts(list[index - 1].row) : null;
    let shared = 0;
    if (previous && current.kind === previous.kind && current.parents.length >= previous.parents.length) {
      while (shared < previous.parents.length && current.parents[shared] === previous.parents[shared]) shared += 1;
    }
    const visibleParents = current.parents.slice(shared);
    const isGroupStart = !previous || current.kind !== previous.kind ||
      (current.parents.length > 0 && shared === 0) ||
      (previous && current.parents.length < previous.parents.length);
    return rowHtml(item, visibleParents, shared, isGroupStart);
  }).join('');
  $('#count').textContent = `${state.visible.length} baris`;
}

/* ------------------------------- drawer --------------------------------- */
function openDrawer(kind, row) {
  const body = $('#drawerBody');
  if (kind === 'rpp') {
    const h = hierarchy(row);
    const tarifTxt = (fmtTarif(classifyTarif(row.tarif)) || '—') + (row.satuan ? ' \u00b7 ' + row.satuan : '');
    $('#drawerTitle').textContent = 'Detail Layanan RPP';
    $('#drawerSub').innerHTML = esc(h.leaf) + katBadge(row.kategori).replace('badge', 'badge inline') +
      `<div class="dmeta">ID BARU <b>${esc(row.idBaru != null ? row.idBaru : '—')}</b>` +
      (row.idLama ? ` &middot; ID LAMA <b class="mono">${esc(row.idLama)}</b>` : '') +
      ` &middot; UKE II <b>${esc(row.uke || '—')}</b> &middot; Tarif <b>${esc(tarifTxt)}</b></div>`;
    // Preserve the complete hierarchy and source text in the detail drawer.
    body.innerHTML =
      field('Hierarki Layanan', [...h.parents, h.leaf].filter((p) => p && p !== '—').join(' › ')) +
      field('Output/Tipe Data (Kolom J)', row.output) +
      fieldRich('Dasar Hukum (selain UU 31/2009 dan Perpres 20/2024)', row.richCells && row.richCells.hukum) +
      field('Deskripsi Layanan dan Parameter Layanan', row.deskripsi) +
      field('Pengguna Saat Ini dan/atau Sasaran Pengguna', row.pengguna) +
      field('Rata-rata Permintaan Layanan (3 Tahun Terakhir)', row.rata3) +
      field('Proyeksi Permintaan', row.proyeksi) +
      field('Pendapatan dalam 3 Tahun Terakhir dan/atau Perkiraan Pendapatan', row.pendapatan) +
      field('Benchmarking Layanan dari Instansi Lain dan/atau Pihak Swasta (jika ada)', row.bench) +
      fieldRich('Link Surat', row.richCells && row.richCells.link, true);
    const extra = (row.cols || []).map((c, i) => ({ label: c.label, text: c.text, index: i + 1 }))
      .filter((c) => String(c.text || '').trim() !== '');
    body.innerHTML += `<details class="allcols"><summary>Semua kolom sumber (${extra.length} terisi)</summary>` +
      extra.map((c) => field(c.label || `Kolom ${c.index}`, c.text)).join('') + `</details>`;
  } else {
    const tarifTxt = (fmtTarif(classifyTarif(row.tarifLama)) || '—') + (row.satuanLama ? ' \u00b7 ' + row.satuanLama : '');
    $('#drawerTitle').textContent = 'Penjelasan HAPUS (PP 47/2018)';
    $('#drawerSub').innerHTML = esc(row.namaLama) + katBadge('HAPUS').replace('badge', 'badge inline') +
      `<div class="dmeta">ID LAMA <b class="mono">${esc(row.idLama)}</b> &middot; UKE II <b>${esc(row.ukeLama || '—')}</b> &middot; Tarif lama <b>${esc(tarifTxt)}</b></div>`;
    // Retain the full prior hierarchy while keeping both source explanation fields intact.
    const hPath = hierarchyParts(row);
    body.innerHTML =
      `<div class="warn">Data Penjelasan HAPUS diambil dari kolom P &amp; X sheet PP 47/2018 (gid 0) &mdash; tanpa data contoh.</div>` +
      field('Hierarki Layanan', [...hPath.parents, hPath.primary].filter(Boolean).join(' › ')) +
      field('Kategori Penghapusan (kolom P)', row.alasan) +
      field('Penjelasan (kolom X)', row.penjelasan);
  }
  $('#drawer').classList.add('open');
  $('#scrim').classList.add('open');
}
function field(label, val, mono) {
  const v = (val == null || String(val).trim() === '') ? '<span class="empty">—</span>' : esc(val);
  return `<div class="field"><div class="flabel">${esc(label)}</div><div class="fval ${mono ? 'mono' : ''}">${v}</div></div>`;
}
function fieldRich(label, source, warnMissingLink = false) {
  const raw = String(source && source.text != null ? source.text : '');
  const links = Array.isArray(source && source.links) ? source.links : [];
  if (!raw.trim() && !links.length) return field(label, raw);
  const linkHtml = links.map((link, index) => {
    let href = '';
    try {
      const candidate = new URL(String(link.href || ''));
      if (['https:', 'http:', 'mailto:'].includes(candidate.protocol)) href = candidate.href;
    } catch (e) { /* ignore unsafe or malformed targets */ }
    if (!href) return '';
    const linkLabel = String(link.label || '').trim() || `Buka tautan ${index + 1}`;
    return `<a class="source-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(linkLabel)} &#8599;</a>`;
  }).join('');
  const warning = warnMissingLink && needsLinkTarget(raw) && !links.length
    ? `<div class="link-unavailable">Teks sumber ada, tetapi target hyperlink tidak dikirim oleh sumber live.</div>` : '';
  return `<div class="field"><div class="flabel">${esc(label)}</div><div class="fval">${esc(raw)}${linkHtml ? `<div class="source-links">${linkHtml}</div>` : ''}${warning}</div></div>`;
}
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#scrim').classList.remove('open');
}

/* ------------------------------ empty state ----------------------------- */
function renderEmpty() {
  const a = state.loaded.rpp ? state.loaded.rpp.attempts : [];
  const rows = a.map((x) =>
    `<li class="${x.status}">${x.status === 'ok' ? '&#10003;' : '&#10007;'} <b>${esc(x.label)}</b>` +
    (x.status === 'ok' ? ` — ${x.rows} baris` : ` — ${esc(x.error || '')}`) + `</li>`).join('');
  $('#tbody').innerHTML = `<tr><td colspan="5"><div class="emptystate">
    <div class="es-title">Data tidak dapat dimuat</div>
    <p>Tidak ada sumber yang berhasil. Ini <b>bukan</b> data contoh — tabel sengaja dibiarkan kosong
    daripada menampilkan data dummy.</p>
    <ul class="attempts">${rows || '<li>—</li>'}</ul>
    <p class="hint">Perbaikan: buka sheet → <b>File &rsaquo; Share &rsaquo; Publish to web</b> →
    pilih <i>Entire document</i> / <i>CSV</i>, lalu muat ulang. Endpoint <code>gviz</code> diblokir CORS,
    sehingga aplikasi jatuh ke CSV publik yang sudah mengizinkan <code>Access-Control-Allow-Origin</code>.</p>
    <div class="es-actions">
      <a class="btn" href="${CONFIG.RPP_SHEET_URL}" target="_blank" rel="noopener">Buka sheet DATA_DUKUNG</a>
      <a class="btn" href="${CONFIG.HAPUS_SHEET_URL}" target="_blank" rel="noopener">Buka sheet PP 47/2018</a>
      <button class="btn primary" id="retryBtn">Muat ulang</button>
    </div></div></td></tr>`;
  const rb = $('#retryBtn'); if (rb) rb.addEventListener('click', loadAll);
  $('#count').textContent = '0 baris';
}

/* ------------------------------- status/footer -------------------------- */
function renderStatus() {
  const el = $('#loadStatus');
  if (state.loading) { el.innerHTML = `<span class="dot loading"></span> Memuat…`; return; }
  const r = state.loaded.rpp, h = state.loaded.hapus;
  const rs = r && r.source ? `RPP: ${r.source.label}` : 'RPP: GAGAL';
  const hs = h && h.source ? `HAPUS: ${h.source.label}` : 'HAPUS: GAGAL';
  el.innerHTML = `<span class="dot ${r && r.source ? 'ok' : 'err'}"></span> ${esc(rs)} ` +
    `<span class="dot ${h && h.source ? 'ok' : 'err'}"></span> ${esc(hs)}` +
    (h && !h.source ? ` <button class="link" id="hapusWarn">detail</button>` : '');
  const hw = $('#hapusWarn');
  if (hw) hw.addEventListener('click', () => {
    alert('Data Penjelasan HAPUS belum bisa di-load.\n\n' +
      (h.attempts || []).map((x) => `${x.status === 'ok' ? 'OK ' : 'X  '}${x.label} — ${x.error || x.rows + ' baris'}`).join('\n'));
  });
}
function renderFooter() {
  const r = state.loaded.rpp, h = state.loaded.hapus;
  $('#footerInfo').innerHTML =
    `Sumber RPP: <b>${esc(r && r.source ? r.source.label : '—')}</b> · ` +
    `Sumber HAPUS: <b>${esc(h && h.source ? h.source.label : '—')}</b> · ` +
    `dimuat ${new Date().toLocaleString('id-ID')}`;
}

/* -------------------------------- events -------------------------------- */
function wire() {
  $('#search').addEventListener('input', (e) => { state.filters.q = e.target.value; renderTable(); });
  const sortBy = $('#sortBy');
  sortBy.addEventListener('change', () => {
    if (sortBy.value !== state.sort.key) state.sort.direction = 'asc';
    state.sort.key = sortBy.value;
    renderTable();
  });
  $('#sortDirection').addEventListener('click', () => {
    state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
    renderTable();
  });
  $('#tableHead').addEventListener('click', (e) => {
    const sortButton = e.target.closest('button[data-sort]');
    if (!sortButton) return;
    const key = sortButton.dataset.sort;
    if (state.sort.key === key) state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
    else { state.sort.key = key; state.sort.direction = 'asc'; }
    renderTable();
  });
  const kategoriSelect = $('#kategori');
  const toggle = $('#hapusToggle');
  const syncHapusToggle = () => {
    state.filters.showHapus = toggle.checked;
    $('#hapusWrap').classList.toggle('on', toggle.checked);
  };
  kategoriSelect.addEventListener('change', (e) => {
    state.filters.kategori = e.target.value;
    if (state.filters.kategori === 'HAPUS') {
      toggle.checked = true;
      syncHapusToggle();
    } else if (state.filters.kategori !== 'SEMUA') {
      toggle.checked = false;
      syncHapusToggle();
    }
    renderHero();
    renderTable();
  });
  toggle.addEventListener('change', () => {
    syncHapusToggle();
    if (!toggle.checked && state.filters.kategori === 'HAPUS') {
      state.filters.kategori = 'SEMUA';
      kategoriSelect.value = 'SEMUA';
    }
    renderHero();
    renderTable();
  });
  syncHapusToggle();

  $('#pills').addEventListener('click', (e) => {
    const chip = e.target.closest('button[data-filter]');
    if (!chip) return;
    const category = chip.dataset.filter;
    const wasActive = state.filters.kategori === category;
    state.filters.kategori = wasActive ? 'SEMUA' : category;
    state.filters.showHapus = !wasActive && category === 'HAPUS';
    toggle.checked = state.filters.showHapus;
    syncHapusToggle();
    kategoriSelect.value = state.filters.kategori;
    renderHero();
    renderTable();
  });

  const ukeBtn = $('#ukeBtn');
  ukeBtn.addEventListener('click', (e) => { e.stopPropagation(); $('#ukeMenu').classList.toggle('open'); });
  document.addEventListener('click', (e) => {
    if (!$('#ukeWrap').contains(e.target)) $('#ukeMenu').classList.remove('open');
  });
  $('#ukeClear').addEventListener('click', () => {
    state.filters.uke.clear();
    $('#ukeMenu').querySelectorAll('input').forEach((i) => { i.checked = false; });
    updateUkeLabel(); renderTable();
  });

  $('#reload').addEventListener('click', loadAll);
  $('#scrim').addEventListener('click', closeDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  $('#tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('button.act');
    if (!btn) return;
    const tr = btn.closest('tr');
    const key = tr.getAttribute('data-key');
    const item = state.visible.find((x) => keyOf(x.row) === key);
    if (!item) return;
    openDrawer(btn.dataset.act, item.row);
  });
}

/* --------------------------------- boot --------------------------------- */
wire();
renderStatus();
/* Keep the sticky table header directly under the toolbar, whatever its height. */
function syncToolbarHeight() {
  const tb = document.querySelector('.toolbar');
  if (!tb) return;
  const set = () => document.documentElement.style.setProperty('--toolbar-h', tb.offsetHeight + 'px');
  set();
  if (window.ResizeObserver) new ResizeObserver(set).observe(tb);
  else window.addEventListener('resize', set);
}
syncToolbarHeight();
loadAll();
