# Kode Visualizer

The download site for PR Map: a Claude Code skill plus a Cursor panel that maps a PR. Each flow gets its own tab,
with what starts it, the files to read in order, and what this PR changes in each one.

## What's here

| File | What it is |
|---|---|
| `index.html`, `style.css` | The page. Its install command points at wherever the page is hosted. |
| `install.sh` | Checks Node, Claude Code, GitHub CLI and Cursor, then installs the skill and the extension. |
| `pr-map-0.1.0.zip` | The skill and the Cursor extension (`.vsix`). |

## Install (what the page tells people)

```bash
curl -fsSL https://<site>/install.sh | PR_MAP_ZIP_URL=https://<site>/pr-map-0.1.0.zip bash
```

## Ship a new version

The skill's source lives in `~/Kikoff/.claude/skills/pr-map`. Its export script rebuilds the extension and writes
the zip and `install.sh` straight into this repo:

```bash
~/Kikoff/.claude/skills/pr-map/bin/export ~/Kikoff/kode-visualizer
```

When the version changes, update the zip name in `index.html` too.

## Try the page locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. The install command on the page works against that server.
