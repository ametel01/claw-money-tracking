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

async function loadTransactions() {
  const res = await fetch('/api/expenses/transactions?limit=40');
  const rows = await res.json();
  const mode = document.getElementById('viewMode').value;
  const el = document.getElementById('txList');
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

function money(v, currency = 'PHP') {
  const n = Number(v || 0);
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(n);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.getElementById('viewMode').addEventListener('change', async () => {
  await loadTransactions();
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
