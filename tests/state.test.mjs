import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyState } from '../extension/state.js';
const settings = { host: 'proxy.example.com', port: 3129 };
const proxy = { levelOfControl: 'controlled_by_this_extension', value: {
  mode: 'fixed_servers', rules: { singleProxy: { scheme: 'https', ...settings } }
} };
test('ON requires ownership, HTTPS fixed proxy, saved endpoint, and credentials', () => {
  assert.equal(proxyState(proxy, settings, true).badge, 'ON');
  for (const value of [
    { mode: 'direct' },
    { mode: 'pac_script' },
    { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'http', ...settings } } },
    { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'https', ...settings, port: 443 } } }
  ]) {
    const state = proxyState({ ...proxy, value }, settings, true);
    assert.equal(state.badge, '!');
    assert.equal(state.active, false);
    assert.equal(state.owned, true);
  }
  assert.equal(proxyState(proxy, settings, false).badge, '!');
  assert.equal(proxyState(proxy, settings, true, { message: 'Rejected' }).badge, '!');
});
test('external policy or extension is a warning, never misleading OFF', () => {
  for (const levelOfControl of ['not_controllable', 'controlled_by_other_extensions']) {
    const state = proxyState({ ...proxy, levelOfControl }, settings, true);
    assert.equal(state.state, 'external');
    assert.equal(state.badge, '!');
    assert.equal(state.active, false);
  }
  assert.equal(proxyState({ levelOfControl: 'controllable_by_this_extension' }, settings, true).badge, 'OFF');
});
