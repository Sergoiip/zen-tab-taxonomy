#!/usr/bin/env bash
# Tab Taxonomy — Linux helper.
#
#   scripts/install-linux.sh             Install Sine (official v2.3.3 release, checksum-verified) + this mod.
#   scripts/install-linux.sh --mod-only  Install/update only the mod (Sine already installed).
#
# Close Zen completely before running it. Installing Sine writes two small files into Zen's
# program folder (config.js + defaults/pref/config-prefs.js), which usually needs sudo.
# Overrides: ZEN_DIR=/path/to/zen  ZEN_HOME=/path/to/profiles-root  SUDO=""
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
MOD_ID="tab-taxonomy"
LEGACY_IDS=("argos-tidy-tabs")
SINE_VERSION="v2.3.3"
BOOT_VERSION="v0.1.4"
SUDO="${SUDO-sudo}"
MOD_ONLY=false
[[ "${1:-}" == "--mod-only" ]] && MOD_ONLY=true

say() { printf '\033[1;35m▸\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

if [[ -z "${SKIP_RUNNING_CHECK:-}" ]] && pgrep -x zen-bin >/dev/null; then
  die "Zen is running. Close every window and run this again."
fi

# Profiles root: Zen moved from ~/.zen to ~/.config/zen.
if [[ -z "${ZEN_HOME:-}" ]]; then
  for d in "$HOME/.config/zen" "$HOME/.zen" "$HOME/.var/app/app.zen_browser.zen/.zen"; do
    [[ -f "$d/profiles.ini" ]] && { ZEN_HOME="$d"; break; }
  done
fi
[[ -n "${ZEN_HOME:-}" ]] || die "Could not find Zen's profiles (set ZEN_HOME=...)"

# Active profile: installs.ini ([HASH] sections) → profiles.ini [Install…] → profile with Default=1.
PROFILE_REL="$(awk '/^Default=/{print substr($0, 9); exit}' "$ZEN_HOME/installs.ini" 2>/dev/null || true)"
[[ -z "$PROFILE_REL" ]] && PROFILE_REL="$(awk '/^\[Install/{f=1} f&&/^Default=/{print substr($0, 9); exit}' "$ZEN_HOME/profiles.ini" 2>/dev/null || true)"
[[ -z "$PROFILE_REL" ]] && PROFILE_REL="$(awk '/^\[Profile/{p=""} /^Path=/{p=substr($0, 6)} /^Default=1/{if(p){print p; exit}}' "$ZEN_HOME/profiles.ini" 2>/dev/null || true)"
[[ -n "$PROFILE_REL" ]] || die "Could not find the default profile in $ZEN_HOME"
PROFILE="$ZEN_HOME/$PROFILE_REL"
[[ "$PROFILE_REL" == /* ]] && PROFILE="$PROFILE_REL"
[[ -d "$PROFILE" ]] || die "Profile folder not found: $PROFILE"
CHROME="$PROFILE/chrome"
say "Profile: $PROFILE"

BACKUP="${XDG_DATA_HOME:-$HOME/.local/share}/tab-taxonomy/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
[[ -d "$CHROME" ]] && cp -a "$CHROME" "$BACKUP/chrome"
cp -a "$PROFILE/prefs.js" "$BACKUP/prefs.js" 2>/dev/null || true
[[ -f "$PROFILE/user.js" ]] && cp -a "$PROFILE/user.js" "$BACKUP/user.js"
say "Backup: $BACKUP"

if ! $MOD_ONLY; then
  if [[ -z "${ZEN_DIR:-}" ]]; then
    BIN="$(command -v zen-browser || command -v zen || true)"
    [[ -n "$BIN" ]] && ZEN_DIR="$(dirname "$(readlink -f "$BIN")")"
    for d in "${ZEN_DIR:-}" /opt/zen-browser-bin /opt/zen-browser /usr/lib/zen-browser /opt/zen; do
      [[ -n "$d" && -f "$d/application.ini" ]] && { ZEN_DIR="$d"; break; }
    done
  fi
  [[ -f "${ZEN_DIR:-}/application.ini" ]] || die "Could not find Zen's program folder (set ZEN_DIR=...). Flatpak users: use Sine's official installer."

  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  say "Downloading Sine $SINE_VERSION + bootloader $BOOT_VERSION…"
  curl -fsSL -o "$TMP/engine.zip"  "https://github.com/CosmoCreeper/Sine/releases/download/$SINE_VERSION/engine.zip"
  curl -fsSL -o "$TMP/profile.zip" "https://github.com/sineorg/bootloader/releases/download/$BOOT_VERSION/profile.zip"
  curl -fsSL -o "$TMP/program.zip" "https://github.com/sineorg/bootloader/releases/download/$BOOT_VERSION/program.zip"
  (cd "$TMP" && sed 's#vendor/##' "$HERE/scripts/sine-SHA256SUMS" | sha256sum -c --quiet -) || die "Checksum mismatch: refusing to install"

  say "Installing Sine's loader in $ZEN_DIR…"
  $SUDO unzip -oq "$TMP/program.zip" -d "$ZEN_DIR"
  $SUDO chmod 644 "$ZEN_DIR/config.js" "$ZEN_DIR/defaults/pref/config-prefs.js"
  mkdir -p "$CHROME"
  unzip -oq "$TMP/profile.zip" -d "$CHROME"
  unzip -oq "$TMP/engine.zip" -d "$CHROME"
fi

[[ -f "$CHROME/utils/chrome.manifest" ]] || die "Sine is not installed (run without --mod-only, or use Sine's installer)"

MODS_DIR="$CHROME/sine-mods"
mkdir -p "$MODS_DIR/$MOD_ID"
cp "$HERE/tab-taxonomy.uc.js" "$HERE/preferences.json" "$HERE/theme.json" "$MODS_DIR/$MOD_ID/"
python3 - "$MODS_DIR" "$HERE/theme.json" "${LEGACY_IDS[@]}" <<'PY'
import json, os, shutil, sys
mods_dir, theme_path, *legacy = sys.argv[1:]
mods_path = os.path.join(mods_dir, "mods.json")
mods = json.load(open(mods_path)) if os.path.exists(mods_path) else {}
for old in legacy:
    if mods.pop(old, None) is not None:
        shutil.rmtree(os.path.join(mods_dir, old), ignore_errors=True)
        print("removed legacy mod:", old)
theme = json.load(open(theme_path))
prev = mods.get(theme["id"], {})
theme.update({"enabled": prev.get("enabled", True), "no-updates": True, "origin": "local",
              "style": {"chrome": "", "content": ""}})
mods[theme["id"]] = theme
json.dump(mods, open(mods_path, "w"), ensure_ascii=False, indent=2)
print("mods:", ", ".join(m.get("name", k) for k, m in mods.items()))
PY

# Sine only runs local (non-marketplace) JS when this is on.
touch "$PROFILE/user.js"
grep -q 'sine.allow-unsafe-js' "$PROFILE/user.js" || echo 'user_pref("sine.allow-unsafe-js", true);' >> "$PROFILE/user.js"
rm -rf "$HOME/.cache/zen/$PROFILE_REL/startupCache" 2>/dev/null || true

say "Done. Open Zen: hover the sidebar and click “Tidy” on the pinned line, or press Ctrl+Alt+O."
