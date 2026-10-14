import { validate, proxyConfig, matchesProxy } from './config.js';

const attempts = new Map();
chrome.webRequest.onAuthRequired.addListener((details, callback) => {
  chrome.storage.session.get('credentials').then(({ credentials }) => {
    if (!matchesProxy(details, credentials)) return callback({});
    if (attempts.has(details.requestId)) return callback({ cancel: true });
    attempts.set(details.requestId, true);
    callback({ authCredentials: { username: credentials.username, password: credentials.password } });
  }).catch(() => callback({ cancel: true }));
}, { urls: ['<all_urls>'] }, ['asyncBlocking']);
const cleanup = details => attempts.delete(details.requestId);
chrome.webRequest.onCompleted.addListener(cleanup, { urls: ['<all_urls>'] });
chrome.webRequest.onErrorOccurred.addListener(cleanup, { urls: ['<all_urls>'] });

async function handle(message) {
  if (message.type === 'status') {
    const [proxy, local, session] = await Promise.all([
      chrome.proxy.settings.get({ incognito: false }),
      chrome.storage.local.get('settings'),
      chrome.storage.session.get('credentials')
    ]);
    return { settings: local.settings, control: proxy.levelOfControl,
      active: proxy.levelOfControl === 'controlled_by_this_extension',
      hasCredentials: Boolean(session.credentials) };
  }
  if (message.type === 'connect') {
    const credentials = validate(message.settings);
    const current = await chrome.proxy.settings.get({ incognito: false });
    if (!['controllable_by_this_extension', 'controlled_by_this_extension'].includes(current.levelOfControl)) {
      throw new Error('Chrome proxy settings are controlled by policy or another extension.');
    }
    const previous = await chrome.storage.session.get('credentials');
    await chrome.storage.session.set({ credentials });
    try {
      // Incognito inherits regular settings; spanning mode shares this worker
      // and its session credentials when the user allows incognito access.
      await chrome.proxy.settings.set({ value: proxyConfig(credentials), scope: 'regular' });
    } catch (error) {
      if (previous.credentials) await chrome.storage.session.set(previous);
      else await chrome.storage.session.remove('credentials');
      throw error;
    }
    const { password, ...settings } = credentials;
    await chrome.storage.local.set({ settings });
    attempts.clear();
    return { ok: true };
  }
  if (message.type === 'disconnect') {
    await chrome.proxy.settings.clear({ scope: 'regular' });
    await chrome.storage.session.remove('credentials');
    attempts.clear();
    return { ok: true };
  }
  throw new Error('Unknown operation.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message).then(respond).catch(error => respond({ error: error.message }));
  return true;
});
