#!/usr/bin/env bash
# Puts Orbz on this Linux desktop (owner, 10-03: "make the desktop icon please"): the launcher
# (orbs-open) in ~/.local/bin, the app's icon (packages/app/public/icons/orbs-512.png, the office on
# its card, drawn by tools/shoot_icons.ts) in the icon theme at each size, Orbs in the app grid, and
# a copy on ~/Desktop. `--repo DIR` is the checkout the launcher starts the home from (default: the
# one this script is in).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
REPO=$ROOT
if [ "${1:-}" = "--repo" ]; then REPO=$(cd "${2:?--repo needs a directory}" && pwd); fi
NODE=$(command -v node) || { echo "install.sh: node is not on the PATH" >&2; exit 1; }
RESIZE=$(command -v magick || command -v convert) || { echo "install.sh: ImageMagick is needed to size the icon" >&2; exit 1; }
ICON="$ROOT/packages/app/public/icons/orbs-512.png"
APPS="$HOME/.local/share/applications"
mkdir -p "$HOME/.local/bin" "$APPS"
sed -e "s#@REPO@#$REPO#g" -e "s#@NODE@#$NODE#g" "$HERE/orbs-open" > "$HOME/.local/bin/orbs-open"
chmod 755 "$HOME/.local/bin/orbs-open"
for s in 512 256 128 96 64 48 32; do
  d="$HOME/.local/share/icons/hicolor/${s}x${s}/apps"
  mkdir -p "$d"
  "$RESIZE" "$ICON" -resize "${s}x${s}" "$d/orbs.png"
done
sed -e "s#@HOME@#$HOME#g" "$HERE/orbs.desktop" > "$APPS/orbs.desktop"
gtk-update-icon-cache -q -t -f "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
update-desktop-database -q "$APPS" 2>/dev/null || true
if [ -d "$HOME/Desktop" ]; then
  install -m 755 "$APPS/orbs.desktop" "$HOME/Desktop/orbs.desktop"
  gio set "$HOME/Desktop/orbs.desktop" metadata::trusted true 2>/dev/null || true
fi
echo "Orbz is in your apps$( [ -d "$HOME/Desktop" ] && echo " and on your Desktop"): it starts the home from $REPO"
