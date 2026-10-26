import { validate, proxyConfig, matchesProxy } from './config.js';
import { proxyState } from './state.js';

// Keep stored passwords unavailable to content scripts. Never use storage.sync.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
storageReady.catch(() => {});
const attempts = new Map();
async function storedCredentials() {
  await storageReady;
  const { credentials } = await chrome.storage.session.get('credentials');
  if (credentials) return credentials;
  const { savedCredentials } = await chrome.storage.local.get('savedCredentials');
  return savedCredentials;
}
chrome.webRequest.onAuthRequired.addListener((details, callback) => {
  if (!details.isProxy) return callback({});
  Promise.all([storedCredentials(), chrome.storage.local.get('settings')]).then(async ([credentials, { settings }]) => {
    // A disconnected extension must not authenticate another proxy's requests.
    const current = await chrome.proxy.settings.get({ incognito: false });
    if (current.levelOfControl !== 'controlled_by_this_extension') return callback({});
    if (!matchesProxy(details, credentials ?? settings)) {
      await chrome.storage.session.set({ authStatus: {
        message: 'Chrome requested authentication for a different proxy endpoint. Check your hostname and port.'
      } });
      return callback({});
    }
    if (!credentials || attempts.has(details.requestId)) {
      await chrome.storage.session.set({ authStatus: {
        message: credentials
          ? 'The proxy rejected the saved credentials. Reset credentials and enter the correct username and password.'
          : 'Session credentials expired. Reset credentials to enter them again.'
      } });
      return callback({ cancel: true });
    }
    attempts.set(details.requestId, true);
    await chrome.storage.session.remove('authStatus');
    callback({ authCredentials: { username: credentials.username, password: credentials.password } });
  }).catch(() => callback({ cancel: true }));
}, { urls: ['<all_urls>'] }, ['asyncBlocking']);
const cleanup = details => attempts.delete(details.requestId);
chrome.webRequest.onCompleted.addListener(cleanup, { urls: ['<all_urls>'] });
chrome.webRequest.onErrorOccurred.addListener(cleanup, { urls: ['<all_urls>'] });

async function handle(message) {
  await storageReady;
  if (message.type === 'status') return snapshot();
  if (message.type === 'check') return checkConnection();
  if (message.type === 'connect') {
    const credentials = message.settings ? validate(message.settings) : await storedCredentials();
    if (!credentials) throw new Error('Enter your proxy credentials first.');
    const current = await chrome.proxy.settings.get({ incognito: false });
    if (!['controllable_by_this_extension', 'controlled_by_this_extension'].includes(current.levelOfControl)) {
      throw new Error('Chrome proxy settings are controlled by policy or another extension.');
    }
    const previousSession = await chrome.storage.session.get('credentials');
    const previousLocal = await chrome.storage.local.get(['settings', 'savedCredentials']);
    try {
      await chrome.storage.session.set({ credentials });
      if (message.settings) {
        const { password, ...settings } = credentials;
        await chrome.storage.local.set({ settings });
        if (message.remember === true) await chrome.storage.local.set({ savedCredentials: credentials });
        else await chrome.storage.local.remove('savedCredentials');
      }
      // Regular settings are inherited by permitted incognito windows.
      await chrome.proxy.settings.set({ value: proxyConfig(credentials), scope: 'regular' });
    } catch (error) {
      await chrome.storage.session.remove('credentials');
      if (previousSession.credentials) await chrome.storage.session.set(previousSession);
      await chrome.storage.local.remove(['settings', 'savedCredentials']);
      const restored = Object.fromEntries(Object.entries(previousLocal).filter(([, value]) => value !== undefined));
      if (Object.keys(restored).length) await chrome.storage.local.set(restored);
      throw error;
    }
    await chrome.storage.session.remove('authStatus');
    attempts.clear();
    await invalidateCheck();
    await updateBadge();
    return { ok: true };
  }
  if (message.type === 'disconnect' || message.type === 'reset') {
    // Clear the proxy before deleting credentials so failure preserves usable state.
    await chrome.proxy.settings.clear({ scope: 'regular' });
    if (message.type === 'reset') {
      await chrome.storage.session.remove('credentials');
      await chrome.storage.local.remove(['settings', 'savedCredentials']);
    }
    await chrome.storage.session.remove('authStatus');
    attempts.clear();
    await invalidateCheck();
    await updateBadge();
    return { ok: true };
  }
  throw new Error('Unknown operation.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message).then(respond).catch(error => respond({ error: error.message }));
  return true;
});

async function snapshot() {
  const [proxy, local, credentials, session] = await Promise.all([
    chrome.proxy.settings.get({ incognito: false }),
    chrome.storage.local.get(['settings', 'savedCredentials']), storedCredentials(),
    chrome.storage.session.get(['authStatus', 'connectionCheck'])
  ]);
  const configuration = proxyState(proxy, local.settings, Boolean(credentials), session.authStatus);
  return { ...configuration, settings: local.settings, control: proxy.levelOfControl,
    hasCredentials: Boolean(credentials), remembered: Boolean(local.savedCredentials),
    authStatus: session.authStatus, connectionCheck: session.connectionCheck };
}
let badgeUpdates = Promise.resolve();
function updateBadge() {
  // Serialize updates so an older settings read cannot overwrite a newer badge.
  badgeUpdates = badgeUpdates.catch(() => {}).then(async () => {
    const current = await snapshot();
    const failed = current.active && current.connectionCheck?.outcome === 'failed';
    await chrome.action.setBadgeBackgroundColor({ color: failed ? '#b66a00' : current.color });
    await chrome.action.setBadgeText({ text: failed ? '!' : current.badge });
    await chrome.action.setTitle({ title: failed ? 'Proxy enabled; last connection check failed' : current.label });
  });
  return badgeUpdates;
}
let configurationRevision = 0;
async function invalidateCheck() {
  configurationRevision++;
  await chrome.storage.session.remove('connectionCheck');
}
let checking;
function checkConnection() {
  if (checking) return checking;
  checking = performCheck().finally(() => { checking = undefined; });
  return checking;
}
async function performCheck() {
  const before = await snapshot();
  if (!before.active || !before.hasCredentials) throw new Error('Enable your configured proxy with credentials before checking.');
  const revision = configurationRevision;
  const endpoint = JSON.stringify(before.settings);
  let outcome = 'verified';
  let message = 'HTTPS request succeeded through the configured Chrome connection.';
  try {
    const response = await fetch('https://example.com/', {
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('HTTP response was unsuccessful');
    await response.body?.cancel();
  } catch {
    outcome = 'failed';
    message = 'HTTPS check failed. Check proxy, authentication, network, or test-site availability.';
  }
  const after = await snapshot();
  if (revision !== configurationRevision || !after.active || JSON.stringify(after.settings) !== endpoint) {
    throw new Error('Proxy settings changed during the check. Run it again.');
  }
  const connectionCheck = { outcome, message, checkedAt: new Date().toISOString() };
  await chrome.storage.session.set({ connectionCheck });
  await updateBadge();
  return { ok: true, connectionCheck };
}
chrome.proxy.settings.onChange.addListener(() => {
  invalidateCheck().then(updateBadge).catch(() => {});
});
chrome.storage.onChanged.addListener((changes, area) => {
  const relevant = area === 'local' ? changes.settings || changes.savedCredentials
    : area === 'session' && (changes.credentials || changes.authStatus || changes.connectionCheck);
  if (relevant) updateBadge().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { updateBadge().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { updateBadge().catch(() => {}); });
updateBadge().catch(() => {});
