// ============================================================================
// calendar.html controller — full month view with year 1900-2100 navigation,
// per-day win/loss/breakeven coloring, monthly stats, monthly notes, and a
// day-detail modal (trades + daily notes), all backed by local IndexedDB
// data and synced automatically like everything else.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { tradesRepo, calendarNotesRepo } from '../repositories/index.js';
import { openTradeModal } from '../components/trade-modal.js';
import { applyThemeForUser } from '../theme.js';
import { mountAccountSwitcher } from '../components/account-switcher.js';
import { getActiveAccountId } from '../lib/account-context.js';

const user = await requireAuth();
if (user) await applyThemeForUser(user.id);
if (user) {
  document.getElementById('userName').textContent = user.display_name || user.email;
  document.getElementById('userAvatar').textContent = (user.display_name || user.email).slice(0, 2).toUpperCase();
  document.getElementById('userFoot').addEventListener('click', async () => {
    if (confirm('Sign out of this device?')) { await logout(); window.location.href = 'login.html'; }
  });
}

function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Sync status
// ---------------------------------------------------------------------------
const STATUS_LABEL = {
  [SYNC_STATUS.SYNCED]: 'Synced', [SYNC_STATUS.SYNCING]: 'Syncing…',
  [SYNC_STATUS.OFFLINE]: 'Offline — changes saved locally', [SYNC_STATUS.ERROR]: 'Sync error',
};
syncManager.onStatusChange((status) => {
  document.getElementById('syncDot').className = `sync-dot status-${status}`;
  document.getElementById('syncStatus').className = `sync-status status-${status}`;
  document.getElementById('syncStatusText').textContent = STATUS_LABEL[status];
  if (status === SYNC_STATUS.SYNCED) refreshData();
});
syncManager.start();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let viewDate = new Date();
let allTrades = [];
let calendarNotes = [];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(year, month, day) { return `${year}-${pad(month + 1)}-${pad(day)}`; }
function monthKey(year, month) { return `${year}-${pad(month + 1)}-01`; }

// ---------------------------------------------------------------------------
// Month / Year controls
// ---------------------------------------------------------------------------
const monthSelect = document.getElementById('monthSelect');
const yearSelect = document.getElementById('yearSelect');

monthSelect.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
{
  let yearOptions = '';
  for (let y = 2100; y >= 1900; y--) yearOptions += `<option value="${y}">${y}</option>`;
  yearSelect.innerHTML = yearOptions;
}

function syncSelectsToViewDate() {
  monthSelect.value = viewDate.getMonth();
  yearSelect.value = viewDate.getFullYear();
}
syncSelectsToViewDate();

monthSelect.addEventListener('change', () => { viewDate = new Date(Number(yearSelect.value), Number(monthSelect.value), 1); renderAll(); });
yearSelect.addEventListener('change', () => { viewDate = new Date(Number(yearSelect.value), Number(monthSelect.value), 1); renderAll(); });
document.getElementById('calPrev').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); syncSelectsToViewDate(); renderAll(); });
document.getElementById('calNext').addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); syncSelectsToViewDate(); renderAll(); });
document.getElementById('todayBtn').addEventListener('click', () => { viewDate = new Date(); syncSelectsToViewDate(); renderAll(); });

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function refreshData() {
  const [trades, notes, activeAccountId] = await Promise.all([tradesRepo.list(), calendarNotesRepo.list(), getActiveAccountId()]);
  allTrades = activeAccountId ? trades.filter((t) => t.account_id === activeAccountId) : trades;
  calendarNotes = notes;
  renderAll();
}

function closedTradesForMonth(year, month) {
  const prefix = `${year}-${pad(month + 1)}`;
  return allTrades.filter((t) => t.trade_status === 'closed' && typeof t.net_profit === 'number' && (t.exit_date || t.entry_date || '').startsWith(prefix));
}

function tradesForDay(key) {
  return allTrades.filter((t) => !t.deleted_at && (t.exit_date === key || (!t.exit_date && t.entry_date === key)));
}

function findNote(note_date, note_type) {
  return calendarNotes.find((n) => n.note_date === note_date && n.note_type === note_type && !n.deleted_at);
}

async function upsertNote(note_date, note_type, content) {
  const existing = findNote(note_date, note_type);
  if (existing) await calendarNotesRepo.update(existing.id, { content });
  else await calendarNotesRepo.create({ note_date, note_type, content });
  calendarNotes = await calendarNotesRepo.list();
}

// ---------------------------------------------------------------------------
// Render: grid
// ---------------------------------------------------------------------------
function renderGrid() {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const grid = document.getElementById('calGridLg');
  grid.innerHTML = '';

  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-dow-lg';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = dateKey(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day-lg empty';
    grid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = dateKey(year, month, day);
    const dayTrades = tradesForDay(key).filter((t) => t.trade_status === 'closed' && typeof t.net_profit === 'number');
    const pnl = dayTrades.reduce((sum, t) => sum + t.net_profit, 0);
    const hasNote = Boolean(findNote(key, 'daily'));

    const el = document.createElement('div');
    el.className = `cal-day-lg ${dayTrades.length === 0 ? 'flat' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'flat'} ${key === todayKey ? 'today' : ''}`;
    el.dataset.dateKey = key;
    el.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <span class="day-num">${day}</span>
        ${hasNote ? '<span class="day-note-dot"></span>' : ''}
      </div>
      ${dayTrades.length > 0 ? `<div><div class="day-pnl">${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(0)}</div><div class="day-count">${dayTrades.length} trade${dayTrades.length === 1 ? '' : 's'}</div></div>` : ''}
    `;
    el.addEventListener('click', () => openDayModal(key));
    grid.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Render: monthly stats + monthly notes
// ---------------------------------------------------------------------------
function renderMonthlyStats() {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  document.getElementById('monthlyStatsTitle').textContent = `${MONTH_NAMES[month]} ${year}`;

  const trades = closedTradesForMonth(year, month);
  const netPnl = trades.reduce((sum, t) => sum + t.net_profit, 0);
  const wins = trades.filter((t) => t.net_profit > 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  const byDay = new Map();
  for (const t of trades) {
    const key = t.exit_date || t.entry_date;
    byDay.set(key, (byDay.get(key) || 0) + t.net_profit);
  }
  const dayValues = [...byDay.values()];
  const winningDays = dayValues.filter((v) => v > 0).length;
  const losingDays = dayValues.filter((v) => v < 0).length;
  const bestDayValue = dayValues.length > 0 ? Math.max(...dayValues) : null;

  document.getElementById('statNetPnl').textContent = `${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)}`;
  document.getElementById('statNetPnl').style.color = netPnl >= 0 ? 'var(--mint)' : 'var(--coral)';
  document.getElementById('statTrades').textContent = trades.length;
  document.getElementById('statWinRate').textContent = `${winRate.toFixed(1)}%`;
  document.getElementById('statWinDays').textContent = winningDays;
  document.getElementById('statLossDays').textContent = losingDays;
  document.getElementById('statBestDay').textContent = bestDayValue !== null ? `+$${bestDayValue.toFixed(2)}` : '—';
}

function renderMonthlyNotes() {
  const note = findNote(monthKey(viewDate.getFullYear(), viewDate.getMonth()), 'monthly');
  document.getElementById('monthlyNotesInput').value = note ? note.content : '';
}

document.getElementById('saveMonthlyNoteBtn').addEventListener('click', async () => {
  const content = document.getElementById('monthlyNotesInput').value;
  await upsertNote(monthKey(viewDate.getFullYear(), viewDate.getMonth()), 'monthly', content);
  showToast('Monthly note saved');
  renderGrid();
});

// ---------------------------------------------------------------------------
// Day detail modal
// ---------------------------------------------------------------------------
let activeDayKey = null;
const dayOverlay = document.getElementById('dayModalOverlay');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function renderDayModal() {
  const trades = tradesForDay(activeDayKey);
  const closed = trades.filter((t) => t.trade_status === 'closed' && typeof t.net_profit === 'number');
  const pnl = closed.reduce((sum, t) => sum + t.net_profit, 0);

  const [y, m, d] = activeDayKey.split('-').map(Number);
  document.getElementById('dayModalTitle').textContent = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('dayModalPnl').textContent = `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
  document.getElementById('dayModalPnl').style.color = closed.length === 0 ? 'var(--text-dim)' : pnl >= 0 ? 'var(--mint)' : 'var(--coral)';

  const list = document.getElementById('dayTradesList');
  const empty = document.getElementById('dayTradesEmpty');
  list.innerHTML = '';
  empty.style.display = trades.length === 0 ? 'block' : 'none';

  for (const trade of trades) {
    const isPos = (trade.net_profit || 0) >= 0;
    const row = document.createElement('div');
    row.className = 'day-trade-row';
    row.innerHTML = `
      <div class="pair-cell"><div class="pair-flag">${(trade.pair || '?').slice(0, 2).toUpperCase()}</div> ${escapeHtml(trade.pair)}
        <span class="dir-badge ${trade.direction}" style="margin-left:6px;">${trade.direction === 'buy' ? '▲' : '▼'}</span>
      </div>
      <span class="pnl-cell ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}$${Math.abs(trade.net_profit || 0).toFixed(2)}</span>
    `;
    row.addEventListener('click', async () => {
      const saved = await openTradeModal({ mode: 'edit', trade });
      if (saved) { await refreshData(); renderDayModal(); }
    });
    list.appendChild(row);
  }

  const note = findNote(activeDayKey, 'daily');
  document.getElementById('dayNotesInput').value = note ? note.content : '';
}

function openDayModal(key) {
  activeDayKey = key;
  renderDayModal();
  dayOverlay.classList.remove('hidden');
}
function closeDayModal() { dayOverlay.classList.add('hidden'); activeDayKey = null; }

document.getElementById('dayModalClose').addEventListener('click', closeDayModal);
document.getElementById('dayModalCancel').addEventListener('click', closeDayModal);
dayOverlay.addEventListener('click', (e) => { if (e.target === dayOverlay) closeDayModal(); });

document.getElementById('dayAddTradeBtn').addEventListener('click', async () => {
  const saved = await openTradeModal({ mode: 'create', trade: { entry_date: activeDayKey } });
  if (saved) { await refreshData(); renderDayModal(); showToast('Trade added'); }
});

document.getElementById('saveDayNoteBtn').addEventListener('click', async () => {
  const content = document.getElementById('dayNotesInput').value;
  await upsertNote(activeDayKey, 'daily', content);
  showToast('Daily note saved');
  renderGrid();
});

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------
function renderAll() {
  renderGrid();
  renderMonthlyStats();
  renderMonthlyNotes();
}

await mountAccountSwitcher(document.getElementById('acctSwitcherContainer'));
window.addEventListener('account-changed', () => refreshData());

await refreshData();
