import { validate, proxyConfig, matchesProxy } from './config.js';

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
  if (message.type === 'status') {
    const [proxy, local, credentials, session] = await Promise.all([
      chrome.proxy.settings.get({ incognito: false }),
      chrome.storage.local.get(['settings', 'savedCredentials']),
      storedCredentials(),
      chrome.storage.session.get('authStatus')
    ]);
    // Return metadata only; passwords never travel back to the popup.
    return { settings: local.settings, authStatus: session.authStatus, control: proxy.levelOfControl,
      active: proxy.levelOfControl === 'controlled_by_this_extension',
      hasCredentials: Boolean(credentials), remembered: Boolean(local.savedCredentials) };
  }
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
    return { ok: true };
  }
  throw new Error('Unknown operation.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message).then(respond).catch(error => respond({ error: error.message }));
  return true;
});
