# Claude Exporter for Firefox

Export your [Claude](https://claude.ai) data — chats, artifacts, projects, skills, memory and local Claude Code sessions — to **Markdown and PDF files on your own computer**. Everything runs locally inside Firefox: no servers, no accounts, no telemetry.

Repository: https://github.com/tiktokaccauntsamurai-glitch/claude-export · 🇷🇺 Русская версия: [README.ru.md](README.ru.md)

---

## Table of contents

- [Features](#features)
- [Privacy and security](#privacy-and-security)
- [Installation](#installation)
- [Quick start](#quick-start)
- [What the export looks like](#what-the-export-looks-like)
- [Options](#options)
- [Diagnostics](#diagnostics)
- [Permissions explained](#permissions-explained)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Project layout](#project-layout)
- [Contributing and license](#contributing-and-license)

---

## Features

| Tab | What it exports |
|---|---|
| **Chats** | All chats, a date range, or hand-picked ones → Markdown and/or PDF. Follows the branch you actually see (edited/retried messages are resolved). Optional thinking blocks, tool calls and YAML metadata. |
| **Artifacts** | Artifacts of the chosen chats as separate files (all versions optional, attached images/PDFs optional), plus every artifact from the claude.ai **Artifacts** page. |
| **Projects** | Project instructions, description, text knowledge files and binary project files (PDFs, images). |
| **Memory & skills** | The list of your skills with descriptions and status, and the text/settings of claude.ai memory. |
| **Claude Code & files** | Sessions from a local `~/.claude` folder (Markdown/PDF; files created with `Write`/`Edit` become versioned artifacts), plus memory, skills, `CLAUDE.md`, agents, commands and rules. Also imports the official claude.ai *Export data* ZIP. |
| **Popup** (toolbar icon) | One click to export the current chat, or pick from the 5 most recent chats (refreshed live). |

Other things worth knowing:

- Interface in **English** and **Russian** (Settings → Language on the full export page).
- Output as a **single ZIP** or **separate files** in `Downloads/<folder>/`. The folder name is configurable; ZIP can optionally ask where to save.
- Windows-safe file names: reserved names, illegal characters, trailing dots and very long titles are handled (Windows Explorer refuses ZIPs with entries over ~260 UTF-8 bytes, so long names are shortened; full titles stay inside the files and `index.md`).
- Generated `index.md` tables with working links, and an `errors.log` if any chat failed.
- Cancel button, progress bar, gentle rate limiting and automatic retry with backoff on `429`/`5xx`.
- ~140 automated tests (logic, jsdom UI tests, a Windows Explorer ZIP check).

## Privacy and security

This extension is designed to be verifiable — the code is small and there is nothing to hide.

- **Only one host is contacted:** `https://claude.ai`. Requests are made from your own logged-in claude.ai tab using your existing session (`content/api-client.js`). Any other URL is rejected in code.
- **No analytics, telemetry, remote servers or remote code.** All libraries (JSZip, marked, pdfmake with Roboto) are bundled unmodified in `vendor/`.
- The manifest declares `data_collection_permissions: none`.
- **Nothing is uploaded.** Files are built in memory and saved through Firefox's normal Downloads mechanism.
- **No dynamic code:** no `eval`, `new Function`, `innerHTML` or remote scripts. The UI is built with DOM nodes and `textContent`.
- **Local `~/.claude` access is opt-in and whitelisted.** The folder is read only after you choose it, and only sessions, memory, skills, `CLAUDE.md`, agents, commands and rules. Credentials, settings and history files are never matched (covered by a test).
- **Diagnostics reports contain structure only** — key names, counts, HTTP statuses. Message text, IDs (replaced by `{id}`), e-mail addresses and header values are not included.

> **Your exports are private data.** They contain your conversations and, for Claude Code sessions, commands and file paths from your history. Do not commit them to a public repository or share them unreviewed.

## Installation

Requires **Firefox 140 or newer** (desktop).

### Temporary (fastest)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `manifest.json` from this folder (or a built `.xpi`).
3. It stays until Firefox restarts.

### Permanent

Firefox Release only runs signed add-ons. Either sign it for yourself (free, *unlisted* channel — not published anywhere) or use Developer Edition / Nightly / ESR. Full walkthrough: [docs/INSTALL.md](docs/INSTALL.md).

```bash
npm install
WEB_EXT_API_KEY=<jwt issuer> WEB_EXT_API_SECRET=<jwt secret> npm run sign
```

## Quick start

1. Open [claude.ai](https://claude.ai) and log in.
2. Click the extension icon → **Open full export**. On first run press **Allow access to claude.ai** (a standard Firefox permission prompt).
3. Choose a tab, pick chats/projects, set the format and click **Export**.
4. Find the result in your Downloads folder: `ClaudeExport/claude-export-<date>_<time>.zip`.

For a single chat, just use the popup while that chat is open.

## What the export looks like

```
claude-export-2026-09-24_1530.zip
├── index.md                      table of all chats with links
├── chats/
│   ├── 2026-09-20 Trip planning.md
│   └── 2026-09-20 Trip planning.pdf
├── artifacts/
│   └── 2026-09-20 Trip planning/
│       ├── itinerary.md
│       └── versions/itinerary.v1.md
├── projects/<name>/INSTRUCTIONS.md, knowledge/, files/
├── skills/, memory/
└── errors.log                    only if something failed
```

A chat file starts with optional YAML front matter (title, source URL, model, project, dates) followed by `# Human` / `# Claude` turns. Artifacts are either inlined as fenced code blocks (fence length adapts to the content), saved as separate files, or both.

## Options

| Option | Effect |
|---|---|
| Markdown / PDF | Output formats. PDF is rendered locally with pdfmake (emoji are stripped — the bundled font has no glyphs for them). |
| Artifacts as separate files / inside chat | Where artifact code goes. |
| Thinking blocks / Tool calls | Include the model's thinking and tool-call summaries (off by default). |
| Metadata (YAML) | Front matter at the top of each Markdown file. |
| All versions | Save every artifact revision under `versions/`. |
| Download attached files | Fetch images and PDFs attached to chats/projects. |
| Packaging | ZIP or separate files; target folder inside Downloads; optional "ask where to save". |

Settings are remembered in `storage.local`.

## Diagnostics

claude.ai's internal API is undocumented and can change. The **Diagnostics** box on the full export page probes every endpoint the extension uses and saves `diagnostics-<date>.json`. **Start recording** → browse claude.ai → **Stop and analyze** discovers new endpoints. If something stops working after a claude.ai update, run diagnostics and attach the report to an issue. Known endpoints are described in [docs/api-notes.md](docs/api-notes.md).

## Permissions explained

| Permission | Why |
|---|---|
| `https://claude.ai/*` | Read your data from the claude.ai tab; the only host access. |
| `downloads` | Save the exported files. |
| `storage` | Remember your settings and the recent-chats cache. |
| `tabs` | Find the claude.ai tab and the current chat. |
| `webRequest` | Passive, used only while diagnostics recording is on; logs request URL patterns and header *names*, never bodies or values. |

## Limitations

- The claude.ai API is internal and may change without notice.
- Contents of skill files and "melange"-mode memory are not available through any known endpoint; skill descriptions and memory text (when present) are exported. Local skills and Claude Code memory come from the **Claude Code & files** tab.
- Firefox can only save inside the Downloads folder. To use another location, enable "ask where to save" (ZIP only) or change Firefox's download directory.
- The popup export runs while the popup is open — don't click away during a PDF or multi-chat export. Use the full page for big jobs.
- Emoji do not appear in PDFs.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Access to claude.ai is required" | Click **Allow access to claude.ai**. |
| Content script does not respond | Reload the claude.ai tab (opened before the extension was installed). |
| `HTTP 403` | Disable VPN/proxy and reload claude.ai; make sure you are logged in. |
| `HTTP 429` | Rate limit — the extension retries automatically; try again later for very large exports. |
| ZIP will not open in Explorer | Update to 0.6.1+ (long names are shortened automatically). |
| An endpoint stopped working | Run **Diagnostics** and open an issue with the report. |

## Development

```bash
npm install
npm start        # Firefox with the extension, separate profile (.ff-dev-profile)
npm test         # ~140 tests: logic, jsdom UI, Windows ZIP check
npm run lint     # web-ext lint
npm run build    # web-ext-artifacts/claude_exporter-<version>.zip
npm run sign     # signed .xpi (needs WEB_EXT_API_KEY / WEB_EXT_API_SECRET)
npm run verify   # inspect what the extension wrote to Downloads/ClaudeExport
```

The ZIP-openability test uses Windows' `Shell.Application` (the same engine as Explorer) and is skipped on other systems.

## Project layout

```
manifest.json, background.js   Manifest V3; endpoint recorder for diagnostics
content/api-client.js          the only code that talks to claude.ai (from the tab)
popup/, export/                user interface
src/core/                      pure logic (no browser.*): normalization, Markdown/PDF, exporters, parsers
src/io/                        tab bridge, downloads, ZIP, lazy library loading
src/i18n.js                    English / Russian strings
vendor/                        JSZip, pdfmake (+Roboto), marked — bundled, unmodified
tests/                         node:test; tests/ui runs the real pages in jsdom
docs/                          INSTALL, API notes, end-to-end checklist
```

## Contributing and license

Issues and pull requests are welcome. Please run `npm test` and `npm run lint` before submitting, and keep the privacy guarantees above intact (no new hosts, no remote code).

No `LICENSE` file has been added yet — choose one before publishing. Bundled libraries keep their own licenses (MIT).

*Not affiliated with or endorsed by Anthropic. "Claude" is a trademark of Anthropic.*
