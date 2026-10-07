#!/usr/bin/env bash
# Installs PR Map: the pr-map Claude Code skill and its Cursor extension.
#
#   curl -fsSL https://<site>/install.sh | PR_MAP_ZIP_URL=https://<site>/pr-map.zip bash
#   bash install.sh ./pr-map-0.1.0.zip          # from a zip you already have
#
# Safe to run again: it replaces the installed copy with the new one.
set -euo pipefail

ZIP_SOURCE="${1:-${PR_MAP_ZIP_URL:-}}"
SKILL_DIR="$HOME/.claude/skills/pr-map"
MIN_NODE_MAJOR=20
MIN_NODE_MINOR=7

say() { printf '%s\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }

# ---------- 1. Check what's needed, and say every missing thing at once

say "Checking what PR Map needs…"
missing=0

if command -v node >/dev/null 2>&1; then
  version=$(node --version | sed 's/^v//')
  major=${version%%.*}; rest=${version#*.}; minor=${rest%%.*}
  if [ "$major" -gt "$MIN_NODE_MAJOR" ] || { [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]; }; then
    ok "Node $version"
  else
    bad "Node $version is too old. Install Node 20.7 or newer: brew install node"; missing=1
  fi
else
  bad "Node isn't installed. Install it: brew install node"; missing=1
fi

if command -v claude >/dev/null 2>&1; then
  if claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
    ok "Claude Code, signed in"
  else
    bad "Claude Code isn't signed in. Run: claude   (then sign in)"; missing=1
  fi
else
  bad "Claude Code isn't installed. Install it from https://claude.com/claude-code"; missing=1
fi

if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then ok "GitHub CLI, signed in"; else bad "GitHub CLI isn't signed in. Run: gh auth login"; missing=1; fi
else
  bad "GitHub CLI isn't installed. Install it: brew install gh"; missing=1
fi

# Cursor's `cursor` command is optional on PATH; the app bundle always has it.
CURSOR_BIN=$(command -v cursor || true)
[ -z "$CURSOR_BIN" ] && [ -x "/Applications/Cursor.app/Contents/Resources/app/bin/cursor" ] && CURSOR_BIN="/Applications/Cursor.app/Contents/Resources/app/bin/cursor"
if [ -n "$CURSOR_BIN" ]; then ok "Cursor"; else bad "Cursor isn't installed. Get it from https://cursor.com"; missing=1; fi

if [ "$missing" -ne 0 ]; then
  say ""
  say "Fix the items above, then run this again. Nothing was installed."
  exit 1
fi

if [ -z "$ZIP_SOURCE" ]; then
  say ""
  say "Tell me where the PR Map zip is: bash install.sh <path or URL>, or set PR_MAP_ZIP_URL."
  exit 1
fi

# ---------- 2. Get the zip and check it's PR Map

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

say ""
say "Getting PR Map…"
case "$ZIP_SOURCE" in
  http://*|https://*) curl -fsSL "$ZIP_SOURCE" -o "$work/pr-map.zip" ;;
  *) cp "$ZIP_SOURCE" "$work/pr-map.zip" ;;
esac
unzip -q "$work/pr-map.zip" -d "$work"
if [ ! -f "$work/pr-map/SKILL.md" ] || ! ls "$work"/pr-map/pr-map-*.vsix >/dev/null 2>&1; then
  bad "That zip doesn't look like PR Map (no pr-map/SKILL.md or .vsix inside). Nothing was installed."
  exit 1
fi
ok "Downloaded"

# ---------- 3. Install the skill, keeping the old copy until the new one is ready

mkdir -p "$HOME/.claude/skills"
if [ -e "$SKILL_DIR" ] || [ -L "$SKILL_DIR" ]; then
  backup="$SKILL_DIR.previous"
  rm -rf "$backup"
  mv "$SKILL_DIR" "$backup"
fi
mv "$work/pr-map" "$SKILL_DIR"
if ! "$SKILL_DIR/bin/setup" >/dev/null; then
  bad "Installing PR Lens failed. Run $SKILL_DIR/bin/setup to see why."
  [ -n "${backup:-}" ] && rm -rf "$SKILL_DIR" && mv "$backup" "$SKILL_DIR" && say "  Put your previous PR Map back."
  exit 1
fi
[ -n "${backup:-}" ] && rm -rf "$backup"
ok "Skill installed at $SKILL_DIR"

# ---------- 4. Install the Cursor extension

vsix=$(ls "$SKILL_DIR"/pr-map-*.vsix | head -1)
if "$CURSOR_BIN" --install-extension "$vsix" --force >/dev/null 2>&1; then
  ok "Cursor extension installed"
else
  bad "Installing the Cursor extension failed. Try: \"$CURSOR_BIN\" --install-extension \"$vsix\""
  exit 1
fi

# ---------- 5. What to do next

say ""
say "PR Map is installed. Next:"
say "  1. Reload Cursor: Cmd+Shift+P, then Developer: Reload Window."
say "  2. Check out a PR's branch."
say "  3. Open the PR Map tab in the bottom panel and click Map this PR."
say "     A map takes 2 to 8 minutes. Then ask questions in Cursor's chat on the right."
