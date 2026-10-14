const form = document.querySelector('form');
const status = document.querySelector('#status');
const setup = document.querySelector('#setup');
const connected = document.querySelector('#connected');
async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'status' });
  if (result.error) throw new Error(result.error);
  for (const [key, value] of Object.entries(result.settings ?? {})) form.elements[key].value = value;
  setup.hidden = result.active;
  connected.hidden = !result.active;
  document.querySelector('#endpoint').textContent = result.settings
    ? `${result.settings.host}:${result.settings.port}` : 'Proxy enabled';
  status.textContent = result.active
    ? result.hasCredentials ? 'Proxy enabled for regular and permitted incognito windows.' : 'Proxy enabled, but this session has no password. Disconnect, then reconnect.'
    : `Proxy inactive. Control: ${result.control}.`;
  if (result.active && result.authStatus?.message) status.textContent = result.authStatus.message;
}
async function run(type) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach(button => button.disabled = true);
  try {
    const settings = Object.fromEntries(new FormData(form));
    const result = await chrome.runtime.sendMessage({ type, settings });
    if (result.error) throw new Error(result.error);
    form.elements.password.value = '';
    await refresh();
  } catch (error) { status.textContent = error.message; }
  finally { buttons.forEach(button => button.disabled = false); }
}
form.addEventListener('submit', event => { event.preventDefault(); run('connect'); });
document.querySelector('#disconnect').addEventListener('click', () => run('disconnect'));
refresh().catch(error => status.textContent = error.message);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.authStatus) refresh().catch(error => status.textContent = error.message);
});
