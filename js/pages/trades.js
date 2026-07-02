// ============================================================================
// trades.html controller — the full Trade History experience: search, sort,
// advanced filters, pagination, edit/duplicate/delete, a recycle bin with
// restore, bulk select + bulk delete/export, and CSV/JSON import/export.
// Everything operates on the local IndexedDB copy via tradesRepo; the sync
// manager (already running from a shared pattern) pushes changes in the
// background exactly like the dashboard does.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { tradesRepo } from '../repositories/index.js';
import { openTradeModal } from '../components/trade-modal.js';
import { tradesToCSV, parseCSV, normalizeImportedTrade, downloadFile } from '../lib/csv.js';
import { applyThemeForUser } from '../theme.js';

const user = await requireAuth();
if (user) await applyThemeForUser(user.id);
if (user) {
  document.getElementById('userName').textContent = user.display_name || user.email;
  document.getElementById('userAvatar').textContent = (user.display_name || user.email).slice(0, 2).toUpperCase();
  document.getElementById('userFoot').addEventListener('click', async () => {
    if (confirm('Sign out of this device?')) { await logout(); window.location.href = 'login.html'; }
  });
}

// ---------------------------------------------------------------------------
// Sync status indicator (identical pattern to the dashboard)
// ---------------------------------------------------------------------------
const STATUS_LABEL = {
  [SYNC_STATUS.SYNCED]: 'Synced', [SYNC_STATUS.SYNCING]: 'Syncing…',
  [SYNC_STATUS.OFFLINE]: 'Offline — changes saved locally', [SYNC_STATUS.ERROR]: 'Sync error',
};
syncManager.onStatusChange((status) => {
  document.getElementById('syncDot').className = `sync-dot status-${status}`;
  document.getElementById('syncStatus').className = `sync-status status-${status}`;
  document.getElementById('syncStatusText').textContent = STATUS_LABEL[status];
  if (status === SYNC_STATUS.SYNCED) loadAndRender();
});
syncManager.start();

function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let rawTrades = [];
let showingRecycleBin = false;
let currentPage = 1;
const PAGE_SIZE = 20;
const selectedIds = new Set();

function currentFilters() {
  return {
    search: document.getElementById('searchInput').value.trim().toLowerCase(),
    direction: document.getElementById('filterDirection').value,
    status: document.getElementById('filterStatus').value,
    session: document.getElementById('filterSession').value,
    dateFrom: document.getElementById('filterDateFrom').value,
    dateTo: document.getElementById('filterDateTo').value,
  };
}

function getFilteredSorted() {
  const f = currentFilters();
  let trades = rawTrades.filter((t) => (showingRecycleBin ? Boolean(t.deleted_at) : !t.deleted_at));

  if (f.search) {
    trades = trades.filter((t) =>
      (t.pair || '').toLowerCase().includes(f.search) ||
      (t.strategy || '').toLowerCase().includes(f.search) ||
      (t.notes || '').toLowerCase().includes(f.search)
    );
  }
  if (f.direction) trades = trades.filter((t) => t.direction === f.direction);
  if (f.status) trades = trades.filter((t) => t.trade_status === f.status);
  if (f.session) trades = trades.filter((t) => t.session === f.session);
  if (f.dateFrom) trades = trades.filter((t) => (t.entry_date || '') >= f.dateFrom);
  if (f.dateTo) trades = trades.filter((t) => (t.entry_date || '') <= f.dateTo);

  const sortValue = document.getElementById('sortSelect').value;
  const [sortField, sortDir] = sortValue.startsWith('entry_date')
    ? ['entry_date', sortValue.endsWith('desc') ? 'desc' : 'asc']
    : sortValue.startsWith('net_profit')
      ? ['net_profit', sortValue.endsWith('desc') ? 'desc' : 'asc']
      : ['pair', 'asc'];

  trades.sort((a, b) => {
    const av = a[sortField] ?? (sortField === 'net_profit' ? -Infinity : '');
    const bv = b[sortField] ?? (sortField === 'net_profit' ? -Infinity : '');
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return trades;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function renderTable() {
  const filtered = getFilteredSorted();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  document.getElementById('resultsSummary').textContent = showingRecycleBin
    ? `${filtered.length} deleted trade${filtered.length === 1 ? '' : 's'}`
    : `${filtered.length} trade${filtered.length === 1 ? '' : 's'}`;

  document.getElementById('emptyTitle').textContent = showingRecycleBin ? 'Recycle bin is empty' : 'No trades match your filters';
  document.getElementById('emptySub').textContent = showingRecycleBin
    ? 'Deleted trades will show up here so you can restore them.'
    : rawTrades.filter((t) => !t.deleted_at).length === 0
      ? 'Add your first trade or import your history to get started.'
      : 'Try adjusting your search or filters.';

  const body = document.getElementById('tradesTableBody');
  body.innerHTML = '';
  document.getElementById('emptyState').style.display = pageItems.length === 0 ? 'flex' : 'none';

  for (const trade of pageItems) {
    const tr = document.createElement('tr');
    const isPos = (trade.net_profit || 0) >= 0;
    const checked = selectedIds.has(trade.id) ? 'checked' : '';

    const actionsHtml = showingRecycleBin
      ? `<div class="icon-btn success" data-action="restore" data-id="${trade.id}" title="Restore">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5"/></svg>
         </div>`
      : `<div class="icon-btn" data-action="edit" data-id="${trade.id}" title="Edit">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
         </div>
         <div class="icon-btn" data-action="duplicate" data-id="${trade.id}" title="Duplicate">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
         </div>
         <div class="icon-btn danger" data-action="delete" data-id="${trade.id}" title="Delete">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
         </div>`;

    tr.innerHTML = `
      <td><input type="checkbox" class="row-check" data-select-id="${trade.id}" ${checked}></td>
      <td class="num">${trade.entry_date || ''}</td>
      <td><div class="pair-cell"><div class="pair-flag">${(trade.pair || '?').slice(0, 2).toUpperCase()}</div> ${escapeHtml(trade.pair)}</div></td>
      <td><span class="dir-badge ${trade.direction}">${trade.direction === 'buy' ? '▲ Buy' : '▼ Sell'}</span></td>
      <td>${escapeHtml(trade.session) || '<span style="color:var(--text-dim)">—</span>'}</td>
      <td>${escapeHtml(trade.strategy) || '<span style="color:var(--text-dim)">—</span>'}</td>
      <td class="rr-cell">${trade.rr !== null && trade.rr !== undefined ? trade.rr + 'R' : '—'}</td>
      <td class="pnl-cell ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}$${Math.abs(trade.net_profit || 0).toFixed(2)}</td>
      <td><span class="status-chip ${trade.trade_status}">${trade.trade_status}</span></td>
      <td><div class="row-actions">${actionsHtml}</div></td>
    `;
    body.appendChild(tr);
  }

  renderPagination(filtered.length, totalPages);
  renderBulkBar();
  document.getElementById('selectAllCheck').checked = pageItems.length > 0 && pageItems.every((t) => selectedIds.has(t.id));
}

function renderPagination(totalItems, totalPages) {
  document.getElementById('pageSummary').textContent = totalItems === 0
    ? ''
    : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalItems)} of ${totalItems}`;

  const controls = document.getElementById('pageControls');
  controls.innerHTML = '';

  const prev = document.createElement('div');
  prev.className = `page-btn ${currentPage === 1 ? 'disabled' : ''}`;
  prev.textContent = '‹';
  prev.addEventListener('click', () => { currentPage--; renderTable(); });
  controls.appendChild(prev);

  const maxButtons = 5;
  let start = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);

  for (let p = start; p <= end; p++) {
    const btn = document.createElement('div');
    btn.className = `page-btn ${p === currentPage ? 'active' : ''}`;
    btn.textContent = p;
    btn.addEventListener('click', () => { currentPage = p; renderTable(); });
    controls.appendChild(btn);
  }

  const next = document.createElement('div');
  next.className = `page-btn ${currentPage === totalPages ? 'disabled' : ''}`;
  next.textContent = '›';
  next.addEventListener('click', () => { currentPage++; renderTable(); });
  controls.appendChild(next);
}

function renderBulkBar() {
  const bar = document.getElementById('bulkBar');
  const count = selectedIds.size;
  bar.classList.toggle('visible', count > 0);
  document.getElementById('bulkCount').textContent = `${count} selected`;
  document.getElementById('bulkDeleteBtn').textContent = showingRecycleBin ? 'Restore selected' : 'Delete selected';
}

async function loadAndRender() {
  rawTrades = await tradesRepo.list({ includeDeleted: true });
  renderTable();
}

// ---------------------------------------------------------------------------
// Toolbar wiring
// ---------------------------------------------------------------------------
document.getElementById('searchInput').addEventListener('input', () => { currentPage = 1; renderTable(); });
document.getElementById('sortSelect').addEventListener('change', () => { currentPage = 1; renderTable(); });
for (const id of ['filterDirection', 'filterStatus', 'filterSession', 'filterDateFrom', 'filterDateTo']) {
  document.getElementById(id).addEventListener('change', () => { currentPage = 1; renderTable(); });
}

document.getElementById('filterToggle').addEventListener('click', (e) => {
  document.getElementById('filterPanel').classList.toggle('open');
  e.currentTarget.classList.toggle('active');
});

document.getElementById('recycleBinToggle').addEventListener('click', (e) => {
  showingRecycleBin = !showingRecycleBin;
  e.currentTarget.classList.toggle('active', showingRecycleBin);
  selectedIds.clear();
  currentPage = 1;
  renderTable();
});

document.getElementById('addTradeBtn').addEventListener('click', async () => {
  const saved = await openTradeModal({ mode: 'create' });
  if (saved) { showToast('Trade saved — syncing now'); await loadAndRender(); }
});

// ---------------------------------------------------------------------------
// Row actions (edit / duplicate / delete / restore) + selection
// ---------------------------------------------------------------------------
document.getElementById('tradesTableBody').addEventListener('click', async (event) => {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const { action, id } = actionEl.dataset;
  const trade = rawTrades.find((t) => t.id === id);
  if (!trade) return;

  if (action === 'edit') {
    const saved = await openTradeModal({ mode: 'edit', trade });
    if (saved) { showToast('Trade updated'); await loadAndRender(); }
  } else if (action === 'duplicate') {
    const copy = { ...trade };
    delete copy.id; delete copy.created_at; delete copy.updated_at; delete copy.deleted_at; delete copy.sync_status;
    const saved = await openTradeModal({ mode: 'create', trade: copy });
    if (saved) { showToast('Trade duplicated'); await loadAndRender(); }
  } else if (action === 'delete') {
    if (confirm(`Delete this ${trade.pair} trade? You can restore it from the Recycle Bin.`)) {
      await tradesRepo.remove(id);
      showToast('Trade moved to recycle bin');
      await loadAndRender();
    }
  } else if (action === 'restore') {
    await tradesRepo.restore(id);
    showToast('Trade restored');
    await loadAndRender();
  }
});

document.getElementById('tradesTableBody').addEventListener('change', (event) => {
  const checkbox = event.target.closest('[data-select-id]');
  if (!checkbox) return;
  const id = checkbox.dataset.selectId;
  if (checkbox.checked) selectedIds.add(id); else selectedIds.delete(id);
  renderBulkBar();
  document.getElementById('selectAllCheck').checked = [...document.querySelectorAll('[data-select-id]')].every((c) => c.checked);
});

document.getElementById('selectAllCheck').addEventListener('change', (event) => {
  const checkboxes = document.querySelectorAll('[data-select-id]');
  checkboxes.forEach((cb) => {
    cb.checked = event.target.checked;
    if (event.target.checked) selectedIds.add(cb.dataset.selectId); else selectedIds.delete(cb.dataset.selectId);
  });
  renderBulkBar();
});

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------
document.getElementById('bulkClearBtn').addEventListener('click', () => {
  selectedIds.clear();
  renderTable();
});

document.getElementById('bulkDeleteBtn').addEventListener('click', async () => {
  const ids = [...selectedIds];
  if (ids.length === 0) return;

  if (showingRecycleBin) {
    await Promise.all(ids.map((id) => tradesRepo.restore(id)));
    showToast(`Restored ${ids.length} trade${ids.length === 1 ? '' : 's'}`);
  } else {
    if (!confirm(`Delete ${ids.length} selected trade${ids.length === 1 ? '' : 's'}? You can restore them from the Recycle Bin.`)) return;
    await Promise.all(ids.map((id) => tradesRepo.remove(id)));
    showToast(`Deleted ${ids.length} trade${ids.length === 1 ? '' : 's'}`);
  }
  selectedIds.clear();
  await loadAndRender();
});

document.getElementById('bulkExportBtn').addEventListener('click', () => {
  const trades = rawTrades.filter((t) => selectedIds.has(t.id));
  if (trades.length === 0) { showToast('Select at least one trade first.', 'error'); return; }
  downloadFile(`trades-selected-${Date.now()}.csv`, tradesToCSV(trades), 'text/csv');
  showToast(`Exported ${trades.length} trade${trades.length === 1 ? '' : 's'}`);
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const trades = getFilteredSorted();
  if (trades.length === 0) { showToast('Nothing to export with the current filters.', 'error'); return; }
  downloadFile(`trades-export-${Date.now()}.csv`, tradesToCSV(trades), 'text/csv');
  showToast(`Exported ${trades.length} trade${trades.length === 1 ? '' : 's'} as CSV`);
});

// ---------------------------------------------------------------------------
// Import (CSV or JSON, auto-detected by extension). Skips exact duplicates
// (same pair + entry_date + entry_price + net_profit already present).
// ---------------------------------------------------------------------------
document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());

document.getElementById('importFile').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();

  let incoming = [];
  try {
    if (file.name.toLowerCase().endsWith('.json')) {
      const parsed = JSON.parse(text);
      incoming = Array.isArray(parsed) ? parsed : (parsed.trades || []);
    } else {
      incoming = parseCSV(text).map(normalizeImportedTrade);
    }
  } catch (err) {
    showToast('Could not parse that file. Check it is a valid CSV or JSON export.', 'error');
    event.target.value = '';
    return;
  }

  const existingKey = (t) => `${t.pair}|${t.entry_date}|${t.entry_price}|${t.net_profit}`;
  const existingKeys = new Set(rawTrades.filter((t) => !t.deleted_at).map(existingKey));

  let imported = 0;
  let skipped = 0;
  for (const raw of incoming) {
    if (!raw.pair || !raw.entry_date) { skipped++; continue; }
    const key = existingKey(raw);
    if (existingKeys.has(key)) { skipped++; continue; }
    existingKeys.add(key);

    await tradesRepo.create({
      pair: raw.pair,
      direction: (raw.direction || 'buy').toLowerCase(),
      entry_date: raw.entry_date,
      exit_date: raw.exit_date || null,
      entry_price: raw.entry_price ?? null,
      exit_price: raw.exit_price ?? null,
      stop_loss: raw.stop_loss ?? null,
      take_profit: raw.take_profit ?? null,
      lot_size: raw.lot_size ?? null,
      rr: raw.rr ?? null,
      session: raw.session || null,
      strategy: raw.strategy || null,
      net_profit: raw.net_profit ?? null,
      gross_profit: raw.gross_profit ?? raw.net_profit ?? null,
      trade_status: raw.trade_status || 'closed',
      notes: raw.notes || '',
      source: raw.source || 'csv_import',
    });
    imported++;
  }

  showToast(`Imported ${imported} trade${imported === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} duplicate/invalid` : ''}`);
  event.target.value = '';
  await loadAndRender();
});

await loadAndRender();
