# Running Aphelion in the background

The default Aphelion process is foreground and explicit. That is the right mode for trying
the product, one-off work, and CI. A user-level operating-system service is useful for a
dedicated development workstation or long-lived local WordPress stack.

This setup is opt-in. Aphelion does not install, enable, or remove a service for you. A
background observer produces local trails whenever its target changes, and Aphelion never
deletes those trails automatically.

## Before enabling a service

1. Install the CLI and resolve its absolute path:

   ```sh
   npm install --global aphelion
   command -v aphelion
   ```

2. Run the exact command in a terminal first. Confirm the printed target, board URL, trail
   path, and WordPress connection state.
3. Use absolute paths in the service definition. Login services do not inherit the same
   `PATH`, working directory, or shell configuration as an interactive terminal.
4. Do not pass `--open`; a login service should not open a browser on every restart.

`--port` is preferred rather than exclusive: if it is occupied, Aphelion falls forward to
the next available loopback port. For a persistent hook setup, resolve the conflict or set
`APHELION_PORT` to the board port Aphelion printed. The health check below should use that
same port.

For a repository, the supervised command is simply:

```sh
/absolute/path/to/aphelion /absolute/path/to/project --port 5330
```

For WordPress, first prove the foreground command from the root README. The service must
receive the same `--site`, `--audit-log`, and optional `--wp-command` arguments as separate
arguments. The WP-CLI command remains one JSON string-array argument.

## macOS: LaunchAgent

Create `~/Library/LaunchAgents/com.aphelion.observer.plist` with the following template.
Replace every `/absolute/...` and `/Users/you/...` value with the output and paths verified
above.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.aphelion.observer</string>

  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/aphelion</string>
    <string>/absolute/path/to/project</string>
    <string>--port</string>
    <string>5330</string>
  </array>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
  </dict>

  <key>StandardOutPath</key>
  <string>/Users/you/.aphelion/service.stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/.aphelion/service.stderr.log</string>
</dict>
</plist>
```

Create the log directory, validate the file, and enable it:

```sh
mkdir -p ~/.aphelion
plutil -lint ~/Library/LaunchAgents/com.aphelion.observer.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.aphelion.observer.plist
```

After changing the plist, unload and bootstrap it again. To disable and remove it:

```sh
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.aphelion.observer.plist
rm ~/Library/LaunchAgents/com.aphelion.observer.plist
```

The `rm` command removes only the service definition. Existing trails remain in their normal
locations.

## Linux: systemd user service

Create `~/.config/systemd/user/aphelion.service`, again using absolute paths:

```ini
[Unit]
Description=Aphelion local agent observer
After=default.target

[Service]
Type=simple
ExecStart=/absolute/path/to/aphelion /absolute/path/to/project --port 5330
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

Load and enable it for the current user:

```sh
systemctl --user daemon-reload
systemctl --user enable --now aphelion.service
```

Inspect or remove it with:

```sh
systemctl --user status aphelion.service
journalctl --user -u aphelion.service
systemctl --user disable --now aphelion.service
rm ~/.config/systemd/user/aphelion.service
systemctl --user daemon-reload
```

## Agent hooks and one daemon

Start one supervised daemon for a target. Configure supported agent lifecycle/tool hooks to
pipe their payloads to `aphelion hook`; do not start a new daemon on every hook invocation.
When the service uses a non-default port, expose that port to the relay:

```sh
APHELION_PORT=5331 aphelion hook
```

The hook relay is short-lived. The supervised daemon owns the trail and board.

## Health and removal checks

The local model endpoint proves that the process is serving the expected target:

```sh
curl --fail http://127.0.0.1:5330/api/model
```

Also inspect the board and list recorded sessions:

```sh
aphelion sessions /absolute/path/to/project
```

Stopping the service ends future observation. It does not delete trails, modify the observed
target, or uninstall the WordPress mu-plugin. Remove those separately only when intended.
