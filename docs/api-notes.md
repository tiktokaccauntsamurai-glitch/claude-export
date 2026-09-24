# claude.ai internal API — what the extension relies on

All paths are relative to `https://claude.ai/api`, called from a content script on a claude.ai tab with `credentials: 'include'`.
Nothing here is an official, documented API: it was observed with the built-in diagnostics (structure only, no content) on a
real account, 2026-09-24. If something breaks after a claude.ai update, run **Diagnostics** in the extension and read the report;
all paths live in `src/core/endpoints.js`.

## Confirmed

| Purpose | Request | Response (relevant fields) |
|---|---|---|
| Organizations | `GET /organizations` | array; pick the one whose `capabilities` contains `chat` → `uuid` |
| Chat list | `GET /organizations/{org}/chat_conversations?limit=50&offset=N` | array; `uuid, name, created_at, updated_at, model, project_uuid, project{name}, current_leaf_message_uuid`; `offset` **is honoured** |
| One chat | `GET /organizations/{org}/chat_conversations/{id}?tree=True&rendering_mode=messages&render_all_tools=true` | `chat_messages[]` with `parent_message_uuid`, `sender` (`human`/`assistant`), `content[]`, `attachments[]`, `files[]` |
| Projects | `GET /organizations/{org}/projects` | array; `uuid, name, description` |
| Project detail | `GET /organizations/{org}/projects/{id}` | adds `prompt_template` (instructions), `docs_count`, `files_count` |
| Project text knowledge | `GET /organizations/{org}/projects/{id}/docs` | array; `file_name, content` (full text) |
| Project binary files | `GET /organizations/{org}/projects/{id}/files` | array; `file_name, file_kind, document_asset.url \| preview_asset.url \| thumbnail_asset.url` |
| Artifacts page | `GET /organizations/{org}/user_artifacts?include_latest_published_artifact_uuid=true&limit=50&offset=N` | `{artifacts:[{uuid, artifact_identifier, artifact_type, title, chat_conversation_uuid, chat_conversation_name, visibility, latest_artifact_version_uuid, ...}], next_cursor}` — **no content** |
| Artifacts count | `GET /organizations/{org}/user_artifacts/count` | `{count, is_capped}` |
| Skills list | `GET /organizations/{org}/skills/list-skills` | `{skills:[{id, name, description, enabled, source, creator_type, ...}]}` — descriptions only |
| Memory | `GET /organizations/{org}/memory` | `{memory: string, controls, updated_at, ...}` (empty string in "melange" mode) |
| Memory settings | `GET /organizations/{org}/memory/settings` | `{memory_mode, enabled_melange, ...}` |
| File download | `GET <preview_url \| document_asset.url>` (absolute `/api/{org}/files/{id}/preview` …) | image/webp thumbnails or the document itself |

## Content blocks inside a chat (`content[]`)

* `text` → `text`
* `thinking` → `thinking`, `summaries[]`
* `tool_use` → `name`, `input`
  * `artifacts` → `input.{command: create|update|rewrite, id, type, title, language, content, old_str, new_str, version_uuid}`
  * `create_file` → `input.{path, file_text}`
  * `visualize:show_widget` → `input.{title, widget_code}`
  * others seen: `web_search, web_fetch, view, present_files, bash_tool, conversation_search, recent_chats, memory_read, message_compose_v1, ask_user_input_v0, launch_extended_search_task, visualize:read_me`
* `tool_result` → skipped
* legacy `<antArtifact identifier=… type=… title=…>` tags inside `text` (older chats)
* text attachments: `attachments[].{file_name, file_type, extracted_content}` (`file_name` may be an empty string)
* files: `files[].{file_name, file_kind, preview_url, thumbnail_url, preview_asset, thumbnail_asset, document_asset}`

## Artifacts without a content endpoint

Six candidate URLs for the content of an artifact all returned 404. The exporter therefore joins the Artifacts page list to the source
chat: `artifact_identifier` equals the artifact `id` inside the chat's `tool_use` blocks; the final content is rebuilt from
`create` / `update` (`old_str` → `new_str`) / `rewrite`. Verified 3/3 by diagnostics.

## Still unknown

* Contents of skills (`skills/{id}`, `/download`, `/files`, `/versions`, `/content`, `get-skill`, `download-skill` → 404; `list-skill-files?id=` → 400, needs another parameter).
* Contents of the new-style ("melange") memory. `/memory` is an empty string; the store is reachable by the assistant through the `memory_read` tool.
* `/api/frame/*` (used by the Artifacts page for thumbnails) answers 404 to replayed calls: the page sends extra headers `x-frame-client-version`, `x-frame-cp`, `x-frame-platform`, `x-frame-session-id`, `x-frame-surface`.

## Local files (Claude Code)

`~/.claude/projects/<cwd with separators replaced by "-">/<sessionId>.jsonl` — one JSON object per line:
`type` = `user` | `assistant` | `attachment` | `ai-title` | `last-prompt` | `mode` | `system` | …. One assistant turn is spread over many
`assistant` lines (one content block each) with `tool_result` carriers (`type: user`) in between. `ai-title.aiTitle` is the session title
(the last one wins). `Write` (`file_path`, `content`) and `Edit` (`file_path`, `old_string`, `new_string`, `replace_all`) are replayed to
rebuild files. Never read: `.credentials.json`, `settings*.json`, `history.jsonl`.
