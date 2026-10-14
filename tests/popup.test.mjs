import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('popup keeps saved controls after disconnect and restores setup after reset', async () => {
  let active = true;
  let hasCredentials = true;
  const handlers = {};
  const form = {
    elements: { host: {}, port: {}, username: {}, password: { value: '' } },
    reset: () => {},
    addEventListener: (event, callback) => { handlers[event] = callback; }
  };
  const elements = {
    form, '#status': {}, '#setup': {}, '#connected': {}, '#endpoint': {},
    '#storage-note': {},
    '#connect-saved': { addEventListener: (_, callback) => { handlers.connect = callback; } },
    '#reset': { addEventListener: (_, callback) => { handlers.reset = callback; } },
    '#disconnect': { addEventListener: (_, callback) => { handlers.disconnect = callback; } }
  };
  const context = vm.createContext({
    document: { querySelector: key => elements[key], querySelectorAll: () => [] },
    confirm: () => true,
    FormData: class { *[Symbol.iterator]() {} },
    chrome: {
      storage: { onChanged: { addListener() {} } },
      runtime: { sendMessage: async ({ type }) => {
        if (type === 'disconnect') { active = false; return { ok: true }; }
        if (type === 'connect') { active = true; return { ok: true }; }
        if (type === 'reset') { active = false; hasCredentials = false; return { ok: true }; }
        return { active, hasCredentials, remembered: true, control: 'controllable_by_this_extension',
          settings: { host: 'proxy.example.com', port: 3129, username: 'user' } };
      } }
    }
  });
  vm.runInContext(await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['#setup'].hidden, true);
  assert.equal(elements['#connected'].hidden, false);
  assert.equal(elements['#endpoint'].textContent, 'proxy.example.com:3129');
  await handlers.disconnect();
  assert.equal(elements['#setup'].hidden, true);
  assert.equal(elements['#connected'].hidden, false);
  assert.equal(elements['#connect-saved'].hidden, false);
  assert.equal(elements['#disconnect'].hidden, true);
  await handlers.connect();
  assert.equal(elements['#disconnect'].hidden, false);
  assert.equal(elements['#connect-saved'].hidden, true);
  await handlers.reset();
  assert.equal(elements['#setup'].hidden, false);
  assert.equal(elements['#connected'].hidden, true);
});
