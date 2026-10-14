import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validate, proxyConfig, matchesProxy } from '../extension/config.js';

const input = { host: ' Proxy.Example.COM ', port: '3129', username: ' user ', password: ' secret ' };
test('normalizes endpoint and username without changing password', () => {
  assert.deepEqual(validate(input), { host: 'proxy.example.com', port: 3129, username: 'user', password: ' secret ' });
});
test('rejects URL injection, malformed endpoints, invalid ports and missing credentials', () => {
  for (const host of ['', 'https://proxy.example.com', 'host/path', 'host:3129', '-host', 'host..com', 'host space', 'x'.repeat(64)]) {
    assert.throws(() => validate({ ...input, host }));
  }
  for (const port of ['', 'abc', 0, -1, 65536, 1.5]) assert.throws(() => validate({ ...input, port }));
  assert.throws(() => validate({ ...input, username: '' }));
  assert.throws(() => validate({ ...input, password: '' }));
});
test('uses TLS for all proxied URL schemes', () => {
  assert.deepEqual(proxyConfig(validate(input)), {
    mode: 'fixed_servers', rules: { singleProxy: { scheme: 'https', host: 'proxy.example.com', port: 3129 } }
  });
});
test('credentials match only configured proxy challenges', () => {
  const credentials = validate(input);
  const details = { isProxy: true, challenger: { host: 'PROXY.EXAMPLE.COM', port: 3129 } };
  assert.equal(matchesProxy(details, credentials), true);
  assert.equal(matchesProxy({ ...details, isProxy: false }, credentials), false);
  assert.equal(matchesProxy({ ...details, challenger: { host: 'evil.example', port: 3129 } }, credentials), false);
  assert.equal(matchesProxy({ ...details, challenger: { host: credentials.host, port: 443 } }, credentials), false);
  assert.equal(matchesProxy(details, undefined), false);
  assert.equal(matchesProxy({ isProxy: true }, credentials), false);
});
test('manifest declares MV3 auth provider and existing assets', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.permissions.includes('webRequestAuthProvider'));
  assert.ok(manifest.permissions.includes('proxy'));
  assert.equal(manifest.incognito, 'spanning');
  for (const file of [manifest.background.service_worker, manifest.action.default_popup]) {
    assert.ok((await readFile(new URL('../extension/' + file, import.meta.url))).length);
  }
});
