/* ============================================================================
 * app.js — UI + loading orchestration for RPP PNBP BMKG 2026
 * ==========================================================================*/
import {
  CONFIG, rppSources, hapusSources,
  parseCSV, gvizToRows, normRpp, normPP47,
  hierarchy, classifyTarif, fmtTarif, percentChange,
  resolveUke, sortRows, computeStats,
} from './data.js';

const state = {
  rpp: [], hapus: [], oldMap: {},
  visible: [],
  ukeList: [],
  loading: true,
  loaded: { rpp: null, hapus: null },
  usingSnapshot: false, snapshotAt: null,
  stats: null,
  filters: { q: '', uke: new Set(), kategori: 'SEMUA', showHapus: false },
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

async function fetchText(url, timeout = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { mode: 'cors', redirect: 'follow', signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally { clearTimeout(t); }
}

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
    script.src = url.replace('out:json', 'out:json;responseHandler:' + cb);
    document.head.appendChild(script);
  });
}

function jsonFromGvizText(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('bentuk respons tidak dikenal');
  return JSON.parse(text.slice(a, b + 1));
}

async function loadRpp() {
  const attempts = [];
  for (const src of rppSources()) {
    try {
      let rows;
      if (src.kind === 'jsonp') {
        const json = await loadJsonp(src.url);
        rows = gvizToRows(json);
      } else {
        const text = await fetchText(src.url);
        rows = src.format === 'json' ? gvizToRows(jsonFromGvizText(text)) : parseCSV(text);
      }
      const rpp = normRpp(rows);
      if (!rpp.length) throw new Error('0 baris valid');
      attempts.push({ id: src.id, label: src.label, status: 'ok', rows: rpp.length });
      return { rpp, source: src, attempts };
    } catch (e) {
      attempts.push({ id: src.id, label: src.label, status: 'fail', error: e.message });
    }
  }
  return { rpp: [], source: null, attempts };
}

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
  let [r, h] = await Promise.all([loadRpp(), loadHapus()]);

  let snap = null;
  if (!r.rpp.length || !h.hapusList.length) {
    try { snap = await fetch('./snapshot.json', { cache: 'no-store' }).then((x) => {
      if (!x.ok) throw new Error('HTTP ' + x.status); return x.json();
    }); } catch (e) { snap = null; }
  }
  if (snap) {
    if (!r.rpp.length && Array.isArray(snap.rpp) && snap.rpp.length) {
      r = { rpp: snap.rpp, source: { id: 'snapshot', label: 'Snapshot lokal (data asli)' },
            attempts: [...r.attempts, { id: 'snapshot', label: 'Snapshot lokal', status: 'ok', rows: snap.rpp.length }] };
      state.usingSnapshot = true;
    }
    if (!h.hapusList.length && Array.isArray(snap.hapus) && snap.hapus.length) {
      h = { oldMap: snap.oldMap || {}, hapusList: snap.hapus, source: { id: 'snapshot', label: 'Snapshot lokal (data asli)' },
            attempts: [...h.attempts, { id: 'snapshot', label: 'Snapshot lokal', status: 'ok', rows: snap.hapus.length }] };
      state.usingSnapshot = true;
    }
    state.snapshotAt = snap.capturedAt || null;
  }

  state.rpp = r.rpp;
  state.hapus = h.hapusList;
  state.oldMap = h.oldMap;
  state.loaded = {
    rpp: { source: r.source, attempts: r.attempts },
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
  const el = $('#notice'); if (!el) return;
  if (!state.usingSnapshot) { el.hidden = true; el.innerHTML = ''; return; }
  const when = state.snapshotAt ? new Date(state.snapshotAt).toLocaleString('id-ID') : '—';
  el.hidden = false;
  el.innerHTML = '&#9888;&#65039; Sumber langsung tidak dapat dijangkau, sehingga tabel memuat ' +
    '<b>snapshot data asli</b> (diambil ' + esc(when) + '). Tekan <b>Muat ulang</b> untuk mencoba live lagi.';
}

function iconFor(row) {
  const text = [row.jenis, row.subjenis, row.nama, row.detil, row.namaLama, row.pathLama && row.pathLama.join(' ')]
    .filter(Boolean).join(' ').toLowerCase();
  if (/penerbangan|navigasi|bandara|airnav|aviation/.test(text)) return '✈️';
  if (/maritim|laut|pelayaran|pelabuhan|pantai|samudra|ocean|iklim mar/.test(text)) return '🌊';
  if (/vulkan|gunung|letusan|kegempaan|gempa|seismik|seismolog|geofisika|tsunami/.test(text)) return '🌋';
  if (/suhu|temperatur|udara atas|rawinsonde|klimatologi|iklim/.test(text)) return '🌡️';
  return '🌤️';
}

function katBadge(kat) {
  const map = {
    BARU: 'badge-green', UBAH: 'badge-amber', TETAP: 'badge-blue', HAPUS: 'badge-red',
  };
  return `<span class="badge ${map[kat] || ''}">${esc(kat)}</span>`;
}

function currentRows() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let base = state.filters.showHapus ? [...state.rpp, ...state.hapus] : state.rpp.slice();
  const ukeResolved = resolveUke(base);

  const out = [];
  base.forEach((row, i) => {
    const info = ukeResolved[i];
    if (f.uke.size && !f.uke.has(info.uke)) return;
    if (f.kategori !== 'SEMUA') {
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
  return { items: out, raw: base, ukeResolved };
}

function renderHero() {
  const s = state.stats || { semula: 0, rpp: 0, baru: 0, ubah: 0, tetap: 0, hapus: 0, pct: {} };
  const sum = (s.baru + s.ubah + s.tetap + s.hapus) || 1;
  const seg = (n, cls) => `<span class="seg ${cls}" style="width:${(n / sum) * 100}%"></span>`;
  $('#pills').innerHTML = `
    <span class="pill pill-total"><b>${s.semula}</b> SEMULA</span>
    <span class="pill"><b>${s.rpp}</b> RPP</span>
    <span class="pill pill-green"><b>${s.baru}</b> BARU</span>
    <span class="pill pill-amber"><b>${s.ubah}</b> UBAH</span>
    <span class="pill pill-blue"><b>${s.tetap}</b> TETAP</span>
    <span class="pill pill-red"><b>${s.hapus}</b> HAPUS</span>`;
  $('#progress').innerHTML =
    seg(s.baru, 'seg-green') + seg(s.ubah, 'seg-amber') + seg(s.tetap, 'seg-blue') + seg(s.hapus, 'seg-red');
}

function buildUkeFilter() {
  const box = $('#ukeMenuItems');
  box.innerHTML = state.ukeList.map((u) =>
    `<label class="chk"><input type="checkbox" value="${esc(u)}" ${state.filters.uke.has(u) ? 'checked' : ''}><span>${esc(u)}</span></label>`
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
    return `<div class="tarif"><span class="t-old">—</span><span class="arrow">&rarr;</span>` +
      `<b class="t-green">${esc(newTxt)}</b>` +
      (row.satuan ? `<span class="satuan">${esc(row.satuan)}</span>` : '') + `</div>`;
  }
  if (row.kategori === 'UBAH') {
    const oldRec = state.oldMap[row.idLama];
    const oldT = oldRec ? classifyTarif(oldRec.tarifLama) : null;
    const pc = oldT ? percentChange(oldT, nt) : null;
    let badge = '';
    if (pc != null) {
      const up = pc > 0;
      badge = `<span class="chip ${up ? 'chip-up' : (pc < 0 ? 'chip-down' : 'chip-flat')}">${up ? '+' : ''}${pc}%</span>`;
    } else if (oldT && oldT.raw) {
      badge = `<span class="chip chip-flat">dari ${esc(fmtTarif(oldT))}</span>`;
    }
    return `<div class="tarif"><b class="t-amber">${esc(newTxt)}</b>${badge}` +
      (row.satuan ? `<span class="satuan">${esc(row.satuan)}</span>` : '') + `</div>`;
  }
  return `<div class="tarif"><b class="t-blue">${esc(newTxt)}</b>` +
    `<span class="chip chip-flat">0%</span>` +
    (row.satuan ? `<span class="satuan">${esc(row.satuan)}</span>` : '') + `</div>`;
}

function idCell(row) {
  if (row.type === 'hapus') {
    return `<div class="idcol"><div class="idbaru id-hapus">${esc(row.idLama)}</div></div>`;
  }
  const bar = row.idBaru != null ? `<div class="idbaru">ID: ${esc(row.idBaru)}</div>` : '';
  const lama = row.idLama ? `<div class="idlama">&#9492;&#9472; ${esc(row.idLama)}</div>` : '';
  return `<div class="idcol">${bar}${lama}</div>`;
}

function hierCell(row) {
  const icon = `<span class="icon">${iconFor(row)}</span>`;
  if (row.type === 'hapus') {
    const path = (row.pathLama || []).join(' &rsaquo; ');
    return `<div class="hier">${icon}<span class="parents">${esc(path)}</span>` +
      `<span class="leaf leaf-hapus">${esc(row.namaLama)}</span></div>`;
  }
  const h = hierarchy(row);
  const parents = h.parents.map((p) => esc(p)).join(' <i>&rsaquo;</i> ');
  return `<div class="hier">${icon}` +
    (parents ? `<span class="parents">${parents} <i>&rsaquo;</i> </span>` : '') +
    `<span class="leaf">${esc(h.leaf)}</span></div>`;
}

function rowHtml(item) {
  const { row, uke, inherited } = item;
  const isHapus = row.type === 'hapus';
  const cls = isHapus ? 'row row-hapus' : 'row';
  const ukePill = uke
    ? `<span class="ukepill ${inherited ? 'uke-inherited' : ''}" title="${inherited ? 'Inherited from above' : 'UKE II: ' + esc(uke)}">${esc(uke)}</span>`
    : `<span class="uke-empty">—</span>`;
  const kat = isHapus ? katBadge('HAPUS') : katBadge(row.kategori);
  const act = isHapus
    ? `<button class="act act-hapus" data-act="hapus" title="Penjelasan HAPUS (PP 47/2018)">${ICON_FILE}</button>`
    : `<button class="act" data-act="rpp" title="Detail 7 field">${ICON_EYE}</button>`;
  return `<tr class="${cls}" data-key="${esc(keyOf(row))}">` +
    `<td class="td-id">${idCell(row)}</td>` +
    `<td class="td-hier">${hierCell(row)}</td>` +
    `<td class="td-uke">${ukePill}</td>` +
    `<td class="td-kat">${kat}</td>` +
    `<td class="td-tarif">${tarifCell(row)}</td>` +
    `<td class="td-act">${act}</td></tr>`;
}

const ICON_EYE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>';

function keyOf(row) {
  return row.type === 'hapus' ? 'H:' + row.idLama : 'R:' + (row.idBaru != null ? row.idBaru : row.idLama);
}

function renderTable() {
  const { items } = currentRows();
  const sorted = sortRows(items.map((x) => x.row), state.filters.showHapus);
  const byKey = new Map(items.map((x) => [keyOf(x.row), x]));
  state.visible = sorted.map((r) => byKey.get(keyOf(r))).filter(Boolean);

  const tbody = $('#tbody');
  if (state.loading) {
    tbody.innerHTML = `<tr><td colspan="6" class="center muted">Memuat data…</td></tr>`;
    return;
  }
  if (!state.rpp.length) { renderEmpty(); return; }
  if (!state.visible.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="center muted">Tidak ada baris yang cocok dengan filter.</td></tr>`;
    $('#count').textContent = '0 baris';
    return;
  }
  tbody.innerHTML = state.visible.map(rowHtml).join('');
  $('#count').textContent = `${state.visible.length} baris`;
}

function openDrawer(kind, row) {
  const body = $('#drawerBody');
  if (kind === 'rpp') {
    const h = hierarchy(row);
    const tarifTxt = (fmtTarif(classifyTarif(row.tarif)) || '—') + (row.satuan ? ' · ' + row.satuan : '');
    $('#drawerTitle').textContent = 'Detail Layanan RPP';
    $('#drawerSub').innerHTML = esc(h.leaf) + katBadge(row.kategori).replace('badge', 'badge inline') +
      `<div class="dmeta">ID BARU <b>${esc(row.idBaru != null ? row.idBaru : '—')}</b>` +
      (row.idLama ? ` &middot; ID LAMA <b class="mono">${esc(row.idLama)}</b>` : '') +
      ` &middot; UKE II <b>${esc(row.uke || '—')}</b> &middot; Tarif <b>${esc(tarifTxt)}</b></div>`;
    body.innerHTML =
      field('Output / Tipe Data', row.output) +
      field('Dasar Hukum', row.hukum) +
      field('Deskripsi Layanan', row.deskripsi) +
      field('Pengguna Saat Ini', row.pengguna) +
      field('Rata-rata Permintaan (3 tahun)', row.rata3) +
      field('Pendapatan 3 Tahun', row.pendapatan) +
      field('Benchmarking', row.bench);
  } else {
    const tarifTxt = (fmtTarif(classifyTarif(row.tarifLama)) || '—') + (row.satuanLama ? ' · ' + row.satuanLama : '');
    $('#drawerTitle').textContent = 'Penjelasan HAPUS (PP 47/2018)';
    $('#drawerSub').innerHTML = esc(row.namaLama) + katBadge('HAPUS').replace('badge', 'badge inline') +
      `<div class="dmeta">ID LAMA <b class="mono">${esc(row.idLama)}</b> &middot; UKE II <b>${esc(row.ukeLama || '—')}</b> &middot; Tarif lama <b>${esc(tarifTxt)}</b></div>`;
    body.innerHTML =
      `<div class="warn">Data Penjelasan HAPUS diambil dari kolom P &amp; X sheet PP 47/2018 (gid 0) &mdash; tanpa data contoh.</div>` +
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
function closeDrawer() {
  $('#drawer').classList.remove('open');
  $('#scrim').classList.remove('open');
}

function renderEmpty() {
  const a = state.loaded.rpp ? state.loaded.rpp.attempts : [];
  const rows = a.map((x) =>
    `<li class="${x.status}">${x.status === 'ok' ? '&#10003;' : '&#10007;'} <b>${esc(x.label)}</b>` +
    (x.status === 'ok' ? ` — ${x.rows} baris` : ` — ${esc(x.error || '')}`) + `</li>`).join('');
  $('#tbody').innerHTML = `<tr><td colspan="6"><div class="emptystate">
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

function wire() {
  $('#search').addEventListener('input', (e) => { state.filters.q = e.target.value; renderTable(); });
  $('#kategori').addEventListener('change', (e) => { state.filters.kategori = e.target.value; renderTable(); });

  const toggle = $('#hapusToggle');
  const sync = () => {
    state.filters.showHapus = toggle.checked;
    $('#hapusWrap').classList.toggle('on', toggle.checked);
    renderTable();
  };
  toggle.addEventListener('change', sync);
  sync();

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

wire();
renderStatus();
loadAll();
