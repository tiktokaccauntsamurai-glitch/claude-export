import { recordEntry, recordHeaders } from './src/core/recorder.js';

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') browser.tabs.create({ url: browser.runtime.getURL('export/export.html') });
});

// Endpoint recorder (diagnostics): while `recording` is true, log claude.ai/api requests (patterns only in the report).
// Serialised through one promise chain so parallel requests do not overwrite each other.
let chain = Promise.resolve();
browser.webRequest.onCompleted.addListener((d) => {
  chain = chain.then(async () => {
    const { recording, recLog } = await browser.storage.local.get(['recording', 'recLog']);
    if (!recording) return;
    await browser.storage.local.set({ recLog: recordEntry(recLog || {}, d) });
  }).catch(() => {});
}, { urls: ['https://claude.ai/api/*'] });

browser.webRequest.onSendHeaders.addListener((d) => {
  chain = chain.then(async () => {
    const { recording, recLog } = await browser.storage.local.get(['recording', 'recLog']);
    if (!recording) return;
    await browser.storage.local.set({ recLog: recordHeaders(recLog || {}, d) });
  }).catch(() => {});
}, { urls: ['https://claude.ai/api/*'] }, ['requestHeaders']);
