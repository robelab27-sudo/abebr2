// ============================================================================
// journal.html controller — a list of journal entries (linked to a trade or
// standalone/daily) plus a full editor covering every field from the spec:
// pre-trade analysis through post-trade review and psychology scoring.
// ============================================================================

import { requireAuth, logout } from '../auth.js';
import { syncManager, SYNC_STATUS } from '../sync.js';
import { journalRepo, tradesRepo } from '../repositories/index.js';
import { applyThemeForUser } from '../theme.js';
import { mountScreenshotManager } from '../components/screenshot-manager.js';
import { mountAccountSwitcher } from '../components/account-switcher.js';
import { getActiveAccountId } from '../lib/account-context.js';

let activeAccountId = null; // cached locally since renderList() runs synchronously

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
// Sync status (mirrored on both the list view and the editor view header)
// ---------------------------------------------------------------------------
const STATUS_LABEL = {
  [SYNC_STATUS.SYNCED]: 'Synced', [SYNC_STATUS.SYNCING]: 'Syncing…',
  [SYNC_STATUS.OFFLINE]: 'Offline — changes saved locally', [SYNC_STATUS.ERROR]: 'Sync error',
};
syncManager.onStatusChange((status) => {
  for (const suffix of ['', '2']) {
    document.getElementById(`syncDot${suffix}`).className = `sync-dot status-${status}`;
    document.getElementById(`syncStatus${suffix}`).className = `sync-status status-${status}`;
    document.getElementById(`syncStatusText${suffix}`).textContent = STATUS_LABEL[status];
  }
  if (status === SYNC_STATUS.SYNCED) loadData();
});
syncManager.start();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let entries = [];
let trades = [];
let currentEditId = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function loadData() {
  entries = await journalRepo.list();
  trades = await tradesRepo.list();
  populateTradeSelect();
  renderList();
}

function tradeById(id) {
  return trades.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// List view
// ---------------------------------------------------------------------------
function currentFilters() {
  return {
    search: document.getElementById('searchInput').value.trim().toLowerCase(),
    link: document.getElementById('linkFilter').value,
  };
}

function renderList() {
  const f = currentFilters();
  let filtered = [...entries];

  if (activeAccountId) {
    filtered = filtered.filter((e) => !e.trade_id || tradeById(e.trade_id)?.account_id === activeAccountId);
  }

  if (f.link === 'linked') filtered = filtered.filter((e) => e.trade_id);
  if (f.link === 'standalone') filtered = filtered.filter((e) => !e.trade_id);

  if (f.search) {
    filtered = filtered.filter((e) => {
      const trade = e.trade_id ? tradeById(e.trade_id) : null;
      const haystack = [
        e.lessons_learned, e.psychology_notes, e.pre_trade_analysis, e.notes,
        trade?.pair,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(f.search);
    });
  }

  filtered.sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || ''));

  document.getElementById('journalSummary').textContent = `${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`;

  const list = document.getElementById('journalList');
  list.innerHTML = '';
  document.getElementById('journalEmpty').style.display = filtered.length === 0 ? 'flex' : 'none';

  for (const entry of filtered) {
    const trade = entry.trade_id ? tradeById(entry.trade_id) : null;
    const snippet = entry.lessons_learned || entry.psychology_notes || entry.pre_trade_analysis || 'No notes written yet.';

    const card = document.createElement('div');
    card.className = 'journal-card';
    card.innerHTML = `
      <div class="journal-card-head">
        <span class="journal-card-date">${entry.entry_date || ''}</span>
        ${trade
          ? `<div class="journal-card-linked"><span class="dir-badge ${trade.direction}">${trade.direction === 'buy' ? '▲' : '▼'} ${escapeHtml(trade.pair)}</span>
              <span class="pnl-cell ${trade.net_profit >= 0 ? 'pos' : 'neg'}">${trade.net_profit >= 0 ? '+' : ''}$${Math.abs(trade.net_profit || 0).toFixed(2)}</span></div>`
          : `<span class="tag-chip">Daily entry</span>`}
      </div>
      <div class="journal-card-snippet">${escapeHtml(snippet)}</div>
      <div class="journal-card-scores">
        ${entry.discipline_score ? `<span class="score-badge">Discipline ${entry.discipline_score}/10</span>` : ''}
        ${entry.confidence_score ? `<span class="score-badge">Confidence ${entry.confidence_score}/10</span>` : ''}
        ${entry.emotion_score ? `<span class="score-badge">Emotion ${entry.emotion_score}/10</span>` : ''}
      </div>
    `;
    card.addEventListener('click', () => showEditor(entry.id));
    list.appendChild(card);
  }
}

document.getElementById('searchInput').addEventListener('input', renderList);
document.getElementById('linkFilter').addEventListener('change', renderList);
document.getElementById('newEntryBtn').addEventListener('click', () => showEditor(null));

// ---------------------------------------------------------------------------
// Editor view
// ---------------------------------------------------------------------------
const FIELD_MAP = {
  jEntryDate: 'entry_date',
  jPreTradeAnalysis: 'pre_trade_analysis', jEntryReason: 'entry_reason', jMarketStructure: 'market_structure', jTradePlan: 'trade_plan',
  jExecutionNotes: 'execution_notes', jManagementNotes: 'management_notes',
  jExitReason: 'exit_reason', jLessonsLearned: 'lessons_learned', jWhatWentWell: 'what_went_well',
  jWhatWentWrong: 'what_went_wrong', jImprovements: 'improvements',
  jPsychologyNotes: 'psychology_notes', jEmotionScore: 'emotion_score', jConfidenceScore: 'confidence_score',
  jDisciplineScore: 'discipline_score', jMistakeNotes: 'mistake_notes',
};

function populateTradeSelect() {
  const select = document.getElementById('jLinkedTrade');
  const sorted = [...trades].sort((a, b) => (b.entry_date || '').localeCompare(a.entry_date || '')).slice(0, 300);
  select.innerHTML = '<option value="">— Standalone / daily entry —</option>' +
    sorted.map((t) => `<option value="${t.id}">${escapeHtml(t.pair)} ${t.direction === 'buy' ? '▲' : '▼'} · ${t.entry_date} · ${t.net_profit >= 0 ? '+' : ''}$${(t.net_profit || 0).toFixed(2)}</option>`).join('');
}

function showEditor(entryId) {
  currentEditId = entryId;
  const entry = entryId ? entries.find((e) => e.id === entryId) : null;

  for (const [fieldId, key] of Object.entries(FIELD_MAP)) {
    const el = document.getElementById(fieldId);
    el.value = entry && entry[key] !== null && entry[key] !== undefined ? entry[key] : '';
  }
  document.getElementById('jLinkedTrade').value = entry?.trade_id || '';
  if (!entry) document.getElementById('jEntryDate').value = new Date().toISOString().slice(0, 10);

  document.getElementById('deleteEntryBtn').style.display = entry ? 'inline-flex' : 'none';

  const shotsHint = document.getElementById('shotsHintSection');
  const preContainer = document.getElementById('shotsPreTrade');
  const duringContainer = document.getElementById('shotsDuringTrade');
  const postContainer = document.getElementById('shotsPostTrade');

  if (entry?.id) {
    shotsHint.style.display = 'none';
    mountScreenshotManager(preContainer, { journalEntryId: entry.id, category: 'pre_trade' });
    mountScreenshotManager(duringContainer, { journalEntryId: entry.id, category: 'during_trade' });
    mountScreenshotManager(postContainer, { journalEntryId: entry.id, category: 'post_trade' });
  } else {
    shotsHint.style.display = 'block';
    preContainer.innerHTML = '';
    duringContainer.innerHTML = '';
    postContainer.innerHTML = '';
  }

  document.getElementById('listView').classList.remove('active');
  document.getElementById('editorView').classList.add('active');
  window.scrollTo(0, 0);
}

function showList() {
  document.getElementById('editorView').classList.remove('active');
  document.getElementById('listView').classList.add('active');
  renderList();
}

document.getElementById('backToList').addEventListener('click', showList);

async function saveEntry() {
  const data = {};
  for (const [fieldId, key] of Object.entries(FIELD_MAP)) {
    const raw = document.getElementById(fieldId).value;
    if (['emotion_score', 'confidence_score', 'discipline_score'].includes(key)) {
      data[key] = raw === '' ? null : Math.max(1, Math.min(10, Number(raw)));
    } else {
      data[key] = raw;
    }
  }
  data.trade_id = document.getElementById('jLinkedTrade').value || null;

  if (!data.entry_date) { showToast('Entry date is required.', 'error'); return; }

  try {
    if (currentEditId) await journalRepo.update(currentEditId, data);
    else await journalRepo.create(data);
    showToast('Journal entry saved');
    entries = await journalRepo.list();
    showList();
  } catch (err) {
    console.error(err);
    showToast('Could not save this entry.', 'error');
  }
}

document.getElementById('saveEntryBtn').addEventListener('click', saveEntry);
document.getElementById('saveEntryBtn2').addEventListener('click', saveEntry);

document.getElementById('deleteEntryBtn').addEventListener('click', async () => {
  if (!currentEditId) return;
  if (!confirm('Delete this journal entry?')) return;
  await journalRepo.remove(currentEditId);
  showToast('Entry deleted');
  entries = await journalRepo.list();
  showList();
});

await mountAccountSwitcher(document.getElementById('acctSwitcherContainer'));
activeAccountId = await getActiveAccountId();
window.addEventListener('account-changed', (e) => { activeAccountId = e.detail.accountId; renderList(); });

await loadData();
