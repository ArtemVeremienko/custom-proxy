# Custom proxy

Run a private, authenticated HTTPS proxy on AWS Lightsail and connect with Chrome.

1. Follow [the Lightsail setup guide](docs/lightsail.md).
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the `extension` folder.
3. To use the same connection in incognito, open the extension's **Details** and enable **Allow in Incognito**.
4. Open the extension and enter your proxy's hostname, port `3129`, username, and password. Choose **Remember credentials on this device** if desired, click **Save & Connect**, then open a website to verify connectivity in regular and incognito windows.

No build or npm installation is required. Run `node --test tests/*.test.mjs` for the configuration tests.

With **Remember credentials on this device** enabled, credentials are stored in `chrome.storage.local` and survive browser restarts. Otherwise, passwords stay in `chrome.storage.session` for the current browser session. After setup, use **Connect** / **Disconnect** without reentering credentials; Disconnect retains them, and **Reset credentials** disconnects and deletes extension-stored settings and credentials. Session-only users must enter credentials again after a browser restart. Regular and incognito windows share the same proxy and credentials when **Allow in Incognito** is enabled. Connecting or disconnecting from either window affects both. Disconnect restores Chrome's underlying proxy configuration. This controls Chrome, not other applications. Chrome bypasses loopback addresses, and WebRTC can use other network paths. This is not a VPN or an anonymity tool. Incognito does not hide activity from the proxy operator.

Remembered passwords are not encrypted by the extension or stored in a secure password vault. Local storage is restricted to trusted extension contexts, is not synced, and passwords are never returned in popup status messages. Someone with access to your browser profile can recover them. Use a unique proxy password; avoid remembering credentials on shared devices. Reset does not erase Chrome's separate authentication cache or existing profile backups.
