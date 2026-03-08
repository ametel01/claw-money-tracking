let cachedRows = [];
let activeMonth = null;
const PIE_COLORS = ['#2f6fed','#00a88f','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f97316','#e11d48','#64748b'];
let categoryColorMap = new Map();

async function loadOverview() {
  const res = await fetch('/api/expenses/overview');
  const data = await res.json();
  const kpis = document.getElementById('kpis');
  const cards = [
    ['Income', money(data.income)],
    ['Expenses', money(data.expenses)],
    ['Net', money(data.net)],
    ['Transactions', String(data.txCount || 0)],
  ];
  kpis.innerHTML = cards.map(([label, value]) => `<div class="card"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
}

function monthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
}

function renderMonthTabs(rows) {
  const tabsEl = document.getElementById('monthTabs');
  const months = [...new Set(rows.map(r => monthKey(r.tx_date)).filter(Boolean))].sort().reverse();
  if (!months.length) {
    tabsEl.innerHTML = '';
    activeMonth = null;
    return;
  }
  if (!activeMonth || !months.includes(activeMonth)) activeMonth = months[0];

  tabsEl.innerHTML = months.map(ym => {
    const count = rows.filter(r => monthKey(r.tx_date) === ym).length;
    const cls = ym === activeMonth ? 'tab-btn active' : 'tab-btn';
    return `<button class="${cls}" data-month="${ym}">${monthLabel(ym)} (${count})</button>`;
  }).join('');

  tabsEl.querySelectorAll('button[data-month]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeMonth = btn.getAttribute('data-month');
      renderMonthTabs(cachedRows);
      renderTransactions();
    });
  });
}

function buildCategoryColorMap(rows) {
  const expenseRows = rows.filter(r => (r.category_kind || 'expense') === 'expense' && Number(r.amount_home ?? r.amount ?? 0) < 0);
  const totals = new Map();
  for (const r of expenseRows) {
    const cat = r.category_name || 'Uncategorized';
    const amt = Math.abs(Number(r.amount_home ?? r.amount ?? 0));
    totals.set(cat, (totals.get(cat) || 0) + amt);
  }
  const ranked = [...totals.entries()].sort((a,b)=>b[1]-a[1]).map(([cat])=>cat);
  categoryColorMap = new Map();
  ranked.forEach((cat, i) => categoryColorMap.set(cat, PIE_COLORS[i % PIE_COLORS.length]));
}

function catColor(cat) {
  return categoryColorMap.get(cat) || PIE_COLORS[0];
}

function renderCategoryPie(rows) {
  const pieEl = document.getElementById('catPie');
  const legendEl = document.getElementById('catLegend');

  const spendRows = rows.filter(r => (r.category_kind || 'expense') === 'expense' && Number(r.amount_home ?? r.amount ?? 0) < 0);
  const byCat = new Map();
  for (const r of spendRows) {
    const name = r.category_name || 'Uncategorized';
    const amt = Math.abs(Number(r.amount_home ?? r.amount ?? 0));
    byCat.set(name, (byCat.get(name) || 0) + amt);
  }

  const items = [...byCat.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8);
  const total = items.reduce((s,[,v])=>s+v,0);

  if (!items.length || total <= 0) {
    pieEl.style.background = 'conic-gradient(#dbe7ff 0 360deg)';
    legendEl.innerHTML = '<div class="muted">No category data yet.</div>';
    return;
  }

  let start = 0;
  const segs = items.map(([name,val],i) => {
    const pct = (val / total) * 100;
    const end = start + pct;
    const color = catColor(name);
    const seg = `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
    start = end;
    return { seg, name, val, pct, color };
  });

  pieEl.style.background = `conic-gradient(${segs.map(s=>s.seg).join(',')})`;
  legendEl.innerHTML = segs.map(s =>
    `<div class="legend-item"><span class="legend-left"><span class="swatch" style="background:${s.color}"></span><span class="legend-name">${escapeHtml(s.name)}</span></span><span class="legend-val">${s.pct.toFixed(1)}%</span></div>`
  ).join('');
}

function weekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const day = (d.getDay() + 6) % 7; // Monday=0
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}

function weekLabel(weekStartStr) {
  const d = new Date(`${weekStartStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return weekStartStr;
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const a = d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  const b = end.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  return `${a}-${b}`;
}

function groupWeeklyCategorySpend(rows) {
  const expenseRows = rows.filter(r => (r.category_kind || 'expense') === 'expense' && Number(r.amount_home ?? r.amount ?? 0) < 0);
  const weeks = [...new Set(expenseRows.map(r => weekStart(r.tx_date)).filter(Boolean))].sort();
  const series = new Map();

  for (const r of expenseRows) {
    const cat = r.category_name || 'Uncategorized';
    const w = weekStart(r.tx_date);
    if (!w) continue;
    const val = Math.abs(Number(r.amount_home ?? r.amount ?? 0));
    if (!series.has(cat)) series.set(cat, new Map());
    series.get(cat).set(w, (series.get(cat).get(w) || 0) + val);
  }

  return { weeks, series };
}

function renderLineChart(rows) {
  const svg = document.getElementById('lineChart');
  const legend = document.getElementById('lineLegend');
  const W = 900, H = 320, L = 46, R = 10, T = 12, B = 36;

  const { weeks, series } = groupWeeklyCategorySpend(rows);
  if (!weeks.length) {
    svg.innerHTML = '';
    legend.innerHTML = '<div class="muted">No expense data yet.</div>';
    return;
  }

  const ranked = [...series.entries()].sort((a,b) => {
    const ta=[...a[1].values()].reduce((s,v)=>s+v,0);
    const tb=[...b[1].values()].reduce((s,v)=>s+v,0);
    return tb-ta;
  }).slice(0, 10);

  let maxY = 0;
  for (const [,wmap] of ranked) for (const v of wmap.values()) maxY = Math.max(maxY, v);
  if (maxY <= 0) maxY = 1;

  const x = (i) => L + (weeks.length === 1 ? 0 : (i * (W - L - R) / (weeks.length - 1)));
  const y = (v) => T + (H - T - B) * (1 - v / maxY);

  const yTicks = 4;
  const grid = [];
  for (let i=0;i<=yTicks;i++) {
    const v = maxY * (i / yTicks);
    const yy = y(v);
    grid.push(`<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#e6eefb" stroke-width="1"/>`);
    grid.push(`<text x="${L-6}" y="${yy+4}" text-anchor="end" font-size="11" fill="#6b7f99">${Math.round(v).toLocaleString()}</text>`);
  }

  const xLabels = weeks.map((w,i)=>`<text x="${x(i)}" y="${H-12}" text-anchor="middle" font-size="11" fill="#6b7f99">${escapeHtml(weekLabel(w))}</text>`);

  const paths = [];
  const legends = [];
  ranked.forEach(([cat,wmap]) => {
    const color = catColor(cat);
    const pts = weeks.map((w,i)=>`${x(i)},${y(wmap.get(w)||0)}`).join(' ');
    paths.push(`<polyline fill="none" stroke="${color}" stroke-width="2.2" points="${pts}"/>`);
    const total = [...wmap.values()].reduce((s,v)=>s+v,0);
    legends.push(`<div class="legend-item"><span class="legend-left"><span class="swatch" style="background:${color}"></span><span class="legend-name">${escapeHtml(cat)}</span></span><span class="legend-val">${money(total,'PHP')}</span></div>`);
  });

  svg.innerHTML = [
    ...grid,
    `<line x1="${L}" y1="${H-B}" x2="${W-R}" y2="${H-B}" stroke="#b9c9e4"/>`,
    ...xLabels,
    ...paths
  ].join('');
  legend.innerHTML = legends.join('');
}

function renderTransactions() {
  const mode = document.getElementById('viewMode').value;
  const el = document.getElementById('txList');
  const rows = activeMonth ? cachedRows.filter(r => monthKey(r.tx_date) === activeMonth) : cachedRows;
  buildCategoryColorMap(cachedRows);
  renderCategoryPie(cachedRows);
  renderLineChart(cachedRows);

  el.innerHTML = rows.map(r => {
    const amtHome = Number(r.amount_home ?? r.amount ?? 0);
    const amtNative = Number(r.amount_original ?? r.amount ?? 0);
    const cls = r.category_kind === 'transfer' ? 'neutral' : (amtHome < 0 ? 'expense' : 'income');

    let shown = '';
    if (mode === 'native') shown = money(amtNative, r.currency || r.account_currency || 'PHP');
    else if (mode === 'both') shown = `${money(amtHome, 'PHP')} · ${money(amtNative, r.currency || r.account_currency || 'PHP')}`;
    else shown = money(amtHome, 'PHP');

    if (r.category_kind === 'transfer') shown = '↔︎ ' + shown.replace('-', '');

    return `<div class="tx"><div class="meta"><div class="desc">${escapeHtml(r.description || '(no description)')}</div><div class="sub">${r.tx_date} • ${escapeHtml(r.account_name || '')} (${escapeHtml(r.account_currency || r.currency || 'PHP')}) • ${escapeHtml(r.category_name || 'Uncategorized')}</div></div><div class="amt ${cls}">${shown}</div></div>`;
  }).join('');
}

async function loadTransactions() {
  const res = await fetch('/api/expenses/transactions?limit=400');
  cachedRows = await res.json();
  renderMonthTabs(cachedRows);
  renderTransactions();
}

function money(v, currency = 'PHP') {
  const n = Number(v || 0);
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(n);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('viewMode').addEventListener('change', async () => {
  renderTransactions();
});

document.getElementById('fxForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rate = Number(document.getElementById('usdPhpRate').value || 0);
  if (!rate || rate <= 0) return;
  await fetch('/api/expenses/fx-rate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base: 'USD', quote: 'PHP', rate })
  });
  await loadOverview();
  await loadTransactions();
});

document.getElementById('fxBackfillBtn').addEventListener('click', async () => {
  const res = await fetch('/api/expenses/fx-backfill', { method: 'POST' });
  const data = await res.json();
  const out = document.getElementById('importResult');
  out.textContent = data.ok ? `Backfilled FX for ${data.updated} USD transaction(s).` : `FX backfill failed: ${data.error || 'unknown error'}`;
  await loadOverview();
  await loadTransactions();
});

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const accountName = document.getElementById('accountName').value.trim();
  const file = document.getElementById('pdfFile').files[0];
  const out = document.getElementById('importResult');
  if (!file) return;

  const fd = new FormData();
  fd.append('accountName', accountName);
  fd.append('file', file);

  out.textContent = 'Parsing PDF…';
  const res = await fetch('/api/expenses/import-pdf', { method: 'POST', body: fd });
  const data = await res.json();
  if (!data.ok) {
    out.textContent = `Import failed: ${data.error || 'unknown error'}`;
    return;
  }
  out.textContent = `Imported ${data.insertedTransactions} transaction(s). Batch #${data.batchId}, parsed lines: ${data.parsedRows}.`;
  await loadOverview();
  await loadTransactions();
});

loadOverview();
loadTransactions();
