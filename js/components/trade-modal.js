// ============================================================================
// Shared trade modal: injects its markup into the page once, then exposes
// openTradeModal() for the dashboard, trade history (edit + duplicate), and
// any future page that needs to create or edit a trade. Keeping this in one
// place means the trade form only exists once in the whole app.
// ============================================================================

import { tradesRepo } from '../repositories/index.js';
import { mountScreenshotManager } from './screenshot-manager.js';

let mounted = false;
let resolveCurrent = null;
let currentMode = 'create'; // 'create' | 'edit'
let currentEditId = null;

function modalMarkup() {
  return `
  <div class="modal-overlay hidden" id="tradeModalOverlay">
    <div class="modal">
      <div class="modal-head">
        <h2 id="tradeModalTitle">Add Trade</h2>
        <div class="modal-close" id="tradeModalClose">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
      </div>
      <form id="tradeModalForm">
        <div class="form-grid">
          <div class="field"><label for="tPair">Pair *</label><input type="text" id="tPair" placeholder="EURUSD" required></div>
          <div class="field"><label for="tDirection">Direction *</label>
            <select id="tDirection" required><option value="buy">Buy</option><option value="sell">Sell</option></select>
          </div>
          <div class="field"><label for="tEntryDate">Entry Date *</label><input type="date" id="tEntryDate" required></div>
          <div class="field"><label for="tExitDate">Exit Date</label><input type="date" id="tExitDate"></div>
          <div class="field"><label for="tEntryPrice">Entry Price</label><input type="number" step="any" id="tEntryPrice"></div>
          <div class="field"><label for="tExitPrice">Exit Price</label><input type="number" step="any" id="tExitPrice"></div>
          <div class="field"><label for="tStopLoss">Stop Loss</label><input type="number" step="any" id="tStopLoss"></div>
          <div class="field"><label for="tTakeProfit">Take Profit</label><input type="number" step="any" id="tTakeProfit"></div>
          <div class="field"><label for="tLotSize">Lot Size</label><input type="number" step="any" id="tLotSize"></div>
          <div class="field"><label for="tRR">RR</label><input type="number" step="any" id="tRR"></div>
          <div class="field"><label for="tSession">Session</label>
            <select id="tSession"><option value="">—</option><option>Asia</option><option>London</option><option>NY AM</option><option>NY PM</option></select>
          </div>
          <div class="field"><label for="tStrategy">Strategy</label><input type="text" id="tStrategy" placeholder="Breakout, reversal…"></div>
          <div class="field"><label for="tNetProfit">Net Profit *</label><input type="number" step="any" id="tNetProfit" required></div>
          <div class="field"><label for="tStatus">Status</label>
            <select id="tStatus"><option value="closed">Closed</option><option value="open">Open</option><option value="breakeven">Break-even</option></select>
          </div>
          <div class="field span-2"><label for="tNotes">Notes</label><textarea id="tNotes" placeholder="What happened on this trade?"></textarea></div>
        </div>
        <div class="journal-section" style="margin-top:6px;">
          <div class="journal-section-title">Screenshots</div>
          <div id="tradeModalScreenshots"></div>
          <div class="card-sub" id="tradeModalScreenshotsHint" style="display:none;">Save the trade first, then add screenshots here by editing it.</div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-ghost" id="tradeModalCancel">Cancel</button>
          <button type="submit" class="btn-primary" id="tradeModalSave">Save Trade</button>
        </div>
      </form>
    </div>
  </div>`;
}

function mount() {
  if (mounted) return;
  document.body.insertAdjacentHTML('beforeend', modalMarkup());
  mounted = true;

  const overlay = document.getElementById('tradeModalOverlay');
  const form = document.getElementById('tradeModalForm');

  const close = (result) => {
    overlay.classList.add('hidden');
    if (resolveCurrent) { resolveCurrent(result); resolveCurrent = null; }
  };

  document.getElementById('tradeModalClose').addEventListener('click', () => close(null));
  document.getElementById('tradeModalCancel').addEventListener('click', () => close(null));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveBtn = document.getElementById('tradeModalSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const numOrNull = (id) => {
      const v = document.getElementById(id).value;
      return v === '' ? null : Number(v);
    };

    const data = {
      pair: document.getElementById('tPair').value.trim().toUpperCase(),
      direction: document.getElementById('tDirection').value,
      entry_date: document.getElementById('tEntryDate').value,
      exit_date: document.getElementById('tExitDate').value || null,
      entry_price: numOrNull('tEntryPrice'),
      exit_price: numOrNull('tExitPrice'),
      stop_loss: numOrNull('tStopLoss'),
      take_profit: numOrNull('tTakeProfit'),
      lot_size: numOrNull('tLotSize'),
      rr: numOrNull('tRR'),
      session: document.getElementById('tSession').value || null,
      strategy: document.getElementById('tStrategy').value.trim() || null,
      net_profit: numOrNull('tNetProfit'),
      gross_profit: numOrNull('tNetProfit'),
      trade_status: document.getElementById('tStatus').value,
      notes: document.getElementById('tNotes').value.trim(),
      source: 'manual',
    };

    try {
      const saved = currentMode === 'edit'
        ? await tradesRepo.update(currentEditId, data)
        : await tradesRepo.create(data);
      close(saved);
    } catch (err) {
      console.error(err);
      alert('Could not save this trade. Please try again.');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Trade';
    }
  });
}

/**
 * Opens the trade modal.
 * @param {object} options
 * @param {'create'|'edit'} [options.mode='create']
 * @param {object|null} [options.trade=null] - prefill values. For 'edit', must include `id`.
 * @returns {Promise<object|null>} the saved trade, or null if the user cancelled.
 */
export function openTradeModal({ mode = 'create', trade = null } = {}) {
  mount();
  currentMode = mode;
  currentEditId = mode === 'edit' && trade ? trade.id : null;

  document.getElementById('tradeModalTitle').textContent = mode === 'edit' ? 'Edit Trade' : 'Add Trade';
  document.getElementById('tradeModalForm').reset();

  if (trade) {
    const FIELD_TO_KEY = {
      tPair: 'pair', tDirection: 'direction', tEntryDate: 'entry_date', tExitDate: 'exit_date',
      tEntryPrice: 'entry_price', tExitPrice: 'exit_price', tStopLoss: 'stop_loss', tTakeProfit: 'take_profit',
      tLotSize: 'lot_size', tRR: 'rr', tSession: 'session', tStrategy: 'strategy',
      tNetProfit: 'net_profit', tStatus: 'trade_status', tNotes: 'notes',
    };
    for (const [fieldId, key] of Object.entries(FIELD_TO_KEY)) {
      const value = trade[key];
      const el = document.getElementById(fieldId);
      if (el && value !== undefined && value !== null) el.value = value;
    }
  } else {
    document.getElementById('tEntryDate').value = new Date().toISOString().slice(0, 10);
  }

  document.getElementById('tradeModalOverlay').classList.remove('hidden');

  const screenshotsContainer = document.getElementById('tradeModalScreenshots');
  const screenshotsHint = document.getElementById('tradeModalScreenshotsHint');
  if (mode === 'edit' && trade?.id) {
    screenshotsHint.style.display = 'none';
    screenshotsContainer.style.display = 'block';
    mountScreenshotManager(screenshotsContainer, { tradeId: trade.id });
  } else {
    screenshotsContainer.style.display = 'none';
    screenshotsContainer.innerHTML = '';
    screenshotsHint.style.display = 'block';
  }

  return new Promise((resolve) => { resolveCurrent = resolve; });
}
