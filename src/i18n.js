export const DICT = {
  en: {
    settings: 'Settings', language: 'Language',
    grant_text: 'Access to claude.ai is required.', grant_btn: 'Allow access to claude.ai',
    load_btn: 'Load chat list', loading: 'Loading…', loaded_n: 'Chats loaded: {n}', total_n: 'Total chats: {n}', error: 'Error: {msg}',
    what: 'What to export', mode_all: 'All (respecting search/project)', mode_period: 'By period', mode_selected: 'Selected (checkboxes)',
    from: 'from', to: 'to', by: 'by', by_updated: 'modified date', by_created: 'creation date',
    search_ph: 'Search by title', all_projects: 'All projects', sel_visible: 'Select all visible', sel_none: 'Clear selection',
    to_export: 'To export: {n}',
    th_title: 'Title', th_project: 'Project', th_created: 'Created', th_modified: 'Modified', th_model: 'Model', untitled: '(untitled)',
    format_opts: 'Format and options', o_md: 'Markdown', o_pdf: 'PDF', o_artifacts: 'Artifacts as separate files', o_inline: 'Artifacts inside chat',
    o_thinking: 'Thinking blocks', o_tools: 'Tool calls', o_front: 'Metadata (YAML)',
    packaging: 'Packaging:', pack_zip: 'ZIP', pack_files: 'Separate files', folder: 'Folder in Downloads:', ask_where: 'Ask where to save (ZIP only)',
    export_btn: 'Export', cancel_btn: 'Cancel',
    choose_format: 'Choose a format: Markdown and/or PDF.', cancelled: 'Cancelled, nothing saved.',
    packing_zip: 'Packing ZIP…', zip_pct: 'ZIP {p}%',
    progress: '{done}/{total}', progress_err: '{done}/{total}, errors: {e}',
    done_zip: 'Done: chats {c}, files {f}, errors {e}.\nFile: Downloads/{path}',
    done_files: 'Done: chats {c}, files {f}, errors {e}.\nFolder: Downloads/{path}',
    errors_head: 'Errors:',
    tab_chats: 'Chats', tab_artifacts: 'Artifacts', tab_projects: 'Projects',
    art_opts: 'Artifact options', o_all_versions: 'All versions (versions/name.v1, v2…)', o_binaries: 'Download attached files (images, PDFs)',
    pack_opts: 'Saving', export_artifacts_btn: 'Export artifacts', export_projects_btn: 'Export projects',
    projects_load: 'Load projects', projects_total: 'Projects: {n}', proj_none: 'No projects found.', proj_selected: 'Selected projects: {n}',
    proj_all: 'Select all', proj_clear: 'Clear selection',
    done_art: 'Done: chats {c}, artifacts {a}, attached files {b}, errors {e}.\nSaved to: Downloads/{path}',
    done_proj: 'Done: projects {p}, knowledge files {k}, project files {f}, errors {e}.\nSaved to: Downloads/{path}',
    no_artifacts: 'No artifacts found in the selected chats.',
    tab_account: 'Memory & Skills', export_account_btn: 'Export memory & skills',
    o_skills: 'Skills list (names, descriptions, status)', o_memory: 'Memory (text and settings)',
    acc_note: 'Skill files and new-style ("melange") memory content are not exposed by a known claude.ai endpoint yet. This exports what claude.ai returns: the skills list with descriptions and the memory text/settings.',
    gallery: 'Artifacts page', gallery_hint: 'Uses the list from claude.ai/artifacts and takes the final content of each artifact from its source chat.',
    gallery_btn: 'Export all artifacts from the Artifacts page', gallery_count: 'Artifacts on the page: {n}',
    done_gallery: 'Done: artifacts {a} from {c} chats, not found {m}, errors {e}.\nSaved to: Downloads/{path}',
    done_account: 'Done: skills {s}, memory characters {m}, errors {e}.\nSaved to: Downloads/{path}',
    o_proj_files: 'Include project files (PDF, images)', notes_head: 'Notes:',
    note_memory_empty: 'The memory text is empty on the server (memory mode: {mode}). Content of the new memory mode is not available through a known endpoint yet.',
    tab_local: 'Claude Code & files', export_local_btn: 'Export selected',
    cc_title: 'Claude Code folder (.claude)',
    cc_hint: 'Pick the .claude folder (for example C:/Users/<you>/.claude; type the path in the folder dialog, the folder is hidden). Sessions, memory, skills, CLAUDE.md, agents and commands are read; credentials, settings and history are never touched.',
    cc_info: 'Sessions: {s}, memory files: {m}, skills files: {k}, CLAUDE.md / agents / commands / rules: {a}',
    cc_none: 'Nothing recognised. Choose the .claude folder itself.', cc_reading: 'Reading sessions… {n}',
    off_title: 'Official claude.ai export (ZIP or conversations.json)',
    off_hint: 'Settings → Privacy → Export data on claude.ai emails you a ZIP. Choose it here to export its chats to Markdown/PDF.',
    off_info: 'Conversations: {c}, projects: {p}', off_none: 'No conversations found in this file.',
    o_lc_memory: 'Memory files (Claude Code)', o_lc_skills: 'Skills (all files)', o_lc_md: 'CLAUDE.md, agents, commands, rules', o_lc_proj: 'Projects from the official export',
    lc_extras: 'Also export', done_local: 'Done: chats {c}, files {f}, errors {e}.\nSaved to: Downloads/{path}',
    diag: 'Diagnostics', diag_hint: 'Checks every endpoint and saves a report (structure only, no message text) to Downloads/<folder>/diagnostics-….json for analysis.',
    diag_run: 'Run diagnostics', diag_rec_start: 'Start recording', diag_rec_stop: 'Stop recording and analyze', diag_copy: 'Copy report',
    diag_rec_hint: 'To discover Memory / Skills / Artifacts endpoints: click "Start recording", open in claude.ai: Settings → Capabilities (Memory, Skills), the Artifacts page and a Project, then return here and click "Stop recording and analyze".',
    diag_recording: 'Recording… requests captured: {n}', diag_running: 'Running: {step}', diag_saved: 'Report saved: Downloads/{path}', diag_copied: 'Copied to clipboard',
    pu_settings: 'Settings', pu_open_claude_hint: 'Open claude.ai in a tab to export your chats.', pu_open_claude: 'Open claude.ai',
    pu_current: 'Current chat', pu_export_this: 'Export this chat', pu_recent: 'Recent chats', pu_refresh: 'Refresh',
    pu_export_selected: 'Export selected ({n})', pu_full: 'Full export', pu_art_files: 'Artifact files',
    pu_exporting: 'Exporting… keep this popup open', pu_done: 'Saved {n} chat(s) to Downloads/{path}', pu_no_chats: 'No chats found.',
  },
  ru: {
    settings: 'Настройки', language: 'Язык',
    grant_text: 'Нужен доступ к claude.ai.', grant_btn: 'Разрешить доступ к claude.ai',
    load_btn: 'Загрузить список чатов', loading: 'Загрузка…', loaded_n: 'Загружено чатов: {n}', total_n: 'Всего чатов: {n}', error: 'Ошибка: {msg}',
    what: 'Что экспортировать', mode_all: 'Все (с учётом поиска/проекта)', mode_period: 'За период', mode_selected: 'Выбранные галочками',
    from: 'от', to: 'до', by: 'по', by_updated: 'дате изменения', by_created: 'дате создания',
    search_ph: 'Поиск по названию', all_projects: 'Все проекты', sel_visible: 'Отметить все видимые', sel_none: 'Снять все',
    to_export: 'К экспорту: {n}',
    th_title: 'Название', th_project: 'Проект', th_created: 'Создан', th_modified: 'Изменён', th_model: 'Модель', untitled: '(без названия)',
    format_opts: 'Формат и опции', o_md: 'Markdown', o_pdf: 'PDF', o_artifacts: 'Артефакты отдельными файлами', o_inline: 'Артефакты внутри чата',
    o_thinking: 'Thinking-блоки', o_tools: 'Вызовы инструментов', o_front: 'Метаданные (YAML)',
    packaging: 'Упаковка:', pack_zip: 'ZIP', pack_files: 'Отдельные файлы', folder: 'Папка в «Загрузках»:', ask_where: 'Спрашивать место сохранения (только ZIP)',
    export_btn: 'Экспортировать', cancel_btn: 'Отмена',
    choose_format: 'Выберите формат: Markdown и/или PDF.', cancelled: 'Отменено, файлы не сохранены.',
    packing_zip: 'Упаковка ZIP…', zip_pct: 'ZIP {p}%',
    progress: '{done}/{total}', progress_err: '{done}/{total}, ошибок: {e}',
    done_zip: 'Готово: чатов {c}, файлов {f}, ошибок {e}.\nФайл: Загрузки/{path}',
    done_files: 'Готово: чатов {c}, файлов {f}, ошибок {e}.\nПапка: Загрузки/{path}',
    errors_head: 'Ошибки:',
    tab_chats: 'Чаты', tab_artifacts: 'Артефакты', tab_projects: 'Проекты',
    art_opts: 'Опции артефактов', o_all_versions: 'Все версии (versions/имя.v1, v2…)', o_binaries: 'Скачивать вложенные файлы (картинки, PDF)',
    pack_opts: 'Сохранение', export_artifacts_btn: 'Экспортировать артефакты', export_projects_btn: 'Экспортировать проекты',
    projects_load: 'Загрузить проекты', projects_total: 'Проектов: {n}', proj_none: 'Проекты не найдены.', proj_selected: 'Выбрано проектов: {n}',
    proj_all: 'Отметить все', proj_clear: 'Снять все',
    done_art: 'Готово: чатов {c}, артефактов {a}, вложений {b}, ошибок {e}.\nСохранено в: Загрузки/{path}',
    done_proj: 'Готово: проектов {p}, файлов знаний {k}, файлов проекта {f}, ошибок {e}.\nСохранено в: Загрузки/{path}',
    no_artifacts: 'В выбранных чатах артефактов не найдено.',
    tab_account: 'Память и скиллы', export_account_btn: 'Экспортировать память и скиллы',
    o_skills: 'Список скиллов (названия, описания, статус)', o_memory: 'Память (текст и настройки)',
    acc_note: 'Файлы скиллов и содержимое новой памяти («melange») пока недоступны через известный эндпоинт claude.ai. Экспортируется то, что отдаёт claude.ai: список скиллов с описаниями и текст/настройки памяти.',
    gallery: 'Страница Artifacts', gallery_hint: 'Берёт список со страницы claude.ai/artifacts, а итоговое содержимое каждого артефакта — из чата-источника.',
    gallery_btn: 'Экспортировать все артефакты со страницы Artifacts', gallery_count: 'Артефактов на странице: {n}',
    done_gallery: 'Готово: артефактов {a} из {c} чатов, не найдено {m}, ошибок {e}.\nСохранено в: Загрузки/{path}',
    done_account: 'Готово: скиллов {s}, символов памяти {m}, ошибок {e}.\nСохранено в: Загрузки/{path}',
    o_proj_files: 'Включать файлы проекта (PDF, картинки)', notes_head: 'Заметки:',
    note_memory_empty: 'Текст памяти на сервере пуст (режим памяти: {mode}). Содержимое нового режима памяти пока недоступно через известный эндпоинт.',
    tab_local: 'Claude Code и файлы', export_local_btn: 'Экспортировать выбранное',
    cc_title: 'Папка Claude Code (.claude)',
    cc_hint: 'Выберите папку .claude (например C:/Users/<вы>/.claude; путь можно вписать в окне выбора, папка скрытая). Читаются сессии, память, скиллы, CLAUDE.md, agents и commands; ключи, настройки и историю расширение не трогает.',
    cc_info: 'Сессий: {s}, файлов памяти: {m}, файлов скиллов: {k}, CLAUDE.md / agents / commands / rules: {a}',
    cc_none: 'Ничего не распознано. Выберите саму папку .claude.', cc_reading: 'Чтение сессий… {n}',
    off_title: 'Официальный экспорт claude.ai (ZIP или conversations.json)',
    off_hint: 'Settings → Privacy → Export data на claude.ai присылает ZIP на почту. Выберите его здесь, чтобы экспортировать чаты в Markdown/PDF.',
    off_info: 'Переписок: {c}, проектов: {p}', off_none: 'В этом файле переписок не найдено.',
    o_lc_memory: 'Файлы памяти (Claude Code)', o_lc_skills: 'Скиллы (все файлы)', o_lc_md: 'CLAUDE.md, agents, commands, rules', o_lc_proj: 'Проекты из официального экспорта',
    lc_extras: 'Дополнительно экспортировать', done_local: 'Готово: чатов {c}, файлов {f}, ошибок {e}.\nСохранено в: Загрузки/{path}',
    diag: 'Диагностика', diag_hint: 'Проверяет все эндпоинты и сохраняет отчёт (только структура, без текста сообщений) в Загрузки/<папка>/diagnostics-….json для анализа.',
    diag_run: 'Запустить диагностику', diag_rec_start: 'Начать запись', diag_rec_stop: 'Остановить запись и проанализировать', diag_copy: 'Копировать отчёт',
    diag_rec_hint: 'Чтобы найти эндпоинты Memory / Skills / Artifacts: нажмите «Начать запись», откройте в claude.ai: Settings → Capabilities (Memory, Skills), страницу Artifacts и какой-нибудь Project, затем вернитесь сюда и нажмите «Остановить запись и проанализировать».',
    diag_recording: 'Идёт запись… перехвачено запросов: {n}', diag_running: 'Выполняется: {step}', diag_saved: 'Отчёт сохранён: Загрузки/{path}', diag_copied: 'Скопировано в буфер',
    pu_settings: 'Настройки', pu_open_claude_hint: 'Откройте claude.ai во вкладке, чтобы экспортировать чаты.', pu_open_claude: 'Открыть claude.ai',
    pu_current: 'Текущий чат', pu_export_this: 'Экспортировать этот чат', pu_recent: 'Последние чаты', pu_refresh: 'Обновить',
    pu_export_selected: 'Экспортировать выбранные ({n})', pu_full: 'Полный экспорт', pu_art_files: 'Файлы артефактов',
    pu_exporting: 'Экспорт… не закрывайте это окно', pu_done: 'Сохранено чатов: {n}, папка Загрузки/{path}', pu_no_chats: 'Чаты не найдены.',
  },
};

let lang = 'en';

export async function initLang() {
  try {
    const { lang: l } = await browser.storage.local.get('lang');
    if (l in DICT) lang = l;
  } catch { /* default English */ }
  return lang;
}
export const getLang = () => lang;
export async function setLang(l) {
  if (!(l in DICT)) return;
  lang = l;
  await browser.storage.local.set({ lang: l });
}

export function t(key, params = {}) {
  let s = DICT[lang]?.[key] ?? DICT.en[key] ?? key;
  for (const [k, v] of Object.entries(params)) s = s.replaceAll('{' + k + '}', String(v));
  return s;
}

export function applyI18n(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
}
