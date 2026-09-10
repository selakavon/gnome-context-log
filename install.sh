#!/usr/bin/env bash
# Copy the extension into place, enable it and reload GNOME Shell (X11 only).
set -euo pipefail
UUID=context-log@ales.novak
SRC="$(cd "$(dirname "$0")" && pwd)/$UUID"
DST="$HOME/.local/share/gnome-shell/extensions/$UUID"
rm -rf "$DST"
cp -r "$SRC" "$DST"
gnome-extensions enable "$UUID" || /usr/bin/gsettings set org.gnome.shell enabled-extensions \
  "$(/usr/bin/gsettings get org.gnome.shell enabled-extensions | sed "s/]$/, '$UUID']/; s/@as \[, /[/")"
if [ "${XDG_SESSION_TYPE:-}" = "x11" ]; then
  systemctl --user kill --kill-whom=main -s SIGTERM org.gnome.Shell@x11.service
  echo "GNOME Shell restarted."
else
  echo "Wayland session: log out and back in to load the extension."
fi
gnome-extensions info "$UUID" || true
