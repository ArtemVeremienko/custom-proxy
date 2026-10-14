# Custom proxy

Run a private, authenticated HTTPS proxy on AWS Lightsail and connect with Chrome.

1. Follow [the Lightsail setup guide](docs/lightsail.md).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension` folder.
3. Open the extension and enter your proxy's hostname, port `3129`, username, and password. Click **Connect**, then open a website to verify connectivity.

No build or npm installation is required. Run `node --test tests/*.test.mjs` for the configuration tests.

Passwords are stored only in Chrome session storage. Reconnect after restarting Chrome: proxy settings may remain active without credentials. Disconnect restores Chrome's underlying proxy configuration. This controls the regular Chrome profile only, not other applications or incognito. Chrome bypasses loopback addresses, and WebRTC can use other network paths. This is not a VPN or an anonymity tool.
