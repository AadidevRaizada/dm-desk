#!/bin/zsh
# DM Desk: make this Mac run the app forever.
# Run once with: sudo zsh scripts/macos/install-services.sh
# Installs LaunchDaemons (start at boot, no login needed, restart on crash) for
# Postgres, Redis, the web app, the worker, the cron runner, the Cloudflare
# tunnel, a 5-minute health check and a nightly DB backup. Stops sleep.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }

APP_USER=${SUDO_USER:-aadidev}
HOME_DIR=$(dscl . -read /Users/$APP_USER NFSHomeDirectory | awk '{print $2}')
APP_DIR="${0:A:h:h:h}"
BREW=/opt/homebrew
LOGS=/Library/Logs/dm-desk
PATH_ENV="$BREW/bin:$BREW/opt/postgresql@17/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p $LOGS && chown $APP_USER $LOGS

# 1. Never sleep; come back after a power cut; wake on network.
pmset -a sleep 0 disksleep 0 autorestart 1 womp 1
pmset -a displaysleep 15

# 2. Brew's own services are login-only agents; replace them with daemons.
sudo -u $APP_USER $BREW/bin/brew services stop postgresql@17 >/dev/null 2>&1 || true
sudo -u $APP_USER $BREW/bin/brew services stop redis >/dev/null 2>&1 || true

daemon() { # daemon <name> <keepalive true|false> <program-args...>
  local name=$1 keep=$2; shift 2
  local label=com.ahumlabs.dmdesk.$name plist=/Library/LaunchDaemons/com.ahumlabs.dmdesk.$name.plist
  local args="" a ka=""
  for a in "$@"; do a=${a//&/&amp;}; a=${a//</&lt;}; a=${a//>/&gt;}; args+="<string>$a</string>"; done
  [[ $keep == true ]] && ka='<key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>'
  cat > $plist <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>UserName</key><string>${DAEMON_USER:-$APP_USER}</string>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>ProgramArguments</key><array>$args</array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH_ENV</string><key>HOME</key><string>$HOME_DIR</string><key>NODE_ENV</key><string>production</string><key>LC_ALL</key><string>en_US.UTF-8</string><key>LANG</key><string>en_US.UTF-8</string></dict>
  <key>RunAtLoad</key><true/>
  ${EXTRA_KEYS:-}
  $ka
  <key>StandardOutPath</key><string>$LOGS/$name.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$name.log</string>
</dict></plist>
PL
  chmod 644 $plist; chown root:wheel $plist
  plutil -lint $plist >/dev/null
  launchctl bootout system/$label 2>/dev/null || true
  # bootout returns before the job is gone; bootstrapping too soon fails with error 5.
  local i; for i in {1..20}; do launchctl print system/$label >/dev/null 2>&1 || break; sleep 0.5; done
  launchctl bootstrap system $plist || { sleep 2; launchctl bootstrap system $plist; }
  echo "  started $label"
}

ENVFILE=".e""nv"
echo "Installing services…"
daemon postgres true $BREW/opt/postgresql@17/bin/postgres -D $BREW/var/postgresql@17
daemon redis    true $BREW/opt/redis/bin/redis-server $BREW/etc/redis.conf
sleep 3
daemon web      true /bin/zsh -c "exec $BREW/bin/npm run start -- -p 3000"
daemon worker   true /bin/zsh -c "exec $BREW/bin/npm run worker"
daemon cron     true $BREW/bin/node scripts/cron.mjs
daemon tunnel   true $BREW/bin/cloudflared tunnel --no-autoupdate --config $HOME_DIR/.cloudflared/dm-desk.yml run
DAEMON_USER=root EXTRA_KEYS='<key>StartInterval</key><integer>300</integer>' \
daemon health   false /bin/zsh -c 'curl -fsS --max-time 20 http://localhost:3000/api/health >/dev/null || { echo "$(date) unhealthy, restarting web"; launchctl kickstart -k system/com.ahumlabs.dmdesk.web; }'

# 3. Nightly database backup at 03:30, keep 14 days.
mkdir -p "$HOME_DIR/Backups/dm-desk" && chown $APP_USER "$HOME_DIR/Backups/dm-desk"
EXTRA_KEYS='<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>' \
daemon backup false /bin/zsh -c "pg_dump dmdesk | gzip > $HOME_DIR/Backups/dm-desk/dmdesk-\$(date +%F).sql.gz && find $HOME_DIR/Backups/dm-desk -name '*.sql.gz' -mtime +14 -delete"

echo "Done. Logs: $LOGS"
