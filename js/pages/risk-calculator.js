// ============================================================================
// risk-calculator.html controller — instrument-agnostic position sizing.
// Works from raw price distance rather than pip conventions, so it's correct
// for forex, crypto, indices, and stocks alike as long as Entry/SL/TP are in
// the instrument's own price units.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { getById } from '../db.js';
import { applyThemeForUser } from '../theme.js';

const user = await requireAuth();
if (user) await applyThemeForUser(user.id);
if (user) {
  document.getElementById('userName').textContent = user.display_name || user.email;
  document.getElementById('userAvatar').textContent = (user.display_name || user.email).slice(0, 2).toUpperCase();
  document.getElementById('userFoot').addEventListener('click', async () => {
    if (confirm('Sign out of this device?')) { await logout(); window.location.href = 'login.html'; }
  });

  const settings = await getById('settings', user.id);
  if (settings?.starting_balance) document.getElementById('rBalance').value = settings.starting_balance;
}

const STATUS_LABEL = {
  [SYNC_STATUS.SYNCED]: 'Synced', [SYNC_STATUS.SYNCING]: 'Syncing…',
  [SYNC_STATUS.OFFLINE]: 'Offline — changes saved locally', [SYNC_STATUS.ERROR]: 'Sync error',
};
syncManager.onStatusChange((status) => {
  document.getElementById('syncDot').className = `sync-dot status-${status}`;
  document.getElementById('syncStatus').className = `sync-status status-${status}`;
  document.getElementById('syncStatusText').textContent = STATUS_LABEL[status];
});
syncManager.start();

document.getElementById('rRiskMode').addEventListener('change', (e) => {
  document.getElementById('rRiskValueLabel').textContent = e.target.value === 'percent' ? 'Risk %' : 'Risk Amount ($)';
  document.getElementById('rRiskValue').value = e.target.value === 'percent' ? '1' : '100';
  calculate();
});

function num(id) { return Number(document.getElementById(id).value) || 0; }

function calculate() {
  const balance = num('rBalance');
  const riskMode = document.getElementById('rRiskMode').value;
  const riskValue = num('rRiskValue');
  const entry = num('rEntryPrice');
  const stopLoss = num('rStopLoss');
  const takeProfit = num('rTakeProfit');
  const contractSize = num('rContractSize') || 100000;
  const leverage = num('rLeverage') || 1;

  const riskAmount = riskMode === 'percent' ? balance * (riskValue / 100) : riskValue;
  const stopDistance = Math.abs(entry - stopLoss);

  let positionSize = 0;
  if (stopDistance > 0) positionSize = riskAmount / stopDistance;
  const lotSize = positionSize / contractSize;

  let reward = null;
  let rr = null;
  if (takeProfit > 0 && entry > 0) {
    const rewardDistance = Math.abs(takeProfit - entry);
    reward = rewardDistance * positionSize;
    rr = stopDistance > 0 ? rewardDistance / stopDistance : null;
  }

  const marginRequired = entry > 0 ? (positionSize * entry) / leverage : 0;

  document.getElementById('outRiskAmount').textContent = `$${riskAmount.toFixed(2)}`;
  document.getElementById('outStopDistance').textContent = stopDistance.toFixed(5).replace(/0+$/, '').replace(/\.$/, '.0');
  document.getElementById('outPositionSize').textContent = positionSize.toLocaleString(undefined, { maximumFractionDigits: 2 });
  document.getElementById('outLotSize').textContent = lotSize.toFixed(2);
  document.getElementById('outReward').textContent = reward !== null ? `$${reward.toFixed(2)}` : '—';
  document.getElementById('outRR').textContent = rr !== null ? `1 : ${rr.toFixed(2)}` : '—';
  document.getElementById('outMargin').textContent = `$${marginRequired.toFixed(2)}`;
}

document.querySelectorAll('#rBalance, #rRiskValue, #rEntryPrice, #rStopLoss, #rTakeProfit, #rContractSize, #rLeverage, #rDirection').forEach((el) => {
  el.addEventListener('input', calculate);
});

calculate();
