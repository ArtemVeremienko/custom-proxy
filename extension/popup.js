const form = document.querySelector('form');
const status = document.querySelector('#status');
async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'status' });
  if (result.error) throw new Error(result.error);
  for (const [key, value] of Object.entries(result.settings ?? {})) form.elements[key].value = value;
  status.textContent = result.active
    ? result.hasCredentials ? 'Proxy settings applied. Open a website to verify connectivity.' : 'Proxy settings remain active. Enter your password and reconnect.'
    : `Proxy inactive. Control: ${result.control}.`;
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
