// Configuration state is separate from network reachability.
export function proxyState(proxy, settings, hasCredentials, authStatus) {
  const owned = proxy.levelOfControl === 'controlled_by_this_extension';
  const endpoint = proxy.value?.rules?.singleProxy;
  const matches = owned && proxy.value?.mode === 'fixed_servers' &&
    endpoint?.scheme === 'https' && endpoint.host === settings?.host && endpoint.port === settings?.port;
  if (['controlled_by_other_extensions', 'not_controllable'].includes(proxy.levelOfControl)) {
    return { active: false, owned, state: 'external', badge: '!', color: '#b66a00', label: 'Controlled elsewhere (extension or policy)' };
  }
  if (owned && !matches) return { active: false, owned, state: 'mismatch', badge: '!', color: '#b66a00', label: 'Proxy configuration does not match saved endpoint' };
  if (matches && (!hasCredentials || authStatus?.message)) {
    return { active: true, owned, state: 'warning', badge: '!', color: '#b66a00', label: authStatus?.message ?? 'Proxy enabled; credentials missing' };
  }
  if (matches) return { active: true, owned, state: 'on', badge: 'ON', color: '#18723b', label: 'Proxy enabled (reachability checked separately)' };
  return { active: false, owned, state: 'off', badge: 'OFF', color: '#64748b', label: 'This extension’s proxy is disabled' };
}
