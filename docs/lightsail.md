# Lightsail HTTPS proxy and Chrome setup

This recipe uses **Ubuntu 24.04 LTS**, **Squid with OpenSSL**, a trusted Let's Encrypt certificate, and username/password authentication. Chrome talks TLS to Squid on port **3129**. HTTPS websites use CONNECT tunnels; Squid does not decrypt website TLS. You need an AWS account, a domain/subdomain you control, and your client network's public IP address. AWS instance and transfer charges apply.

## 1. Create the instance and DNS

In Lightsail, create a Linux/Unix **OS-only Ubuntu 24.04 LTS** instance in your preferred region. A small plan is sufficient for initial personal use; watch CPU, memory, and transfer usage. Attach a **static IPv4 address**, so reconnecting/restarting the instance does not change your proxy address. Create a DNS **A record** such as `proxy.example.com` pointing to it. Wait until DNS resolves correctly.

Do not create an AAAA record unless you also configure IPv6 routing and firewall access. The configuration below intentionally listens on IPv4 only.

In the instance's **Networking → IPv4 firewall**, configure:

| Port / protocol | Source | Purpose |
| --- | --- | --- |
| TCP 22 | Your admin public IPv4 `/32` | SSH administration; preserve the browser SSH rule if you use Lightsail's SSH console |
| TCP 80 | All IPv4 addresses | Let's Encrypt HTTP-01 certificate issuance and renewal |
| TCP 3129 | Your client public IPv4 `/32`, or trusted client CIDRs | Encrypted authenticated proxy |

Remove other unused default rules. **Do not open 3128, UDP 3129, or TCP 443** for this recipe. The instance needs outbound DNS and HTTP/HTTPS access to resolve names, retrieve packages/certificates, and reach websites. Lightsail's instance firewall controls inbound traffic. If you use an additional host firewall, allow the same inbound rules there before continuing. Check it with `sudo ufw status`. Keep SSH access while changing rules.

If your home public IP changes, update the 3129 rule. Avoid opening it to everyone: authentication is still required, but a source allowlist reduces scanning and password attacks. Users on different networks need separate allowed CIDRs.

## 2. Install software and get a certificate

SSH to the instance as `ubuntu`. Replace the example hostname/email below. Use a hostname, not the static IP, in Chrome so certificate hostname verification succeeds.

```bash
sudo apt-get update
sudo apt-get install -y squid-openssl apache2-utils certbot
sudo systemctl stop squid

sudo certbot certonly --standalone --non-interactive --agree-tos \
  --email you@example.com -d proxy.example.com
```

Port 80 must be reachable from the Internet and unused locally for standalone validation. If issuance fails, check the A record, stale AAAA records, both firewalls, and `sudo ss -lntp`. Do not bypass certificate verification.

Copy the certificate into a directory the Squid `proxy` account can read. Keep the private key restricted:

```bash
sudo install -d -o root -g proxy -m 0750 /etc/squid/tls
sudo install -o root -g proxy -m 0644 \
  /etc/letsencrypt/live/proxy.example.com/fullchain.pem /etc/squid/tls/fullchain.pem
sudo install -o root -g proxy -m 0640 \
  /etc/letsencrypt/live/proxy.example.com/privkey.pem /etc/squid/tls/privkey.pem
```

## 3. Add a proxy user

```bash
sudo htpasswd -c /etc/squid/passwords proxyuser
sudo chown root:proxy /etc/squid/passwords
sudo chmod 0640 /etc/squid/passwords
```

Enter a long, unique password at the prompt; do not put it in a shell command or repository. For additional users or password changes, run `sudo htpasswd /etc/squid/passwords username` **without `-c`**; `-c` replaces the password file.

## 4. Configure Squid

On this fresh instance, back up the package's configuration once, then replace `/etc/squid/squid.conf`:

```bash
sudo cp -n /etc/squid/squid.conf /etc/squid/squid.conf.original
sudo tee /etc/squid/squid.conf >/dev/null <<'SQUID'
# TLS between the browser and the proxy; no SSL bump / interception.
https_port 0.0.0.0:3129 tls-cert=/etc/squid/tls/fullchain.pem tls-key=/etc/squid/tls/privkey.pem

auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwords
auth_param basic realm Private Lightsail Proxy
acl authenticated proxy_auth REQUIRED
acl SSL_ports port 443
acl Safe_ports port 80 443
acl CONNECT method CONNECT

# Do not let proxy users reach private networks or instance metadata.
acl private_dst dst 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8
acl private_dst dst 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16
acl private_dst dst 224.0.0.0/4 240.0.0.0/4
acl private_dst dst ::/128 ::1/128 fc00::/7 fe80::/10 ff00::/8

http_access deny manager
http_access deny !Safe_ports
http_access deny CONNECT !SSL_ports
http_access deny private_dst
http_access allow authenticated
http_access deny all

cache deny all
access_log stdio:/var/log/squid/access.log
cache_log /var/log/squid/cache.log
SQUID

sudo squid -k parse
sudo systemctl enable squid
sudo systemctl restart squid
sudo systemctl --no-pager --full status squid
sudo ss -lntp | grep ':3129'
```

There is no unencrypted `http_port`, and unauthenticated access is denied. Only public websites on ports 80/443 are permitted. If the package rejects TLS options, check `squid -v`: install `squid-openssl`, not the non-OpenSSL variant. Read `sudo journalctl -u squid -n 80 --no-pager` and `/var/log/squid/cache.log` for startup failures. Do not remove authentication or TLS to make a failure disappear.

Squid access logs contain browsing metadata. Restrict access to them and review `/etc/logrotate.d/squid` and retention for your needs. Destination sites see the Lightsail egress address. Your Lightsail operator can observe HTTP traffic and HTTPS destination names; HTTPS website content remains encrypted end to end.

## 5. Make renewal automatic

Install a deploy hook, replacing `proxy.example.com` in its path check:

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/squid-tls >/dev/null <<'HOOK'
#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/proxy.example.com ] || exit 0
install -o root -g proxy -m 0644 "$RENEWED_LINEAGE/fullchain.pem" /etc/squid/tls/fullchain.pem
install -o root -g proxy -m 0640 "$RENEWED_LINEAGE/privkey.pem" /etc/squid/tls/privkey.pem
/usr/sbin/squid -k parse
systemctl restart squid
HOOK
sudo chmod 0750 /etc/letsencrypt/renewal-hooks/deploy/squid-tls
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
```

Keep port 80 open for renewal. The certificate challenge server runs only during issuance/renewal. To test the hook against your real current certificate (without copying a staging certificate), run:

```bash
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/proxy.example.com \
  /etc/letsencrypt/renewal-hooks/deploy/squid-tls
```

The hook restarts Squid and can briefly interrupt active connections.

## 6. Verify from your client network

Use curl with HTTPS-proxy support from a machine allowed by the 3129 firewall rule:

```bash
# No credentials: expect a 407 Proxy Authentication Required response.
curl --verbose --proxy https://proxy.example.com:3129 https://example.com/

# Prompts for your password; expect example.com's page after CONNECT succeeds.
curl --proxy https://proxy.example.com:3129 --proxy-user proxyuser https://example.com/

# Confirm the public egress IP matches your Lightsail address.
curl --proxy https://proxy.example.com:3129 --proxy-user proxyuser https://api.ipify.org
```

Do not use `--proxy-insecure` or `-k`. An invalid password must fail with 407; requests to private destinations and nonallowed ports must be denied. Verbose curl output with authentication can include credentials; don't share authenticated traces without redaction. If a request times out, check source IP allowlists and `ss`; if TLS fails, check hostname, certificate chain, expiry, and client time.

## 7. Load the Chrome extension

1. Download/clone this repository on your desktop. Open `chrome://extensions`.
2. Enable **Developer mode**, choose **Load unpacked**, and select `extension/`.
   In the extension's **Details**, enable **Allow in Incognito** to use the shared connection in incognito windows. If upgrading an existing unpacked installation, click its reload button first.
3. Pin/open **Lightsail Private Proxy**. Enter `proxy.example.com`, `3129`, and your proxy username/password.
4. Click **Connect**, then open `https://api.ipify.org` in a new tab. The returned IP should be Lightsail's address. Also open an ordinary HTTPS website.
5. Click **Disconnect** and reload the IP page; your normal egress address should return. If your normal network already uses the same egress, compare Squid's access log instead.

For incognito, also open `https://api.ipify.org` in an incognito window while connected. Both regular and incognito windows should show the Lightsail IP. Disconnect from either window and verify both return to their underlying connection. The extension uses Chrome's spanning mode: one background worker, one set of session credentials, and regular proxy settings inherited by incognito. There is no separate incognito connection. Incognito does not hide activity from the proxy operator.

Connect reports that Chrome settings were applied, not that the server is reachable. A bad password must fail browsing; correct it and reconnect. Test reconnect after a full Chrome restart. Credentials are kept only in Chrome session storage; the host, port, and username are saved locally. Chrome itself may cache authentication until connections/browser sessions end. Disconnect before removing the extension.

While the proxy is enabled, the popup shows its endpoint, status, and **Disconnect** instead of the connection form. To change credentials, disconnect and reconnect. If Chrome shows its own proxy login dialog, check that **Allow in Incognito** is enabled for incognito requests and that you reconnected after restarting Chrome. The popup reports observed endpoint mismatches, missing session credentials, and repeated authentication challenges. It cannot diagnose authentication requests that Chrome does not expose to the extension, including some browser-internal traffic. A website's own login prompt is separate and must not receive your proxy credentials.

The extension needs proxy control, session/local storage, and authentication events across URLs to answer proxy challenges. It supplies credentials only for proxy challenges matching your configured hostname and port, never for website login challenges. It does not collect or transmit browsing history to a separate service. Chrome policy or another proxy extension may prevent control. Enable **Allow in Incognito** before using the extension in incognito; otherwise its authentication handler cannot service incognito requests even if Chrome inherits proxy settings.

This is a browser forward proxy, not a system VPN or a guarantee against IP leaks. Chrome bypasses loopback addresses, and WebRTC and other non-proxy traffic can follow different network paths. Do not use it as an anonymity tool. Keep Ubuntu, Squid, Chrome, and the extension updated.

## References

- [Lightsail firewall rules](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-firewall-and-port-mappings-in-amazon-lightsail.html)
- [Lightsail static IPs](https://docs.aws.amazon.com/lightsail/latest/userguide/lightsail-create-static-ip.html)
- [Squid HTTPS listener](https://www.squid-cache.org/Doc/config/https_port/)
- [Chrome proxy API](https://developer.chrome.com/docs/extensions/reference/api/proxy)
- [Chrome webRequest authentication](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
- [Certbot renewal](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates)
