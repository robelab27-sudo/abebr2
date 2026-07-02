// ============================================================================
// dashboard.html controller. Loads real data from IndexedDB (never mock
// arrays), renders KPIs/charts/calendar/table from it, wires the Add Trade
// modal to the trades repository, and reflects live sync status in the
// topbar. Re-renders automatically whenever a sync cycle completes so data
// pulled from another device shows up without a manual refresh.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { tradesRepo, journalRepo } from '../repositories/index.js';
import { getById } from '../db.js';
import { computeDashboardStats } from '../stats.js';
import { openTradeModal } from '../components/trade-modal.js';
import { applyThemeForUser } from '../theme.js';

const user = await requireAuth();
if (user) await applyThemeForUser(user.id);
if (user) {
  document.getElementById('userName').textContent = user.display_name || user.email;
  document.getElementById('userAvatar').textContent = (user.display_name || user.email).slice(0, 2).toUpperCase();
  const hour = new Date().getHours();
  const period = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  document.getElementById('greeting').textContent = `Good ${period}, ${(user.display_name || user.email).split(' ')[0]}`;

  document.getElementById('userFoot').addEventListener('click', async () => {
    if (confirm('Sign out of this device?')) {
      await logout();
      window.location.href = 'login.html';
    }
  });
}

// ---------------------------------------------------------------------------
// Sync status indicator
// ---------------------------------------------------------------------------
const STATUS_LABEL = {
  [SYNC_STATUS.SYNCED]: 'Synced',
  [SYNC_STATUS.SYNCING]: 'Syncing…',
  [SYNC_STATUS.OFFLINE]: 'Offline — changes saved locally',
  [SYNC_STATUS.ERROR]: 'Sync error',
};

syncManager.onStatusChange((status, meta) => {
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncStatusText');
  const wrap = document.getElementById('syncStatus');

  dot.className = `sync-dot status-${status}`;
  wrap.className = `sync-status status-${status}`;
  text.textContent = status === SYNC_STATUS.SYNCED && meta.lastSyncedAt
    ? `Synced · ${timeAgo(meta.lastSyncedAt)}`
    : STATUS_LABEL[status];

  if (status === SYNC_STATUS.SYNCED) renderAll();
});

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

syncManager.start();
// Keep the "Synced · Xs ago" label fresh even between sync cycles.
setInterval(() => {
  if (syncManager.status === SYNC_STATUS.SYNCED && syncManager.lastSyncedAt) {
    document.getElementById('syncStatusText').textContent = `Synced · ${timeAgo(syncManager.lastSyncedAt)}`;
  }
}, 5000);

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Chart instances (recreated on each render — dataset sizes here are small
// enough that this is simpler and cheap compared to diffing/updating).
// ---------------------------------------------------------------------------
const charts = { equity: null, winLoss: null, pair: null, session: null };
const MINT = '#3DDC97', CORAL = '#FF6B6B', PERIWINKLE = '#7C9EFF';

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#8892A6';
Chart.defaults.font.size = 11;

function destroy(chart) { if (chart) chart.destroy(); }

function renderEquityChart(equityCurve) {
  destroy(charts.equity);
  const ctx = document.getElementById('equityChart').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, 'rgba(61,220,151,0.35)');
  gradient.addColorStop(1, 'rgba(61,220,151,0.0)');

  charts.equity = new Chart(ctx, {
    type: 'line',
    data: {
      labels: equityCurve.map((_, i) => i),
      datasets: [{
        data: equityCurve.map((p) => p.balance),
        borderColor: MINT, borderWidth: 2.5, backgroundColor: gradient, fill: true,
        tension: 0.35, pointRadius: 0, pointHoverRadius: 5,
        pointHoverBackgroundColor: MINT, pointHoverBorderColor: '#0A0E14', pointHoverBorderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#12161f', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
          titleColor: '#8892A6', bodyColor: '#E8EDF4', bodyFont: { family: "'JetBrains Mono'" },
          padding: 10, cornerRadius: 8, displayColors: false,
          callbacks: { label: (c) => '$' + c.parsed.y.toLocaleString(undefined, { maximumFractionDigits: 2 }) },
        },
      },
      scales: { x: { display: false }, y: { display: false } },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

function renderWinLossChart(stats) {
  destroy(charts.winLoss);
  charts.winLoss = new Chart(document.getElementById('winLossChart'), {
    type: 'doughnut',
    data: {
      labels: ['Wins', 'Losses', 'Break-even'],
      datasets: [{ data: [stats.winningTrades, stats.losingTrades, stats.breakevenTrades], backgroundColor: [MINT, CORAL, 'rgba(255,255,255,0.12)'], borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '72%',
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, padding: 14, usePointStyle: true, pointStyle: 'circle' } } },
    },
  });
}

function renderBarChart(canvasId, chartKey, entries, color) {
  destroy(charts[chartKey]);
  const top = entries.slice(0, 6);
  charts[chartKey] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: top.map((e) => e.label),
      datasets: [{ data: top.map((e) => e.value), backgroundColor: (ctx) => (ctx.raw >= 0 ? color : CORAL), borderRadius: 6, barThickness: 16 }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: (v) => '$' + v } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------
let calendarDate = new Date();
let currentTrades = [];

function renderCalendar() {
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  document.getElementById('calLabel').textContent = calendarDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const byDate = new Map();
  for (const trade of currentTrades) {
    if (trade.deleted_at || trade.trade_status !== 'closed' || typeof trade.net_profit !== 'number') continue;
    const dateKey = trade.exit_date || trade.entry_date;
    if (!dateKey) continue;
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + trade.net_profit);
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const pnl = byDate.get(dateKey);
    const el = document.createElement('div');
    el.className = 'cal-day ' + (pnl === undefined ? 'flat' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'flat');
    const num = document.createElement('span');
    num.textContent = day;
    el.appendChild(num);
    if (pnl !== undefined) {
      const pnlEl = document.createElement('span');
      pnlEl.className = 'pnl';
      pnlEl.textContent = (pnl > 0 ? '+' : '') + Math.round(pnl);
      el.appendChild(pnlEl);
    }
    grid.appendChild(el);
  }
}

document.getElementById('calPrev').addEventListener('click', () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
  renderCalendar();
});

// ---------------------------------------------------------------------------
// Recent trades table
// ---------------------------------------------------------------------------
function renderRecentTrades(recentTrades) {
  const body = document.getElementById('recentTradesBody');
  const emptyState = document.getElementById('tradesEmptyState');
  body.innerHTML = '';

  if (recentTrades.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  for (const trade of recentTrades) {
    const tr = document.createElement('tr');
    const isPos = trade.net_profit >= 0;
    tr.innerHTML = `
      <td><div class="pair-cell"><div class="pair-flag">${(trade.pair || '?').slice(0, 2).toUpperCase()}</div> ${escapeHtml(trade.pair || '')}</div></td>
      <td><span class="dir-badge ${trade.direction}">${trade.direction === 'buy' ? '▲ Buy' : '▼ Sell'}</span></td>
      <td class="num">${trade.entry_date || ''}</td>
      <td class="rr-cell">${trade.rr !== null && trade.rr !== undefined ? trade.rr + 'R' : '—'}</td>
      <td class="pnl-cell ${isPos ? 'pos' : 'neg'}">${isPos ? '+' : ''}$${Math.abs(trade.net_profit).toFixed(2)}</td>
    `;
    body.appendChild(tr);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Psychology snapshot (averaged from journal entry scores, if any exist)
// ---------------------------------------------------------------------------
function renderPsychology(journalEntries) {
  const body = document.getElementById('psychologyBody');
  const emptyState = document.getElementById('psychEmptyState');
  const scored = journalEntries.filter((j) => !j.deleted_at && (j.discipline_score || j.confidence_score || j.emotion_score));

  if (scored.length === 0) {
    body.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  const avg = (field) => {
    const values = scored.map((j) => j[field]).filter((v) => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  };

  const metrics = [
    { label: 'Discipline', value: avg('discipline_score'), color: MINT },
    { label: 'Confidence', value: avg('confidence_score'), color: PERIWINKLE },
    { label: 'Emotion', value: avg('emotion_score'), color: '#F5B860' },
  ];

  body.innerHTML = metrics.map((m) => `
    <div class="psy-row">
      <div class="psy-label">${m.label}</div>
      <div class="psy-bar-track"><div class="psy-bar-fill" style="width:${(m.value / 10) * 100}%; background:${m.color};"></div></div>
      <div class="psy-val">${m.value.toFixed(1)}</div>
    </div>
  `).join('');
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------
function renderKpis(stats) {
  const fmt = (n) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  document.getElementById('kpiBalance').textContent = fmt(stats.currentBalance);
  document.getElementById('kpiBalanceTrend').textContent = stats.startingBalance > 0
    ? `${stats.netProfit >= 0 ? '+' : ''}${((stats.netProfit / stats.startingBalance) * 100).toFixed(2)}% overall`
    : '';

  const netEl = document.getElementById('kpiNetProfit');
  netEl.textContent = `${stats.netProfit >= 0 ? '+' : ''}${fmt(stats.netProfit)}`;
  netEl.className = `kpi-value num ${stats.netProfit >= 0 ? 'mint' : 'coral'}`;
  document.getElementById('kpiTradesCount').textContent = `${stats.totalTrades} closed trades`;

  document.getElementById('kpiWinRate').textContent = `${stats.winRate.toFixed(1)}%`;
  document.getElementById('kpiWinLoss').textContent = `${stats.winningTrades}W / ${stats.losingTrades}L / ${stats.breakevenTrades}BE`;

  document.getElementById('kpiProfitFactor').textContent = isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞';
  document.getElementById('kpiAvgRR').textContent = `Avg RR ${stats.avgRR.toFixed(2)}`;

  const ddEl = document.getElementById('kpiMaxDD');
  ddEl.textContent = `-${stats.maxDrawdownPct.toFixed(1)}%`;
  ddEl.className = 'kpi-value num coral';
  document.getElementById('kpiCurrentDD').textContent = `Currently -${stats.currentDrawdownPct.toFixed(1)}%`;

  document.getElementById('equityBig').textContent = fmt(stats.currentBalance);
  document.getElementById('equityDelta').textContent = stats.startingBalance > 0
    ? `${stats.netProfit >= 0 ? '+' : ''}${((stats.netProfit / stats.startingBalance) * 100).toFixed(1)}%`
    : '—';
}

// ---------------------------------------------------------------------------
// Full render pass
// ---------------------------------------------------------------------------
async function renderAll() {
  const [trades, journalEntries, settings] = await Promise.all([
    tradesRepo.list(),
    journalRepo.list(),
    user ? getById('settings', user.id) : null,
  ]);

  currentTrades = trades;
  const startingBalance = settings?.starting_balance || 0;
  const stats = computeDashboardStats(trades, startingBalance);

  renderKpis(stats);
  renderEquityChart(stats.equityCurve);
  renderWinLossChart(stats);
  renderBarChart('pairChart', 'pair', stats.profitByPair, MINT);
  renderBarChart('sessionChart', 'session', stats.profitBySession, PERIWINKLE);
  renderCalendar();
  renderRecentTrades(stats.recentTrades);
  renderPsychology(journalEntries);
}

await renderAll();

// ---------------------------------------------------------------------------
// Add Trade (shared modal component)
// ---------------------------------------------------------------------------
document.getElementById('addTradeBtn').addEventListener('click', async () => {
  const saved = await openTradeModal({ mode: 'create' });
  if (saved) {
    showToast('Trade saved — syncing now');
    await renderAll();
  }
});
