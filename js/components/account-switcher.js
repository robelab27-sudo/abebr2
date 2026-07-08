// ============================================================================
// Account Switcher — a topbar dropdown letting the person view "All
// Accounts" or focus on one specific account (e.g. their live account vs. a
// prop firm challenge). Every page that mounts this listens for the
// 'account-changed' event (dispatched by account-context.js) and re-filters
// its own data accordingly.
// ============================================================================

import { getAccounts, getActiveAccountId, setActiveAccountId } from '../lib/account-context.js';

export async function mountAccountSwitcher(container) {
  container.innerHTML = `
    <div class="acct-switcher">
      <div class="account-pill" id="acctSwitcherTrigger">
        <span class="dot"></span>
        <span id="acctSwitcherLabel">All Accounts</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <div class="acct-switcher-menu" id="acctSwitcherMenu"></div>
    </div>
  `;

  const trigger = container.querySelector('#acctSwitcherTrigger');
  const menu = container.querySelector('#acctSwitcherMenu');
  const label = container.querySelector('#acctSwitcherLabel');

  async function renderMenu() {
    const [accounts, activeId] = await Promise.all([getAccounts(), getActiveAccountId()]);

    const allItem = `
      <div class="acct-switcher-item ${!activeId ? 'active' : ''}" data-account-id="">
        <span>All Accounts</span>
      </div>`;

    const accountItems = accounts.map((a) => `
      <div class="acct-switcher-item ${activeId === a.id ? 'active' : ''}" data-account-id="${a.id}">
        <div>
          <div>${escapeHtml(a.account_name)}</div>
          ${a.prop_firm ? `<div class="sub">${escapeHtml(a.prop_firm)}</div>` : ''}
        </div>
      </div>`).join('');

    menu.innerHTML = allItem + (accounts.length > 0 ? accountItems : '<div class="acct-switcher-empty">No accounts yet — add one in Settings.</div>');

    const activeAccount = accounts.find((a) => a.id === activeId);
    label.textContent = activeAccount ? activeAccount.account_name : 'All Accounts';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  trigger.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isOpen = menu.classList.contains('open');
    document.querySelectorAll('.acct-switcher-menu.open').forEach((m) => m.classList.remove('open'));
    if (!isOpen) { await renderMenu(); menu.classList.add('open'); }
  });

  menu.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-account-id]');
    if (!item) return;
    await setActiveAccountId(item.dataset.accountId || null);
    menu.classList.remove('open');
    await renderMenu();
  });

  document.addEventListener('click', () => menu.classList.remove('open'));

  await renderMenu();
}
