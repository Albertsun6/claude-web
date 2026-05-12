#!/bin/bash
# Vessel backend uninstaller. Reverses what the .pkg installed.
# Does NOT touch:
#   ~/.claude-web/           (runtime data: telemetry, projects, harness DB)
#   ~/.claude/               (Claude CLI credentials & session history)
#   ~/.whisper-models/       (downloaded Whisper models)
# Usage: sudo /usr/local/vessel/uninstall.sh

set -u

PLIST_LABEL="com.vessel.backend"
VESSEL_PREFIX="/usr/local/vessel"

if [ "$(id -u)" -ne 0 ]; then
  echo "uninstall.sh must run as root: sudo $0" >&2
  exit 1
fi

USER_NAME="${SUDO_USER:-}"
if [ -z "${USER_NAME}" ] || [ "${USER_NAME}" = "root" ]; then
  USER_NAME="$(stat -f %Su /dev/console 2>/dev/null || echo "")"
fi

if [ -n "${USER_NAME}" ] && [ "${USER_NAME}" != "root" ]; then
  USER_HOME="$(eval echo "~${USER_NAME}")"
  UID_NUM="$(id -u "${USER_NAME}")"
  echo "[vessel uninstall] stopping LaunchAgent for ${USER_NAME} (uid ${UID_NUM})"
  sudo -u "${USER_NAME}" launchctl bootout "gui/${UID_NUM}/${PLIST_LABEL}" 2>/dev/null || true
  rm -f "${USER_HOME}/Library/LaunchAgents/${PLIST_LABEL}.plist"
else
  echo "[vessel uninstall] could not detect user — skipping LaunchAgent unload."
  echo "[vessel uninstall] You may need to run manually:"
  echo "  launchctl bootout gui/\$(id -u)/${PLIST_LABEL}"
  echo "  rm ~/Library/LaunchAgents/${PLIST_LABEL}.plist"
fi

echo "[vessel uninstall] removing ${VESSEL_PREFIX}"
rm -rf "${VESSEL_PREFIX}"

echo "[vessel uninstall] forgetting pkg receipt"
pkgutil --forget com.vessel.backend 2>/dev/null || true

echo "[vessel uninstall] done. Runtime data preserved at:"
echo "  ~/.claude-web/      (telemetry, projects, harness DB)"
echo "  ~/.claude/          (Claude CLI credentials)"
echo "  ~/.whisper-models/  (Whisper models)"
echo "Delete those manually if you want a fully clean state."
