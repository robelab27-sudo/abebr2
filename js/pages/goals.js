// ============================================================================
// goals.html controller — create/track/update daily, weekly, monthly,
// yearly, trading, risk, and psychology goals with progress bars.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { goalsRepo } from '../repositories/index.js';
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

function showToast(message, type = 'success') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

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

let goals = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function loadAndRender() {
  goals = await goalsRepo.list();
  render();
}

function render() {
  const typeFilter = document.getElementById('typeFilter').value;
  const statusFilter = document.getElementById('statusFilter').value;

  let filtered = [...goals];
  if (typeFilter) filtered = filtered.filter((g) => g.goal_type === typeFilter);
  if (statusFilter) filtered = filtered.filter((g) => g.status === statusFilter);
  filtered.sort((a, b) => (b.period_start || b.created_at || '').localeCompare(a.period_start || a.created_at || ''));

  document.getElementById('goalsSummary').textContent = `${filtered.length} goal${filtered.length === 1 ? '' : 's'}`;

  const list = document.getElementById('goalsList');
  list.innerHTML = '';
  document.getElementById('goalsEmpty').style.display = filtered.length === 0 ? 'flex' : 'none';

  for (const goal of filtered) {
    const target = goal.target_value || 0;
    const current = goal.current_value || 0;
    const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const isOver = target > 0 && current > target;

    const card = document.createElement('div');
    card.className = 'goal-card';
    card.innerHTML = `
      <div class="goal-card-head">
        <div>
          <div class="goal-title">${escapeHtml(goal.title)}</div>
          <div class="goal-meta-row" style="margin-top:4px;">
            <span class="goal-type-chip">${goal.goal_type}</span>
            ${goal.period_start ? `<span>${goal.period_start}${goal.period_end ? ' → ' + goal.period_end : ''}</span>` : ''}
          </div>
        </div>
        <select class="status-select" data-id="${goal.id}" style="background:none; border:none; cursor:pointer;">
          <option value="active" ${goal.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="completed" ${goal.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="missed" ${goal.status === 'missed' ? 'selected' : ''}>Missed</option>
          <option value="archived" ${goal.status === 'archived' ? 'selected' : ''}>Archived</option>
        </select>
      </div>
      <div class="goal-progress-track"><div class="goal-progress-fill ${isOver ? 'over' : ''}" style="width:${pct}%;"></div></div>
      <div class="goal-meta-row">
        <span>${current}${goal.unit || ''} of ${target}${goal.unit || ''}</span>
        <span>${target > 0 ? Math.round((current / target) * 100) : 0}%</span>
      </div>
      <div class="goal-card-actions" style="margin-top:12px;">
        <input type="number" step="any" class="progress-input" data-id="${goal.id}" placeholder="Update progress…" style="flex:1; background:rgba(255,255,255,0.03); border:1px solid var(--glass-border); border-radius:var(--radius-sm); padding:7px 10px; color:var(--text); font-family:'Inter'; font-size:12.5px;">
        <div class="toolbar-btn update-progress-btn" data-id="${goal.id}">Update</div>
        <div class="icon-btn danger delete-goal-btn" data-id="${goal.id}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
        </div>
      </div>
    `;
    list.appendChild(card);
  }
}

document.getElementById('typeFilter').addEventListener('change', render);
document.getElementById('statusFilter').addEventListener('change', render);

document.getElementById('goalsList').addEventListener('change', async (event) => {
  const select = event.target.closest('.status-select');
  if (select) {
    await goalsRepo.update(select.dataset.id, { status: select.value });
    showToast('Goal updated');
    goals = await goalsRepo.list();
    render();
  }
});

document.getElementById('goalsList').addEventListener('click', async (event) => {
  const updateBtn = event.target.closest('.update-progress-btn');
  if (updateBtn) {
    const input = document.querySelector(`.progress-input[data-id="${updateBtn.dataset.id}"]`);
    const value = Number(input.value);
    if (input.value === '' || isNaN(value)) { showToast('Enter a number first.', 'error'); return; }
    await goalsRepo.update(updateBtn.dataset.id, { current_value: value });
    showToast('Progress updated');
    goals = await goalsRepo.list();
    render();
    return;
  }
  const deleteBtn = event.target.closest('.delete-goal-btn');
  if (deleteBtn) {
    if (!confirm('Delete this goal?')) return;
    await goalsRepo.remove(deleteBtn.dataset.id);
    showToast('Goal deleted');
    goals = await goalsRepo.list();
    render();
  }
});

document.getElementById('newGoalBtn').addEventListener('click', () => {
  document.getElementById('newGoalForm').style.display = 'block';
});
document.getElementById('cancelNewGoal').addEventListener('click', () => {
  document.getElementById('newGoalForm').style.display = 'none';
});

document.getElementById('saveGoalBtn').addEventListener('click', async () => {
  const title = document.getElementById('gTitle').value.trim();
  if (!title) { showToast('Title is required.', 'error'); return; }

  await goalsRepo.create({
    goal_type: document.getElementById('gType').value,
    title,
    unit: document.getElementById('gUnit').value.trim(),
    target_value: Number(document.getElementById('gTarget').value) || 0,
    current_value: Number(document.getElementById('gCurrent').value) || 0,
    period_start: document.getElementById('gPeriodStart').value || null,
    period_end: document.getElementById('gPeriodEnd').value || null,
    status: 'active',
  });

  document.getElementById('newGoalForm').style.display = 'none';
  document.querySelectorAll('#newGoalForm input').forEach((i) => (i.value = ''));
  showToast('Goal created');
  await loadAndRender();
});

await loadAndRender();
