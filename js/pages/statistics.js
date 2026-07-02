// ============================================================================
// statistics.html controller — every metric and chart from the spec's
// Statistics + Charts sections, computed from local trade data.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { tradesRepo } from '../repositories/index.js';
import { getById } from '../db.js';
import { computeDashboardStats, computeAdvancedStats } from '../stats.js';
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

const STATUS_LABEL = {
  [SYNC_STATUS.SYNCED]: 'Synced', [SYNC_STATUS.SYNCING]: 'Syncing…',
  [SYNC_STATUS.OFFLINE]: 'Offline — changes saved locally', [SYNC_STATUS.ERROR]: 'Sync error',
};
syncManager.onStatusChange((status) => {
  document.getElementById('syncDot').className = `sync-dot status-${status}`;
  document.getElementById('syncStatus').className = `sync-status status-${status}`;
  document.getElementById('syncStatusText').textContent = STATUS_LABEL[status];
  if (status === SYNC_STATUS.SYNCED) renderAll();
});
syncManager.start();

Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.color = '#8892A6';
Chart.defaults.font.size = 11;
const MINT = '#3DDC97', CORAL = '#FF6B6B', PERIWINKLE = '#7C9EFF', AMBER = '#F5B860', PURPLE = '#C792EA';
const charts = {};
function destroy(key) { if (charts[key]) { charts[key].destroy(); charts[key] = null; } }

let allTrades = [];
let currentPeriod = 'monthly';

// ---------------------------------------------------------------------------
// Metric grid
// ---------------------------------------------------------------------------
function fmtMoney(n) { return `${n >= 0 ? '' : '-'}$${Math.abs(n).toFixed(2)}`; }
function fmtRatio(n) { return isFinite(n) ? n.toFixed(2) : '∞'; }

function renderMetricGrid(adv) {
  const grid = document.getElementById('statGrid');
  if (!adv) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="title">No closed trades yet</div><div class="sub">Statistics will appear once you have closed trades.</div></div>';
    return;
  }

  const cards = [
    ['Win Rate', `${adv.winRate.toFixed(1)}%`, MINT],
    ['Loss Rate', `${adv.lossRate.toFixed(1)}%`, CORAL],
    ['Profit Factor', fmtRatio(adv.profitFactor), MINT],
    ['Recovery Factor', fmtRatio(adv.recoveryFactor), PERIWINKLE],
    ['Expectancy / trade', fmtMoney(adv.expectancy), adv.expectancy >= 0 ? MINT : CORAL],
    ['Sharpe Ratio', adv.sharpeRatio.toFixed(2), PERIWINKLE],
    ['Sortino Ratio', adv.sortinoRatio.toFixed(2), PERIWINKLE],
    ['Average RR', adv.avgRR.toFixed(2), AMBER],
    ['Average Win', fmtMoney(adv.avgWin), MINT],
    ['Average Loss', fmtMoney(-adv.avgLoss), CORAL],
    ['Largest Win', fmtMoney(adv.largestWin), MINT],
    ['Largest Loss', fmtMoney(adv.largestLoss), CORAL],
    ['Current Streak', `${adv.currentStreak > 0 ? '+' : ''}${adv.currentStreak}`, adv.currentStreak >= 0 ? MINT : CORAL],
    ['Longest Win Streak', adv.longestWinStreak, MINT],
    ['Longest Loss Streak', adv.longestLossStreak, CORAL],
    ['Avg Holding Time', adv.avgHoldingHours !== null ? formatHours(adv.avgHoldingHours) : '—', PERIWINKLE],
  ];

  grid.innerHTML = cards.map(([label, value, color]) => `
    <div class="stat-mini-card">
      <div class="stat-mini-label">${label}</div>
      <div class="stat-mini-value num" style="color:${color};">${value}</div>
    </div>
  `).join('');
}

function formatHours(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

// ---------------------------------------------------------------------------
// Equity + Drawdown
// ---------------------------------------------------------------------------
function renderEquityChart(dash) {
  destroy('equity');
  const ctx = document.getElementById('equityChart').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(61,220,151,0.3)');
  gradient.addColorStop(1, 'rgba(61,220,151,0.0)');

  let peak = dash.startingBalance;
  const drawdowns = dash.equityCurve.map((p) => {
    peak = Math.max(peak, p.balance);
    return peak > 0 ? -((peak - p.balance) / peak) * 100 : 0;
  });

  charts.equity = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dash.equityCurve.map((_, i) => i),
      datasets: [
        { label: 'Equity', data: dash.equityCurve.map((p) => p.balance), borderColor: MINT, backgroundColor: gradient, fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, yAxisID: 'y' },
        { label: 'Drawdown %', data: drawdowns, borderColor: CORAL, borderWidth: 1.5, borderDash: [4, 3], fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle' } } },
      scales: {
        x: { display: false },
        y: { display: false },
        y1: { display: false, position: 'right', max: 5 },
      },
      interaction: { intersect: false, mode: 'index' },
    },
  });
}

function renderWinLossChart(dash) {
  destroy('winLoss');
  charts.winLoss = new Chart(document.getElementById('winLossChart'), {
    type: 'doughnut',
    data: { labels: ['Wins', 'Losses', 'Break-even'], datasets: [{ data: [dash.winningTrades, dash.losingTrades, dash.breakevenTrades], backgroundColor: [MINT, CORAL, 'rgba(255,255,255,0.12)'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, padding: 12, usePointStyle: true, pointStyle: 'circle' } } } },
  });
}

// ---------------------------------------------------------------------------
// RR distribution histogram
// ---------------------------------------------------------------------------
function renderRRChart(closed) {
  destroy('rr');
  const buckets = [
    { label: '<0R', test: (r) => r < 0 },
    { label: '0–1R', test: (r) => r >= 0 && r < 1 },
    { label: '1–2R', test: (r) => r >= 1 && r < 2 },
    { label: '2–3R', test: (r) => r >= 2 && r < 3 },
    { label: '3R+', test: (r) => r >= 3 },
  ];
  const rrValues = closed.map((t) => t.rr).filter((v) => typeof v === 'number');
  const counts = buckets.map((b) => rrValues.filter(b.test).length);

  charts.rr = new Chart(document.getElementById('rrChart'), {
    type: 'bar',
    data: { labels: buckets.map((b) => b.label), datasets: [{ data: counts, backgroundColor: PERIWINKLE, borderRadius: 6, barThickness: 20 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { stepSize: 1 } } } },
  });
}

// ---------------------------------------------------------------------------
// Profit by period (daily / weekly / monthly / yearly)
// ---------------------------------------------------------------------------
function weekKey(dateStr) {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - start) / 86400000) + start.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function aggregateByPeriod(closed, period) {
  const map = new Map();
  for (const t of closed) {
    const date = t.exit_date || t.entry_date;
    if (!date) continue;
    let key;
    if (period === 'daily') key = date;
    else if (period === 'weekly') key = weekKey(date);
    else if (period === 'monthly') key = date.slice(0, 7);
    else key = date.slice(0, 4);
    map.set(key, (map.get(key) || 0) + t.net_profit);
  }
  const entries = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const limit = { daily: 30, weekly: 16, monthly: 12, yearly: 50 }[period];
  return entries.slice(-limit);
}

function renderPeriodChart(closed) {
  destroy('period');
  const data = aggregateByPeriod(closed, currentPeriod);
  charts.period = new Chart(document.getElementById('periodChart'), {
    type: 'bar',
    data: { labels: data.map(([k]) => k), datasets: [{ data: data.map(([, v]) => v), backgroundColor: (ctx) => (ctx.raw >= 0 ? MINT : CORAL), borderRadius: 5, barThickness: currentPeriod === 'daily' ? 8 : 20 }] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 0 } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: (v) => '$' + v } } },
    },
  });
}

document.getElementById('periodToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-period]');
  if (!btn) return;
  currentPeriod = btn.dataset.period;
  document.querySelectorAll('.period-btn').forEach((b) => b.classList.toggle('active', b === btn));
  renderPeriodChart(allTrades.filter((t) => t.trade_status === 'closed' && typeof t.net_profit === 'number'));
});

// ---------------------------------------------------------------------------
// Breakdown bar charts (pair / strategy / weekday)
// ---------------------------------------------------------------------------
function groupSum(closed, keyFn) {
  const map = new Map();
  for (const t of closed) {
    const key = keyFn(t) || 'Unspecified';
    map.set(key, (map.get(key) || 0) + t.net_profit);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function renderBarChart(canvasId, chartKey, entries, color, limit = 8) {
  destroy(chartKey);
  const top = entries.slice(0, limit);
  charts[chartKey] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels: top.map((e) => e.label), datasets: [{ data: top.map((e) => e.value), backgroundColor: (ctx) => (ctx.raw >= 0 ? color : CORAL), borderRadius: 6, barThickness: 16 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: (v) => '$' + v } }, y: { grid: { display: false } } },
    },
  });
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function renderWeekdayChart(closed) {
  destroy('weekday');
  const sums = new Array(7).fill(0);
  for (const t of closed) {
    const date = t.exit_date || t.entry_date;
    if (!date) continue;
    sums[new Date(date).getDay()] += t.net_profit;
  }
  charts.weekday = new Chart(document.getElementById('weekdayChart'), {
    type: 'bar',
    data: { labels: WEEKDAY_NAMES, datasets: [{ data: sums, backgroundColor: (ctx) => (ctx.raw >= 0 ? AMBER : CORAL), borderRadius: 6, barThickness: 20 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: (v) => '$' + v } } } },
  });
}

// ---------------------------------------------------------------------------
// Long vs Short
// ---------------------------------------------------------------------------
function renderLongShortChart(closed) {
  destroy('longShort');
  const longs = closed.filter((t) => t.direction === 'buy');
  const shorts = closed.filter((t) => t.direction === 'sell');
  const longPnl = longs.reduce((s, t) => s + t.net_profit, 0);
  const shortPnl = shorts.reduce((s, t) => s + t.net_profit, 0);

  charts.longShort = new Chart(document.getElementById('longShortChart'), {
    type: 'bar',
    data: {
      labels: [`Long (${longs.length})`, `Short (${shorts.length})`],
      datasets: [{ data: [longPnl, shortPnl], backgroundColor: [MINT, PERIWINKLE], borderRadius: 8, barThickness: 40 }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: (v) => '$' + v } } } },
  });
}

// ---------------------------------------------------------------------------
// Emotion + Mistake analysis (trade-level fields)
// ---------------------------------------------------------------------------
function renderEmotionChart(closed) {
  destroy('emotion');
  const withEmotion = closed.filter((t) => t.emotion);
  if (withEmotion.length === 0) {
    document.getElementById('emotionChart').parentElement.innerHTML = '<div class="empty-state"><div class="sub">Tag an emotion on your trades to see this chart.</div></div>';
    return;
  }
  const counts = new Map();
  for (const t of withEmotion) counts.set(t.emotion, (counts.get(t.emotion) || 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  charts.emotion = new Chart(document.getElementById('emotionChart'), {
    type: 'doughnut',
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: [MINT, PERIWINKLE, AMBER, CORAL, PURPLE, '#4FD1E8'], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, padding: 10, usePointStyle: true, pointStyle: 'circle' } } } },
  });
}

function renderMistakeChart(closed) {
  destroy('mistake');
  const counts = new Map();
  for (const t of closed) {
    for (const mistake of (t.mistakes || [])) {
      counts.set(mistake, (counts.get(mistake) || 0) + 1);
    }
  }
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (entries.length === 0) {
    document.getElementById('mistakeChart').parentElement.innerHTML = '<div class="empty-state"><div class="sub">Tag mistakes on your trades to see this chart.</div></div>';
    return;
  }

  charts.mistake = new Chart(document.getElementById('mistakeChart'), {
    type: 'bar',
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: CORAL, borderRadius: 6, barThickness: 16 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' } }, y: { grid: { display: false } } } },
  });
}

// ---------------------------------------------------------------------------
// Best / worst table
// ---------------------------------------------------------------------------
function renderBWTable(adv) {
  const body = document.getElementById('bwTableBody');
  if (!adv) { body.innerHTML = ''; return; }

  const rows = [
    ['Pair', adv.bestPair, adv.worstPair],
    ['Strategy', adv.bestStrategy, adv.worstStrategy],
    ['Session', adv.bestSession, adv.worstSession],
    ['Month', adv.bestMonth, adv.worstMonth],
  ];

  body.innerHTML = rows.map(([label, best, worst]) => `
    <tr>
      <td>${label}</td>
      <td style="color:var(--mint);">${best ? `${best[0]} (${fmtMoney(best[1])})` : '—'}</td>
      <td style="color:var(--coral);">${worst ? `${worst[0]} (${fmtMoney(worst[1])})` : '—'}</td>
    </tr>
  `).join('');
}

// ---------------------------------------------------------------------------
// Full render
// ---------------------------------------------------------------------------
async function renderAll() {
  allTrades = await tradesRepo.list();
  const settings = user ? await getById('settings', user.id) : null;
  const startingBalance = settings?.starting_balance || 0;

  const closed = allTrades.filter((t) => t.trade_status === 'closed' && typeof t.net_profit === 'number' && !t.deleted_at);
  const dash = computeDashboardStats(allTrades, startingBalance);
  const adv = computeAdvancedStats(allTrades);

  document.getElementById('statsSummary').textContent = `${closed.length} closed trade${closed.length === 1 ? '' : 's'} analyzed`;

  renderMetricGrid(adv);

  if (closed.length === 0) {
    ['equityChart', 'winLossChart', 'rrChart', 'periodChart', 'pairChart', 'strategyChart', 'weekdayChart', 'longShortChart', 'emotionChart', 'mistakeChart'].forEach((id) => {
      document.getElementById(id).parentElement.innerHTML = '<div class="empty-state"><div class="sub">No data yet.</div></div>';
    });
    renderBWTable(null);
    return;
  }

  renderEquityChart(dash);
  renderWinLossChart(dash);
  renderRRChart(closed);
  renderPeriodChart(closed);
  renderBarChart('pairChart', 'pair', groupSum(closed, (t) => t.pair), MINT);
  renderBarChart('strategyChart', 'strategy', groupSum(closed, (t) => t.strategy), PERIWINKLE);
  renderWeekdayChart(closed);
  renderLongShortChart(closed);
  renderEmotionChart(closed);
  renderMistakeChart(closed);
  renderBWTable(adv);
}

await renderAll();
