# Постоянная установка в Firefox

«Загрузить временное дополнение» живёт до перезапуска Firefox. Чтобы расширение оставалось, нужна подпись Mozilla или специальная сборка Firefox.

## Вариант A. Подпись через AMO (рекомендуется, Firefox Release)

Расширение не публикуется в каталоге: канал `unlisted` подписывает `.xpi` и отдаёт его вам.

1. Аккаунт на https://addons.mozilla.org (бесплатно).
2. Ключи API: https://addons.mozilla.org/developers/addon/api/key/ → **JWT issuer** и **JWT secret**.
3. В папке проекта:

   ```powershell
   npm install
   $env:WEB_EXT_API_KEY = "user:12345:67"     # JWT issuer
   $env:WEB_EXT_API_SECRET = "…"              # JWT secret
   npm run sign
   ```
4. Подписанный файл появится в `web-ext-artifacts/*.xpi`.
5. Firefox → `about:addons` → шестерёнка → **Установить дополнение из файла…** → выберите `.xpi`.

Заметки:
* `id` расширения — `claude-exporter@local` (`manifest.json → browser_specific_settings.gecko.id`). Для подписи он должен быть уникальным в вашем аккаунте; при конфликте замените на, например, `claude-exporter@ваш-домен`.
* Каждая новая подпись требует **новой версии** в `manifest.json` (и `package.json`).
* Проверка Mozilla может показать предупреждения про `eval` внутри `vendor/jszip.min.js` и `vendor/pdfmake.min.js`: это чужие библиотеки без изменений; unlisted-подпись их не блокирует.

## Вариант B. Firefox Developer Edition / Nightly / ESR без подписи

1. Установите Developer Edition или Nightly.
2. `about:config` → `xpinstall.signatures.required` = `false`.
3. `about:addons` → **Установить дополнение из файла…** → `.xpi` из `npm run build` (файл в `web-ext-artifacts/`).

## Вариант C. Временно, но удобно для разработки

`npm start` открывает отдельный профиль Firefox с расширением; вход в claude.ai сохраняется в `.ff-dev-profile/`. После правок кода расширение перезагружается автоматически.

## Обновление

Соберите/подпишите новую версию и установите поверх; настройки (язык, папка, галочки) хранятся в `storage.local` и сохраняются.
