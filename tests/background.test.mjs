import test from 'node:test';
import assert from 'node:assert/strict';

test('background connection, authentication boundaries, retries, rollback and disconnect', async () => {
  const listeners = {};
  const event = name => ({ addListener: listener => { listeners[name] = listener; } });
  const local = {};
  const session = {};
  const storage = data => ({
    get: async keys => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[key]]))),
    set: async values => Object.assign(data, structuredClone(values)),
    remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    setAccessLevel: async options => assert.equal(options.accessLevel, 'TRUSTED_CONTEXTS')
  });
  let control = 'controllable_by_this_extension';
  let value;
  let failSet = false;
  let badge;
  const originalFetch = globalThis.fetch;
  let request;
  let failFetch = false;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    if (failFetch) throw new Error('offline');
    return { ok: true, body: { cancel: async () => {} } };
  };
  globalThis.chrome = {
    storage: { local: storage(local), session: storage(session), onChanged: event('storageChanged') },
    action: { setBadgeText: async ({ text }) => { badge = text; }, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    proxy: { settings: {
      onChange: event('proxyChanged'),
      get: async () => ({ levelOfControl: control, value }),
      set: async input => {
        assert.equal(input.scope, 'regular', 'Incognito must inherit the shared regular connection');
        if (failSet) throw new Error('Proxy update failed');
        value = input.value;
        control = 'controlled_by_this_extension';
      },
      clear: async input => {
        assert.equal(input.scope, 'regular', 'Disconnect must clear the shared connection');
        value = undefined; control = 'controllable_by_this_extension';
      }
    } },
    runtime: { onStartup: event('startup'), onInstalled: event('installed'), id: 'test-extension', onMessage: event('message') },
    webRequest: { onAuthRequired: event('auth'), onCompleted: event('completed'), onErrorOccurred: event('error') }
  };
  try {
    await import('../extension/background.js');
    const message = payload => new Promise(resolve => listeners.message(payload, { id: 'test-extension' }, resolve));
    const auth = details => new Promise(resolve => listeners.auth(details, resolve));
    const settings = { host: 'proxy.example.com', port: 3129, username: 'test-user', password: 'test-password' };
    const challenge = { requestId: '1', isProxy: true, challenger: { host: settings.host, port: settings.port } };
    assert.deepEqual(await message({ type: 'connect', settings }), { ok: true });
    assert.equal(value.rules.singleProxy.scheme, 'https');
    assert.equal(badge, 'ON');
    const verified = await message({ type: 'check' });
    assert.equal(verified.connectionCheck.outcome, 'verified');
    assert.ok(Date.parse(verified.connectionCheck.checkedAt));
    assert.equal(request.url, 'https://example.com/');
    assert.equal(request.options.credentials, 'omit');
    failFetch = true;
    assert.equal((await message({ type: 'check' })).connectionCheck.outcome, 'failed');
    assert.equal(badge, '!');
    failFetch = false;
    await message({ type: 'check' });
    assert.equal('password' in local.settings, false);
    assert.equal(session.credentials.password, settings.password);
    assert.deepEqual(await auth({ ...challenge, isProxy: false }), {});
    assert.deepEqual(await auth({ ...challenge, challenger: { host: 'attacker.example', port: 3129 } }), {});
    assert.deepEqual(await auth(challenge), { authCredentials: { username: settings.username, password: settings.password } });
    assert.deepEqual(await auth({ ...challenge, requestId: 'incognito-1', incognito: true }), {
      authCredentials: { username: settings.username, password: settings.password }
    });
    assert.deepEqual(await auth(challenge), { cancel: true });
    assert.match((await message({ type: 'status' })).authStatus.message, /rejected the saved credentials/);
    listeners.completed({ requestId: '1' });
    assert.ok((await auth(challenge)).authCredentials);
    listeners.error({ requestId: '1' });
    assert.ok((await auth(challenge)).authCredentials);

    failSet = true;
    assert.match((await message({ type: 'connect', settings: { ...settings, password: 'replacement' } })).error, /Proxy update failed/);
    assert.equal(session.credentials.password, settings.password);
    failSet = false;
    delete session.credentials;
    assert.deepEqual(await auth({ ...challenge, requestId: 'after-restart' }), { cancel: true });
    assert.match((await message({ type: 'status' })).authStatus.message, /expired/);
    control = 'not_controllable';
    assert.match((await message({ type: 'connect', settings })).error, /controlled by policy/);
    assert.deepEqual(await message({ type: 'disconnect' }), { ok: true });
    assert.equal(session.credentials, undefined);
    assert.equal(value, undefined);
    assert.deepEqual(await auth(challenge), {});
    const status = await message({ type: 'status' });
    assert.equal(status.active, false);
    assert.equal(badge, 'OFF');
    assert.equal(status.connectionCheck, undefined);
    assert.match((await message({ type: 'check' })).error, /Enable your configured proxy/);
    assert.equal(status.hasCredentials, false);

    // Opt-in persistence survives a simulated browser restart and reconnects
    // without returning the password to the popup.
    assert.deepEqual(await message({ type: 'connect', settings, remember: true }), { ok: true });
    assert.equal(local.savedCredentials.password, settings.password);
    delete session.credentials;
    const restarted = await message({ type: 'status' });
    assert.equal(restarted.hasCredentials, true);
    assert.equal(restarted.remembered, true);
    assert.equal(JSON.stringify(restarted).includes(settings.password), false);
    assert.ok((await auth({ ...challenge, requestId: 'remembered-after-restart' })).authCredentials);
    await message({ type: 'disconnect' });
    assert.equal(local.savedCredentials.password, settings.password);
    assert.deepEqual(await auth({ ...challenge, requestId: 'disconnected' }), {});
    assert.deepEqual(await message({ type: 'connect' }), { ok: true });
    assert.equal(session.credentials.password, settings.password);

    failSet = true;
    await message({ type: 'connect', settings: { ...settings, password: 'new-password' }, remember: false });
    assert.equal(local.savedCredentials.password, settings.password);
    assert.equal(session.credentials.password, settings.password);
    failSet = false;
    await message({ type: 'disconnect' });
    assert.equal(session.credentials.password, settings.password);
    assert.equal((await message({ type: 'status' })).hasCredentials, true);
    await message({ type: 'reset' });
    assert.equal(local.savedCredentials, undefined);
    assert.equal(local.settings, undefined);
    assert.equal(session.credentials, undefined);
    assert.match((await message({ type: 'connect' })).error, /credentials first/);

    // Without opt-in, disconnect retains credentials for this session only.
    await message({ type: 'connect', settings, remember: false });
    assert.equal(local.savedCredentials, undefined);
    await message({ type: 'disconnect' });
    assert.equal(session.credentials.password, settings.password);
    await message({ type: 'connect' });
    await message({ type: 'reset' });
    // External changes update the badge and discard old connection checks.
    await message({ type: 'connect', settings });
    await message({ type: 'check' });
    control = 'controlled_by_other_extensions';
    listeners.proxyChanged();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(badge, '!');
    assert.equal((await message({ type: 'status' })).connectionCheck, undefined);
    control = 'controlled_by_this_extension';
    listeners.proxyChanged();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(badge, 'ON');

    // Never report success if settings changed during the network request.
    globalThis.fetch = async () => {
      control = 'controlled_by_other_extensions';
      return { ok: true };
    };
    assert.match((await message({ type: 'check' })).error, /settings changed/);
    assert.equal((await message({ type: 'status' })).connectionCheck, undefined);
    await message({ type: 'reset' });
    assert.equal(listeners.message({}, { id: 'other-extension' }, () => assert.fail('Foreign sender accepted')), false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.chrome;
  }
});
