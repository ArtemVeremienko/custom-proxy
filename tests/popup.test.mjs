import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('popup hides the form while active and restores it after disconnect', async () => {
  let active = true;
  const handlers = {};
  const form = {
    elements: { host: {}, port: {}, username: {}, password: { value: '' } },
    addEventListener: (event, callback) => { handlers[event] = callback; }
  };
  const elements = {
    form, '#status': {}, '#setup': {}, '#connected': {}, '#endpoint': {},
    '#disconnect': { addEventListener: (_, callback) => { handlers.disconnect = callback; } }
  };
  const context = vm.createContext({
    document: { querySelector: key => elements[key], querySelectorAll: () => [] },
    FormData: class { *[Symbol.iterator]() {} },
    chrome: {
      storage: { onChanged: { addListener() {} } },
      runtime: { sendMessage: async ({ type }) => {
        if (type === 'disconnect') { active = false; return { ok: true }; }
        return { active, hasCredentials: true, control: 'controllable_by_this_extension',
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
  assert.equal(elements['#setup'].hidden, false);
  assert.equal(elements['#connected'].hidden, true);
});
