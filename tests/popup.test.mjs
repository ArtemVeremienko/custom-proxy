import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('popup keeps saved controls after disconnect and restores setup after reset', async () => {
  let active = true;
  let hasCredentials = true;
  let state = 'on';
  let label = 'Proxy enabled (reachability checked separately)';
  let connectionCheck;
  let resolveCheck;
  const handlers = {};
  const form = {
    elements: { host: {}, port: {}, username: {}, password: { value: '' }, remember: { checked: false } },
    reset: () => {},
    addEventListener: (event, callback) => { handlers[event] = callback; }
  };
  const elements = {
    form, '#status': {}, '#setup': {}, '#connected': {}, '#endpoint': {},
    '#storage-note': {}, '#connection-status': {},
    '#check': { addEventListener: (_, callback) => { handlers.check = callback; } },
    '#connect-saved': { addEventListener: (_, callback) => { handlers.connect = callback; } },
    '#reset': { addEventListener: (_, callback) => { handlers.reset = callback; } },
    '#reset-confirm': { addEventListener: (_, callback) => { handlers.resetConfirm = callback; } },
    '#reset-cancel': { addEventListener: (_, callback) => { handlers.resetCancel = callback; } },
    '#disconnect': { addEventListener: (_, callback) => { handlers.disconnect = callback; } }
  };
  const context = vm.createContext({
    document: { querySelector: key => elements[key], querySelectorAll: () => [] },
    FormData: class { *[Symbol.iterator]() {} },
    chrome: {
      proxy: { settings: { onChange: { addListener() {} } } },
      storage: { onChanged: { addListener: cb => { handlers.storageChanged = cb; } } },
      runtime: { sendMessage: async ({ type }) => {
        if (type === 'disconnect') { active = false; connectionCheck = undefined; state = 'off'; label = 'This extension’s proxy is disabled'; return { ok: true }; }
        if (type === 'connect') { active = true; state = 'on'; label = 'Proxy enabled (reachability checked separately)'; return { ok: true }; }
        if (type === 'reset') { active = false; hasCredentials = false; connectionCheck = undefined; state = 'off'; label = 'This extension’s proxy is disabled'; return { ok: true }; }
        if (type === 'check') return new Promise(resolve => {
          resolveCheck = res => { connectionCheck = res.connectionCheck; resolve(res); };
        });
        return { active, hasCredentials, remembered: true, state, label, connectionCheck, control: 'controllable_by_this_extension',
          settings: { host: 'proxy.example.com', port: 3129, username: 'user' } };
      } }
    }
  });
  vm.runInContext(await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['#setup'].hidden, true);
  assert.equal(elements['#connected'].hidden, false);
  assert.equal(elements['#endpoint'].textContent, 'proxy.example.com:3129');
  assert.match(elements['#status'].textContent, /Proxy enabled for regular/);

  const checkPromise = handlers.check();
  assert.equal(elements['#connection-status'].textContent, 'Connection: checking…');
  await handlers.storageChanged({ connectionCheck: {} }, 'session');
  assert.equal(elements['#connection-status'].textContent, 'Connection: checking…');
  resolveCheck({ ok: true, connectionCheck: { outcome: 'verified', checkedAt: '2026-11-15T00:00:00.000Z', message: 'OK' } });
  await checkPromise;
  assert.match(elements['#connection-status'].textContent, /Connection: verified/);

  await handlers.disconnect();
  assert.equal(elements['#setup'].hidden, true);
  assert.equal(elements['#connected'].hidden, false);
  assert.equal(elements['#connect-saved'].hidden, false);
  assert.equal(elements['#disconnect'].hidden, true);
  assert.match(elements['#status'].textContent, /Disconnected\. Your credentials/);

  await handlers.connect();
  assert.equal(elements['#disconnect'].hidden, false);
  assert.equal(elements['#connect-saved'].hidden, true);

  handlers.reset();
  assert.equal(elements['#reset'].hidden, true);
  assert.equal(elements['#reset-confirm'].hidden, false);
  assert.equal(elements['#reset-cancel'].hidden, false);
  handlers.resetCancel();
  assert.equal(elements['#reset'].hidden, false);
  assert.equal(elements['#reset-confirm'].hidden, true);
  handlers.reset();
  await handlers.resetConfirm();
  assert.equal(elements['#setup'].hidden, false);
  assert.equal(elements['#connected'].hidden, true);
  assert.match(elements['#status'].textContent, /Enter your proxy settings/);
});
