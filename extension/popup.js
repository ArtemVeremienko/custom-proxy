const form = document.querySelector('form');
const status = document.querySelector('#status');
const setup = document.querySelector('#setup');
const connected = document.querySelector('#connected');
async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'status' });
  if (result.error) throw new Error(result.error);
  for (const [key, value] of Object.entries(result.settings ?? {})) form.elements[key].value = value;
  const showControls = result.owned || result.active || result.hasCredentials;
  setup.hidden = showControls;
  connected.hidden = !showControls;
  document.querySelector('#connect-saved').hidden = result.active || !result.hasCredentials;
  document.querySelector('#disconnect').hidden = !(result.owned ?? result.active);
  document.querySelector('#check').hidden = !result.active || !result.hasCredentials;
  document.querySelector('#endpoint').textContent = result.settings
    ? `${result.settings.host}:${result.settings.port}` : 'Proxy settings';
  status.textContent = result.active
    ? result.hasCredentials ? 'Proxy enabled for regular and permitted incognito windows.' : 'Proxy enabled, but session credentials expired. Reset credentials to enter them again.'
    : result.hasCredentials ? 'Disconnected. Your credentials are available for reconnecting.' : 'Enter your proxy settings to connect.';
  document.querySelector('#storage-note').textContent = result.remembered
    ? 'Credentials are remembered on this device until you reset them.'
    : 'Credentials last for this browser session only.';
  if (result.active && result.authStatus?.message) status.textContent = result.authStatus.message;
  if (result.label) status.textContent = `Proxy setting: ${result.label}`;
  const check = result.connectionCheck;
  document.querySelector('#connection-status').textContent = check
    ? `Connection: ${check.outcome} at ${new Date(check.checkedAt).toLocaleString()}. ${check.message}`
    : 'Connection: not checked.';
}
async function run(type, save = false) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach(button => button.disabled = true);
  try {
    const message = { type };
    if (save) {
      message.settings = Object.fromEntries(new FormData(form));
      message.remember = form.elements.remember.checked;
      delete message.settings.remember;
    }
    if (type === 'check') document.querySelector('#connection-status').textContent = 'Connection: checking…';
    const result = await chrome.runtime.sendMessage(message);
    if (result.error) throw new Error(result.error);
    form.elements.password.value = '';
    if (type === 'reset') form.reset();
    await refresh();
  } catch (error) {
    status.textContent = error.message;
    if (type === 'check') document.querySelector('#connection-status').textContent = 'Connection: check not completed.';
  }
  finally { buttons.forEach(button => button.disabled = false); }
}
form.addEventListener('submit', event => { event.preventDefault(); run('connect', true); });
document.querySelector('#connect-saved').addEventListener('click', () => run('connect'));
document.querySelector('#disconnect').addEventListener('click', () => run('disconnect'));
document.querySelector('#check').addEventListener('click', () => run('check'));
document.querySelector('#reset').addEventListener('click', () => {
  if (confirm('Disconnect and delete saved proxy settings and credentials?')) return run('reset');
});
refresh().catch(error => status.textContent = error.message);
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' && (changes.authStatus || changes.credentials || changes.connectionCheck)) ||
      (area === 'local' && (changes.settings || changes.savedCredentials))) refresh().catch(error => status.textContent = error.message);
});
chrome.proxy.settings.onChange.addListener(() => refresh().catch(error => status.textContent = error.message));
