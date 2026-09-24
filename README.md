# Claude Exporter (Firefox)

Repository: https://github.com/tiktokaccauntsamurai-glitch/claude-export

Firefox extension that exports your Claude data — chats, artifacts, projects, skills, memory, and local Claude Code sessions — to **Markdown / PDF files on your own computer**.

🇷🇺 Подробное описание на русском: [README.ru.md](README.ru.md)

## Privacy & security (100% local)

* The only network requests go to `https://claude.ai/*`, made from your own logged-in claude.ai tab (`content/api-client.js`). Any other URL is rejected in code (`toUrl()`).
* No analytics, no telemetry, no remote servers, no remote code. All libraries (JSZip, marked, pdfmake) are bundled in `vendor/`.
* The manifest declares `data_collection_permissions: none`.
* Files are built in memory and saved through the browser's Downloads (`browser.downloads`) — nothing is uploaded.
* No `innerHTML` / `eval` / dynamic code: the UI is built with `textContent` and DOM nodes.
* A local `~/.claude` folder is read only after you pick it, and only whitelisted items (sessions, memory, skills, `CLAUDE.md`, agents, commands, rules). Credentials, settings and history files are never read.
* Permissions: `downloads`, `storage`, `tabs`, `webRequest` (passive; used only by the optional diagnostics recorder, header *names* only), host `https://claude.ai/*`.
* Exported files contain your conversations (and, for Claude Code sessions, commands and paths from your history). Treat the output as private and do not commit it to a public repository.

## Features

| Tab | Exports |
|---|---|
| Chats | all / by date / selected → Markdown and/or PDF, artifacts as separate files |
| Artifacts | artifacts of chosen chats (all versions, attachments) and the claude.ai Artifacts page |
| Projects | instructions, text knowledge, project files |
| Memory & skills | skill list with descriptions, memory text/settings |
| Claude Code & files | `~/.claude` sessions, memory, skills, `CLAUDE.md`; official claude.ai export ZIP |
| Popup | export the current chat or one of the 5 latest |

UI languages: English, Русский.

## Install

Temporary (until Firefox restarts): `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → select `manifest.json` (or a built `.xpi`).
Permanent install / signing: see [docs/INSTALL.md](docs/INSTALL.md).

## Development

```bash
npm install
npm start      # Firefox with the extension in a separate profile
npm test       # ~140 tests (logic, jsdom UI, Windows ZIP check)
npm run lint   # web-ext lint
npm run build  # web-ext-artifacts/claude_exporter-<version>.zip
```

## Limitations

The claude.ai internal API is undocumented and may change; run the built-in **Diagnostics** to see what broke. Details: [docs/api-notes.md](docs/api-notes.md).

## License

Not chosen yet — add a `LICENSE` file before publishing. Bundled libraries keep their own licenses (MIT).
