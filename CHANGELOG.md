# Changelog

## 0.8.0
* Phase 9: README, INSTALL (signing/permanent install), API notes, packaging scripts (`build`, `sign`, `verify`).
* Tests: ~140 (logic, UI pages in jsdom, background recorder, Windows shell check of ZIPs, on-disk export verifier).
* E2E checklist for Claude Desktop (Dispatch): `docs/E2E-CLAUDE-DESKTOP.md`, `npm run verify`.
* Fix: Markdown links in generated `index.md` tables broke on file names with `(` `)` `[` `]`.

## 0.7.0
* Claude Code & files tab: sessions from `~/.claude`, memory, skills, CLAUDE.md/agents/commands/rules; official claude.ai export (ZIP).

## 0.6.1
* Fix: ZIP could not be opened by Windows Explorer (one entry name > 260 UTF-8 bytes). Byte-aware names + path fitter.

## 0.6.0
* Export of the claude.ai Artifacts page, project files (PDF/images), memory + skills list, diagnostics v3.

## 0.5.x
* Diagnostics (probe endpoints, request recorder, report file); fix binary downloads.

## 0.4.0
* Artifacts-only export (versions, attachments), projects export, tabbed UI.

## 0.3.0
* New popup (current chat, 5 recent chats with live refresh), English/Russian.

## 0.2.0
* Chat list with filters (all / period / selected), Markdown + PDF, ZIP or separate files.

## 0.1.0
* Skeleton, API client, connection check.
