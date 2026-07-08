// ============================================================================
// psychology.html controller — score trends from journal entries, plus
// behavioral pattern analysis (FOMO, revenge trading, overtrading, etc.)
// derived from the "mistakes" tags recorded on trades, including how much
// each pattern actually costs.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { journalRepo, tradesRepo } from '../repositories/index.js';
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
const MINT = '#3DDC97', CORAL = '#FF6B6B', PERIWINKLE = '#7C9EFF', AMBER = '#F5B860';
const charts = {};
function destroy(key) { if (charts[key]) { charts[key].destroy(); charts[key] = null; } }

async function renderAll() {
  const [entries, allTrades, activeAccountId] = await Promise.all([journalRepo.list(), tradesRepo.list(), getActiveAccountId()]);
  const trades = activeAccountId ? allTrades.filter((t) => t.account_id === activeAccountId) : allTrades;
  const tradeIds = new Set(trades.map((t) => t.id));
  const scopedEntries = activeAccountId ? entries.filter((e) => !e.trade_id || tradeIds.has(e.trade_id)) : entries;
  renderKpis(scopedEntries);
  renderTrendChart(scopedEntries);
  renderEmotionPnlChart(trades);
  renderPatternCharts(trades);
}

function avg(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }

function renderKpis(entries) {
  const scored = entries.filter((e) => !e.deleted_at && (e.discipline_score || e.confidence_score || e.emotion_score));
  const discipline = avg(scored.map((e) => e.discipline_score).filter((v) => typeof v === 'number'));
  const confidence = avg(scored.map((e) => e.confidence_score).filter((v) => typeof v === 'number'));
  const emotion = avg(scored.map((e) => e.emotion_score).filter((v) => typeof v === 'number'));

  document.getElementById('kpiDiscipline').textContent = discipline !== null ? `${discipline.toFixed(1)}/10` : '—';
  document.getElementById('kpiConfidence').textContent = confidence !== null ? `${confidence.toFixed(1)}/10` : '—';
  document.getElementById('kpiEmotion').textContent = emotion !== null ? `${emotion.toFixed(1)}/10` : '—';
  document.getElementById('kpiJournaled').textContent = scored.length;
}

function renderTrendChart(entries) {
  destroy('trend');
  const scored = entries
    .filter((e) => !e.deleted_at && e.entry_date && (e.discipline_score || e.confidence_score || e.emotion_score))
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  const wrap = document.getElementById('trendChart').parentElement;
  const emptyState = document.getElementById('trendEmpty');
  if (scored.length === 0) { wrap.style.display = 'none'; emptyState.style.display = 'flex'; return; }
  wrap.style.display = 'block'; emptyState.style.display = 'none';

  charts.trend = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: scored.map((e) => e.entry_date),
      datasets: [
        { label: 'Discipline', data: scored.map((e) => e.discipline_score ?? null), borderColor: MINT, tension: 0.3, pointRadius: 2, spanGaps: true },
        { label: 'Confidence', data: scored.map((e) => e.confidence_score ?? null), borderColor: PERIWINKLE, tension: 0.3, pointRadius: 2, spanGaps: true },
        { label: 'Emotion', data: scored.map((e) => e.emotion_score ?? null), borderColor: AMBER, tension: 0.3, pointRadius: 2, spanGaps: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle' } } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { min: 0, max: 10, grid: { color: 'rgba(255,255,255,0.05)' } } },
    },
  });
}

function renderEmotionPnlChart(trades) {
  destroy('emotionPnl');
  const closed = trades.filter((t) => !t.deleted_at && t.trade_status === 'closed' && typeof t.net_profit === 'number' && t.emotion);
  const wrap = document.getElementById('emotionPnlChart').parentElement;
  const emptyState = document.getElementById('emotionPnlEmpty');
  if (closed.length === 0) { wrap.style.display = 'none'; emptyState.style.display = 'flex'; return; }
  wrap.style.display = 'block'; emptyState.style.display = 'none';

  const map = new Map();
  for (const t of closed) {
    const bucket = map.get(t.emotion) || { sum: 0, count: 0 };
    bucket.sum += t.net_profit; bucket.count += 1;
    map.set(t.emotion, bucket);
  }
  const entries = [...map.entries()].sort((a, b) => b[1].sum - a[1].sum);

  charts.emotionPnl = new Chart(document.getElementById('emotionPnlChart'), {
    type: 'bar',
    data: { labels: entries.map((e) => `${e[0]} (${e[1].count})`), datasets: [{ data: entries.map((e) => e[1].sum), backgroundColor: (ctx) => (ctx.raw >= 0 ? MINT : CORAL), borderRadius: 6, barThickness: 16 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: (v) => '$' + v } }, y: { grid: { display: false } } } },
  });
}

function renderPatternCharts(trades) {
  destroy('pattern');
  destroy('patternCost');
  const closed = trades.filter((t) => !t.deleted_at);

  const counts = new Map();
  const costs = new Map();
  for (const t of closed) {
    for (const mistake of (t.mistakes || [])) {
      counts.set(mistake, (counts.get(mistake) || 0) + 1);
      if (typeof t.net_profit === 'number') costs.set(mistake, (costs.get(mistake) || 0) + t.net_profit);
    }
  }

  const countEntries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const patternWrap = document.getElementById('patternChart').parentElement;
  const patternEmpty = document.getElementById('patternEmpty');

  if (countEntries.length === 0) {
    patternWrap.style.display = 'none'; patternEmpty.style.display = 'flex';
    document.getElementById('patternCostChart').parentElement.style.display = 'none';
    document.getElementById('patternCostEmpty').style.display = 'flex';
    return;
  }
  patternWrap.style.display = 'block'; patternEmpty.style.display = 'none';
  document.getElementById('patternCostChart').parentElement.style.display = 'block';
  document.getElementById('patternCostEmpty').style.display = 'none';

  charts.pattern = new Chart(document.getElementById('patternChart'), {
    type: 'bar',
    data: { labels: countEntries.map((e) => e[0]), datasets: [{ data: countEntries.map((e) => e[1]), backgroundColor: AMBER, borderRadius: 6, barThickness: 16 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' } }, y: { grid: { display: false } } } },
  });

  const costEntries = countEntries.map((e) => [e[0], costs.get(e[0]) || 0]);
  charts.patternCost = new Chart(document.getElementById('patternCostChart'), {
    type: 'bar',
    data: { labels: costEntries.map((e) => e[0]), datasets: [{ data: costEntries.map((e) => e[1]), backgroundColor: (ctx) => (ctx.raw >= 0 ? MINT : CORAL), borderRadius: 6, barThickness: 16 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: (v) => '$' + v } }, y: { grid: { display: false } } } },
  });
}

await mountAccountSwitcher(document.getElementById('acctSwitcherContainer'));
window.addEventListener('account-changed', () => renderAll());

await renderAll();
