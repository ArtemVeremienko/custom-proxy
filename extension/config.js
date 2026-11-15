export function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('Proxy settings are required.');
  const host = String(input.host ?? '').trim().toLowerCase();
  const rawPort = input.port;
  const port = (typeof rawPort === 'number' || (typeof rawPort === 'string' && rawPort.trim() !== '')) ? Number(rawPort) : NaN;
  const username = String(input.username ?? '').trim();
  const password = String(input.password ?? '');
  if (!host || host.length > 253 || !host.split('.').every(part =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) {
    throw new Error('Enter a hostname or IPv4 address without a scheme, path, or port.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  if (!username || !password) throw new Error('Username and password are required.');
  return { host, port, username, password };
}
export function proxyConfig({ host, port }) {
  return { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'https', host, port } } };
}
export function matchesProxy(details, credentials) {
  return Boolean(credentials && details.isProxy &&
    details.challenger?.host?.toLowerCase() === credentials.host &&
    details.challenger?.port === credentials.port);
}
