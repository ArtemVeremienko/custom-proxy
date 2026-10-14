import test from 'node:test';
import assert from 'node:assert/strict';

test('background connection, authentication boundaries, retries, rollback and disconnect', async () => {
  const listeners = {};
  const event = name => ({ addListener: listener => { listeners[name] = listener; } });
  const local = {};
  const session = {};
  const storage = data => ({
    get: async key => structuredClone({ [key]: data[key] }),
    set: async values => Object.assign(data, structuredClone(values)),
    remove: async key => { delete data[key]; }
  });
  let control = 'controllable_by_this_extension';
  let value;
  let failSet = false;
  globalThis.chrome = {
    storage: { local: storage(local), session: storage(session) },
    proxy: { settings: {
      get: async () => ({ levelOfControl: control, value }),
      set: async input => {
        if (failSet) throw new Error('Proxy update failed');
        value = input.value;
        control = 'controlled_by_this_extension';
      },
      clear: async () => { value = undefined; control = 'controllable_by_this_extension'; }
    } },
    runtime: { id: 'test-extension', onMessage: event('message') },
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
    assert.equal('password' in local.settings, false);
    assert.equal(session.credentials.password, settings.password);
    assert.deepEqual(await auth({ ...challenge, isProxy: false }), {});
    assert.deepEqual(await auth({ ...challenge, challenger: { host: 'attacker.example', port: 3129 } }), {});
    assert.deepEqual(await auth(challenge), { authCredentials: { username: settings.username, password: settings.password } });
    assert.deepEqual(await auth(challenge), { cancel: true });
    listeners.completed({ requestId: '1' });
    assert.ok((await auth(challenge)).authCredentials);
    listeners.error({ requestId: '1' });
    assert.ok((await auth(challenge)).authCredentials);

    failSet = true;
    assert.match((await message({ type: 'connect', settings: { ...settings, password: 'replacement' } })).error, /Proxy update failed/);
    assert.equal(session.credentials.password, settings.password);
    failSet = false;
    control = 'not_controllable';
    assert.match((await message({ type: 'connect', settings })).error, /controlled by policy/);
    assert.deepEqual(await message({ type: 'disconnect' }), { ok: true });
    assert.equal(session.credentials, undefined);
    assert.equal(value, undefined);
    assert.deepEqual(await auth(challenge), {});
    const status = await message({ type: 'status' });
    assert.equal(status.active, false);
    assert.equal(status.hasCredentials, false);
    assert.equal(listeners.message({}, { id: 'other-extension' }, () => assert.fail('Foreign sender accepted')), false);
  } finally {
    delete globalThis.chrome;
  }
});
