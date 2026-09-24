let pingDelay = 500;
export const _setPingDelay = (ms) => { pingDelay = ms; }; // tests only
export const _resetCache = () => { cachedTab = null; };

async function pingTab(tabId, tries, delay = pingDelay) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await browser.tabs.sendMessage(tabId, { channel: 'claude-api', op: 'ping' });
      if (r?.data?.ok) return true;
    } catch { /* content script not ready */ }
    if (delay) await new Promise(r => setTimeout(r, delay));
  }
  return false;
}

async function discover() {
  let [tab] = await browser.tabs.query({ url: 'https://claude.ai/*', active: true, currentWindow: true });
  if (!tab) [tab] = await browser.tabs.query({ url: 'https://claude.ai/*' });
  if (!tab) {
    tab = await browser.tabs.create({ url: 'https://claude.ai/new', active: false });
    if (await pingTab(tab.id, 30)) return tab.id;
    throw new Error('Не удалось подключиться к claude.ai (войдите в аккаунт и повторите).');
  }
  if (await pingTab(tab.id, 3)) return tab.id;
  // tab was opened before the extension was installed/granted: reload to inject the content script
  await browser.tabs.reload(tab.id);
  if (await pingTab(tab.id, 30)) return tab.id;
  throw new Error('Content script не отвечает на вкладке claude.ai. Проверьте разрешение доступа к claude.ai.');
}

let cachedTab = null;
export async function findClaudeTab() {
  if (cachedTab != null && await pingTab(cachedTab, 1, 0)) return cachedTab;
  cachedTab = await discover();
  return cachedTab;
}

export async function api(op, args) {
  const tabId = await findClaudeTab();
  const res = await browser.tabs.sendMessage(tabId, { channel: 'claude-api', op, args });
  if (res?.error) throw new Error(res.error);
  return res.data;
}
