/* script.js — SIG Kesesuaian Lahan Bawang Merah */

const API_BASE = 'http://localhost:8000';

// ── WARNA ─────────────────────────────────────────
const SUAI_COLOR = { S1:'#16a34a', S2:'#22c55e', S3:'#f59e0b', N:'#ef4444', '-':'#475569', null:'#475569' };
const CH_COLOR   = [{min:2300,max:2400,color:'#cae4b5'},{min:2400,max:2500,color:'#d9a0b2'},{min:2500,max:2600,color:'#26d6e7'},{min:2600,max:2700,color:'#796be2'},{min:2700,max:2800,color:'#cb6f9b'}];
const KL_COLOR   = {'0-3%':'#bbf7d0','3-8%':'#86efac','8-15%':'#4ade80','15-25%':'#f97316','25-45%':'#dc2626','>45%':'#7f1d1d'};
const POLA_COLOR = {'Kawasan Hortikultura':'#86efac','Kawasan Ketahanan Pangan':'#4ade80','Kawasan Permukiman Perdesaan':'#fde68a','Kawasan Permukiman Perkotaan':'#fbbf24','Kawasan Perkebunan':'#6ee7b7','Kawasan Hutan Lindung':'#166534','Kawasan Hutan Produksi Terbatas':'#15803d','Kawasan Konservasi':'#064e3b','Kawasan Perlindungan Setempat':'#065f46','Kawasan Ekosistem Mangrove':'#047857','Kawasan Perikanan Budidaya':'#0891b2','Kawasan Pariwisata':'#a78bfa','Kawasan Peruntukan Industri':'#f472b6','Kawasan Transportasi':'#9ca3af','Kawasan Pertambangan Mineral Logam':'#b45309','Badan Air':'#38bdf8'};

function getCHColor(v) {
  const n = parseFloat(v);
  for (const c of CH_COLOR) if (n >= c.min && n < c.max) return c.color;
  return '#64748b';
}

// ── PETA ──────────────────────────────────────────
const map = L.map('map', { center:[-4.57,119.77], zoom:11, zoomControl:true, preferCanvas:true });
L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
  attribution:'© Google Maps', maxZoom:20
}).addTo(map);
// ── STATE ─────────────────────────────────────────
const layerCache = {}, leafletLayers = {};

// ── STATUS API ────────────────────────────────────
async function checkApi() {
  try {
    const r = await fetch(`${API_BASE}/layers`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) {
      const dot = document.getElementById('api-dot');
      dot.className = 'w-2 h-2 rounded-full bg-green-400 pulse';
      dot.style.boxShadow = '0 0 6px #22c55e';
      document.getElementById('api-label').textContent = 'API terhubung • Siap';
      document.getElementById('api-label').style.color = '#94a3b8';
    } else throw 0;
  } catch {
    document.getElementById('api-dot').style.background = '#ef4444';
    document.getElementById('api-label').textContent = 'API tidak terhubung';
  }
}

// ── TOAST ─────────────────────────────────────────
function showToast(t) { document.getElementById('toast-text').textContent = t; document.getElementById('toast').style.display = 'flex'; }
function hideToast()  { document.getElementById('toast').style.display = 'none'; }

// ── PROGRESS ──────────────────────────────────────
function showProgress(t) {
  document.getElementById('layer-progress').style.display = 'block';
  document.getElementById('progress-label').textContent = t;
  document.getElementById('progress-fill').style.width = '30%';
}
function setProgress(p) { document.getElementById('progress-fill').style.width = p + '%'; }
function hideProgress() {
  setProgress(100);
  setTimeout(() => { document.getElementById('layer-progress').style.display = 'none'; setProgress(0); }, 500);
}

// ── SIMPLIFY GEOMETRY ─────────────────────────────
function simplifyGeoJSON(g, tol = 0.0003) {
  if (!g?.features) return g;
  g.features = g.features.map(f => { if (f.geometry) f.geometry = simplifyGeom(f.geometry, tol); return f; });
  return g;
}
function simplifyGeom(g, t) {
  if (g.type === 'Polygon')      g.coordinates = g.coordinates.map(r => simplifyRing(r, t));
  if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(p => p.map(r => simplifyRing(r, t)));
  return g;
}
function simplifyRing(ring, tol) {
  if (ring.length <= 4) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const p = out[out.length - 1], c = ring[i];
    const dx = c[0]-p[0], dy = c[1]-p[1];
    if (Math.sqrt(dx*dx+dy*dy) > tol) out.push(c);
  }
  out.push(ring[ring.length-1]);
  return out.length >= 4 ? out : ring;
}

// ── LOAD LAYER ────────────────────────────────────
const TOLS = { pola_ruang:0.0006, kemiringan_lereng:0.0004, tanaman_bawang_merah:0.0003, curah_hujan:0.0002, administrasi_wilayah:0.0001 };

async function loadLayer(name) {
  if (layerCache[name]) return layerCache[name];
  showProgress(`Mengunduh ${name.replace(/_/g,' ')}...`);
  showToast(`Memuat ${name.replace(/_/g,' ')}...`);
  const row = document.getElementById(`lrow-${name}`);
  if (row) row.style.opacity = '0.5';
  try {
    setProgress(50);
    const res = await fetch(`${API_BASE}/layer/${name}/geojson`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let data = await res.json();
    if (data.status === 'error') throw new Error(data.message);
    setProgress(80);
    data = simplifyGeoJSON(data, TOLS[name] || 0.0003);
    layerCache[name] = data;
    return data;
  } catch(e) {
    alert(`Gagal memuat "${name}"\n${e.message}`);
    return null;
  } finally {
    hideProgress(); hideToast();
    if (row) row.style.opacity = '1';
  }
}

// ── STYLE ─────────────────────────────────────────
function getStyle(name) {
  return function(f) {
    const p = f.properties;
    if (name === 'tanaman_bawang_merah') { const k=p.kelas_kesesuaian||p.suai_lahan||'-'; return {fillColor:SUAI_COLOR[k]||'#475569',color:'#0f172a',weight:0.3,fillOpacity:0.78}; }
    if (name === 'curah_hujan')          return {fillColor:getCHColor(p.nilai_curah_hujan||p.CH||0),color:'#0f172a',weight:0.4,fillOpacity:0.65};
    if (name === 'kemiringan_lereng')    { const k=p.kelas_kemiringan||p.KL||''; return {fillColor:KL_COLOR[k]||'#334155',color:'#0f172a',weight:0.2,fillOpacity:0.7}; }
    if (name === 'pola_ruang')           { const z=p.zona||p.NAMOBJ||''; return {fillColor:POLA_COLOR[z]||'#334155',color:'#0f172a',weight:0.2,fillOpacity:0.65}; }
    if (name === 'administrasi_wilayah') return {fillColor:'transparent',color:'#818cf8',weight:1.8,dashArray:'5 4',fillOpacity:0};
    return {color:'#64748b',weight:1,fillOpacity:0.4};
  };
}

// ── EACH FEATURE ──────────────────────────────────
function onEach(name) {
  return function(f, layer) {
    layer.on('click', function(e) { L.DomEvent.stopPropagation(e); showInfo(name, f.properties, e.latlng); });
    if (name !== 'administrasi_wilayah') {
      layer.on('mouseover', function() { layer.setStyle({weight:1.5,color:'#fff'}); layer.bringToFront(); });
      layer.on('mouseout',  function() { leafletLayers[name]?.resetStyle(layer); });
    }
  };
}

// ── TOGGLE ────────────────────────────────────────
async function toggleLayer(name, on) {
  if (on) {
    if (leafletLayers[name]) { map.addLayer(leafletLayers[name]); return; }
    const data = await loadLayer(name);
    if (!data) return;
    const layer = L.geoJSON(data, { style:getStyle(name), onEachFeature:onEach(name), pointToLayer:(f,ll)=>L.circleMarker(ll,{radius:5,...getStyle(name)(f)}) });
    leafletLayers[name] = layer;
    layer.addTo(map);
    if (name !== 'tanaman_bawang_merah') {
      try { map.fitBounds(layer.getBounds(), {padding:[20,20],maxZoom:13}); } catch(e){}
    }
  } else {
    if (leafletLayers[name]) map.removeLayer(leafletLayers[name]);
  }
}

// ── INFO PANEL ────────────────────────────────────
function showInfo(name, p, latlng) {
  const panel = document.getElementById('info-panel');
  const cont  = document.getElementById('info-content');
  let html = '';

  if (name === 'administrasi_wilayah') {
    html += infoBlock('Desa / Kecamatan', `<p class="text-sm font-semibold">${p.nama_desa||p.WADMKD||'-'}, ${p.kecamatan||p.WADMKC||'-'}</p>`);
  } else if (name === 'curah_hujan') {
    html += infoBlock('Curah Hujan', `<div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-cyan-400"></div><span class="text-sm font-medium">${p.nilai_curah_hujan||p.CH||'-'} mm/tahun</span></div>`);
  } else if (name === 'kemiringan_lereng') {
    const k = p.kelas_kemiringan||p.KL||'-';
    html += infoBlock('Kemiringan Lereng', `<div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-orange-400"></div><span class="text-sm font-medium">${k} — ${klLabel(k)}</span></div>`);
  } else if (name === 'pola_ruang') {
    html += infoBlock('Pola Ruang', `<p class="text-sm text-slate-300 leading-relaxed">${p.zona||p.NAMOBJ||'-'}</p>`);
  } else if (name === 'tanaman_bawang_merah') {
    const k = p.kelas_kesesuaian||p.suai_lahan||'-';
    html += `<div class="bg-${suaiBg(k)} border border-${suaiBorder(k)} rounded-xl p-3 flex items-center justify-between">
      <span class="text-xs font-bold ${suaiText(k)}">Kelas Kesesuaian</span>
      ${badge(k)}
    </div>`;
    if (p.pembatas) html += infoBlock('Faktor Pembatas', `<p class="text-xs text-slate-300">${p.pembatas}</p>`);
    if (p.pH)       html += infoGrid([['pH Tanah', p.pH], ['Drainase', p.Drainase||'-']]);
    if (p.Tekstur)  html += infoBlock('Tekstur Tanah', `<p class="text-xs text-slate-300">${p.Tekstur}</p>`);
  }

  if (latlng) html += infoBlock('Koordinat', `<p class="text-xs font-mono text-slate-400">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</p>`);

  cont.innerHTML = html;
  panel.style.display = 'block';
  panel.className = panel.className.replace('slide-up','') + ' slide-up';
  if (latlng) querySuitability(latlng.lat, latlng.lng);
}

function infoBlock(label, content) {
  return `<div><span class="text-[10px] text-slate-500 uppercase font-bold tracking-widest">${label}</span><div class="mt-1">${content}</div></div>`;
}
function infoGrid(rows) {
  return `<div class="grid grid-cols-2 gap-3">${rows.map(([k,v])=>`<div><span class="text-[10px] text-slate-500 uppercase font-bold tracking-widest block mb-1">${k}</span><p class="text-xs font-medium">${v||'-'}</p></div>`).join('')}</div>`;
}

function badge(k) {
  const cfg = {S1:{bg:'bg-green-500',text:'S1 — SANGAT SESUAI'},S2:{bg:'bg-green-500',text:'S2 — CUKUP SESUAI'},S3:{bg:'bg-amber-500',text:'S3 — MARGINAL'},N:{bg:'bg-red-500',text:'N — TIDAK SESUAI'}}[k]||{bg:'bg-slate-600',text:'TIDAK ADA DATA'};
  return `<span class="px-2 py-1 ${cfg.bg} text-white text-[9px] font-bold rounded-lg">${cfg.text}</span>`;
}
function suaiBg(k)     { return {S1:'green-500/10',S2:'green-500/10',S3:'amber-500/10',N:'red-500/10'}[k]||'slate-700/30'; }
function suaiBorder(k) { return {S1:'green-500/30',S2:'green-500/30',S3:'amber-500/30',N:'red-500/30'}[k]||'slate-600/30'; }
function suaiText(k)   { return {S1:'text-green-400',S2:'text-green-400',S3:'text-amber-400',N:'text-red-400'}[k]||'text-slate-400'; }
function klLabel(k)    { return {'0-3%':'Datar','3-8%':'Landai','8-15%':'Agak Miring','15-25%':'Miring','25-45%':'Curam','>45%':'Sangat Curam'}[k]||'-'; }
function closeInfo()   { document.getElementById('info-panel').style.display = 'none'; }

// ── SUITABILITY QUERY ─────────────────────────────
async function querySuitability(lat, lon) {
  try {
    const res  = await fetch(`${API_BASE}/suitability?lat=${lat}&lon=${lon}`);
    const json = await res.json();
    if (json.status !== 'success' || !json.data) return;
    const d = json.data, cont = document.getElementById('info-content');
    const old = document.getElementById('suit-extra');
    if (old) old.remove();
    const k = d.kelas_kesesuaian;
    let ex = `<div id="suit-extra" class="border-t border-white/10 pt-3 space-y-3">`;
    ex += `<p class="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Analisis Spasial Lengkap</p>`;
    if (d.nama_desa||d.kecamatan) ex += infoBlock('Wilayah', `<p class="text-sm font-semibold">${d.nama_desa||'-'}, ${d.kecamatan||'-'}</p>`);
    if (d.nilai_curah_hujan) ex += infoGrid([['Curah Hujan', `${d.nilai_curah_hujan} mm/th`], ['Kemiringan', d.kelas_kemiringan||'-']]);
    if (d.pola_ruang) ex += infoBlock('Pola Ruang', `<p class="text-xs text-slate-300">${d.pola_ruang}</p>`);
    if (k) ex += `<div class="bg-${suaiBg(k)} border border-${suaiBorder(k)} rounded-xl p-3 flex items-center justify-between"><span class="text-xs font-bold ${suaiText(k)}">Kelas Kesesuaian</span>${badge(k)}</div>`;
    ex += `</div>`;
    cont.insertAdjacentHTML('beforeend', ex);
  } catch {}
}

// ── KLIK PETA ─────────────────────────────────────
map.on('click', function(e) {
  if (!isDrawing) {
    document.getElementById('info-content').innerHTML = `<p class="text-xs text-slate-500 text-center py-3">Mengambil info lokasi...</p>`;
    document.getElementById('info-panel').style.display = 'block';
    querySuitability(e.latlng.lat, e.latlng.lng);
  }
});

// ── DRAW POLYGON ──────────────────────────────────
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);
let drawCtrl = null, isDrawing = false, aChart = null;

function startDraw() {
  clearDraw(); isDrawing = true;
  drawCtrl = new L.Draw.Polygon(map, {
    shapeOptions: { color:'#3b82f6', fillColor:'#3b82f6', fillOpacity:0.1, weight:2, dashArray:'6 3' }
  });
  drawCtrl.enable();
  const btn = document.getElementById('btn-draw');
  btn.innerHTML = `<div class="w-4 h-4 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin"></div><span>Sedang menggambar...</span>`;
  btn.disabled = true;
}

map.on(L.Draw.Event.CREATED, async function(e) {
  isDrawing = false;
  const btn = document.getElementById('btn-draw');
  btn.innerHTML = `<svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg><span>Gambar Polygon Area</span>`;
  btn.disabled = false;
  document.getElementById('btn-clear').style.display = 'block';
  drawnItems.addLayer(e.layer);
  await analyzePolygon(e.layer.toGeoJSON());
});

async function analyzePolygon(geojson) {
  showToast('Menganalisis area...');
  const box = document.getElementById('analyze-result');
  box.style.display = 'block';
  box.innerHTML = `<div class="bg-slate-800/60 rounded-xl p-3"><p class="text-xs text-slate-500 text-center">Menghitung luas...</p></div>`;
  try {
    const res  = await fetch(`${API_BASE}/analyze`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({coordinates:geojson.geometry.coordinates}) });
    const data = await res.json();
    if (data.status === 'error') throw new Error(data.message);
    renderAnalyze(data.results || []);
  } catch(e) {
    box.innerHTML = `<p class="text-xs text-red-400 px-2">Gagal: ${e.message}</p>`;
  } finally { hideToast(); }
}

function renderAnalyze(rows) {
  const box = document.getElementById('analyze-result');
  const cv  = document.getElementById('analyzeChart');
  const total = rows.reduce((s,r) => s+(parseFloat(r.luas_hektar)||0), 0);
  if (!rows.length) { box.innerHTML = `<p class="text-xs text-slate-500 text-center py-2">Tidak ada data di area ini.</p>`; cv.style.display='none'; return; }

  let html = `<div class="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
    <div class="px-3 py-2 border-b border-slate-700"><p class="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Hasil Analisis Luas</p></div>`;
  rows.forEach(r => {
    const k = r.kelas||'-', luas = parseFloat(r.luas_hektar).toFixed(2), pct = total>0?((r.luas_hektar/total)*100).toFixed(1):0;
    html += `<div class="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 last:border-0">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-sm flex-shrink-0" style="background:${SUAI_COLOR[k]||'#475569'}"></span>
        <span class="text-xs font-medium">${k}</span>
      </div>
      <div class="text-right">
        <div class="text-xs font-bold font-mono text-blue-400">${luas} ha</div>
        <div class="text-[10px] text-slate-500">${pct}%</div>
      </div>
    </div>`;
  });
  html += `<div class="px-3 py-2 bg-slate-900/50"><p class="text-[10px] text-slate-500">Total: <span class="text-slate-300 font-semibold">${total.toFixed(2)} ha</span></p></div></div>`;
  box.innerHTML = html;

  cv.style.display = 'block';
  if (aChart) aChart.destroy();
  aChart = new Chart(cv, {
    type:'doughnut',
    data:{ labels:rows.map(r=>r.kelas||'-'), datasets:[{data:rows.map(r=>parseFloat(r.luas_hektar)||0), backgroundColor:rows.map(r=>SUAI_COLOR[r.kelas]||'#475569'), borderColor:'#0f172a', borderWidth:2}] },
    options:{ responsive:true, cutout:'65%', plugins:{ legend:{labels:{color:'#94a3b8',font:{size:10},boxWidth:10}}, tooltip:{callbacks:{label:c=>` ${c.parsed.toFixed(2)} ha (${((c.parsed/total)*100).toFixed(1)}%)`}} } }
  });
}

function clearDraw() {
  drawnItems.clearLayers();
  if (drawCtrl) drawCtrl.disable();
  isDrawing = false;
  document.getElementById('analyze-result').style.display = 'none';
  document.getElementById('analyzeChart').style.display   = 'none';
  document.getElementById('btn-clear').style.display      = 'none';
  const btn = document.getElementById('btn-draw');
  btn.innerHTML = `<svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg><span>Gambar Polygon Area</span>`;
  btn.disabled = false;
  if (aChart) { aChart.destroy(); aChart = null; }
}

// ── REKOMENDASI ───────────────────────────────────
async function loadRecommendation() {
  showToast('Menghitung rekomendasi...');
  const box = document.getElementById('rekomendasi-result');
  box.style.display = 'block';
  box.innerHTML = `<div class="bg-slate-800/60 rounded-xl p-3"><p class="text-xs text-slate-500 text-center">Memproses...</p></div>`;
  try {
    const res  = await fetch(`${API_BASE}/recommendation`);
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    const data = json.rekomendasi || [];
    let html = `<div class="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
      <div class="px-3 py-2 border-b border-slate-700"><p class="text-[10px] text-green-400 font-bold uppercase tracking-widest">Top Rekomendasi Lahan</p></div>`;
    if (!data.length) {
      html += `<p class="text-xs text-slate-500 text-center py-3">Tidak ada data.</p>`;
    } else {
      data.forEach((r,i) => {
        html += `<div class="flex items-center gap-3 px-3 py-2.5 border-b border-slate-700/50 last:border-0">
          <span class="text-[10px] text-slate-600 w-4 flex-shrink-0">${i+1}</span>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold truncate">${r.nama_desa||'-'}</p>
            <p class="text-[10px] text-slate-500 mt-0.5">${r.kelas_kesesuaian||'-'}</p>
          </div>
          <span class="text-xs font-bold font-mono text-green-400 flex-shrink-0">${r.luas_total_hektar||'-'} ha</span>
        </div>`;
      });
    }
    html += `</div>`;
    box.innerHTML = html;
  } catch(e) {
    box.innerHTML = `<p class="text-xs text-red-400 px-2">Gagal: ${e.message}</p>`;
  } finally { hideToast(); }
}

// ── INIT ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkApi();
  await toggleLayer('tanaman_bawang_merah', true);
});