## 2026-10-22: assistant update deployed, public checks passed

User confirmed running the deployment command. Independent checks: `/` 200, `/health/ready` 200, `/api/v1/users/me/assistant-preferences` 401 unauthenticated. Served frontend assets `index-CSrET2Yl.js` and `index-BtoHz7g4.css`; bundle contains the new assistant preferences integration. Authenticated real-provider production behavior has not been tested.

See [assistant-20261022.md](assistant-20261022.md) for scope and validation: backend 200 passed / 6 integration skips; frontend 70 passed; build and migration parity passed. Release target migration: `0012_assistant_preferences`. No GitHub push.

## 2026-10-21: production deployment verified

User terminal screenshot confirms migration `0011_device_health (head)`, API readiness OK, running frontend/API/worker and healthy database/Redis. Independent public checks after deployment: `/` 200, `/health/ready` 200, `/privacypolicy.html` 200, protected `/api/v1/health/device` 401 (previously 404). Served frontend assets: index-4xDH61EH.js and index-h-95cfRv.css.

Web/backend release is deployed. Authenticated feature checks and native phone HealthKit/Health Connect permission/sync checks remain; browser access alone does not enable device health reads. Android debug APK is built locally; iOS still requires signing/build via Mac or macOS build service.

## 2026-10-21: Compose environment parsing fix

Next attempt passed module imports but failed Settings parsing `google_client_ids` in isolated migration verification. The QA container used `docker run --env-file`, unlike production Compose; literal dotenv quotes break JSON list decoding. Changed runtime settings/import smoke check and QA migrations to `sc run --rm --no-deps -T ... migrate`, using identical Compose env parsing. QA database URL remains explicitly overridden. Production env file unchanged.

Verified quoted fake client IDs using local Compose config; JSON parsing passes after Compose decoding and fails with literal quotes. Updated script uploaded; remote bash syntax passed, public readiness 200. Full deployment still requires the user's interactive sudo command below. Do not mark deployed until DEPLOYMENT_OK and public endpoint checks pass.

## 2026-10-21: deployment package permission fix

Deployment failed importing `app.modules.auth`. Reproduced extraction with umask 077: implicit archive directories were 0700. Repacked the same 178 source files with 26 explicit directories (0755), files 0644, and changed extraction to `--same-permissions`. Added a model import smoke check as the image runtime user before migration checks.

Corrected archive SHA256: `1a8ed0d743254e271085698c7ef4566a10e8591ad9481f650ba798ddc09cdb7e`.
Uploaded archive and script to `/home/lifeadmin/lifehub-release-20261021/`. Remote checksum and bash syntax passed; remote extraction verified auth directory 0755 and model file 0644. Public readiness returns 200. Deployment is NOT yet completed: sudo still requires the user's password.

Run from the user's terminal:
```powershell
ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-release-20261021/deploy-20261021.sh"
```
After `DEPLOYMENT_OK`, verify public readiness and protected `/api/v1/health/device` returns 401. Native health checks still require phones.

# Release 2026-10-21 — prepared, deployment blocked

- User explicitly authorized deploying all current changes to the server.
- Fresh SSH check: `root@104.248.254.176` returns `Permission denied (publickey)`. No SSH agent or attached server terminal is available. Requested current SSH command/key path from user; no secrets requested.
- Correct SSH user supplied by the user: `lifeadmin`. SSH works; sudo requires an interactive password. `/srv/lifehub` is root-only and Docker socket is not accessible to lifeadmin. No production files, environment, containers or database were changed.
- Package and reviewed script uploaded to `/home/lifeadmin/lifehub-release-20261021/` (directory 0700). Remote archive SHA-256 matches; `bash -n` passed. Script: `deploy-20261021.sh`. It builds sequentially, tests migrations in a disposable PostgreSQL container, backs up DB/source, migrates production, replaces api/worker/frontend and checks public endpoints. On failure it restores old image tags/containers without downgrading/restoring production data.
- Final local backend suite: 189 passed, 6 PostgreSQL/Redis integration checks skipped. Frontend: 70 passed and production build passed in prior verification.
- Required user action: run `ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-release-20261021/deploy-20261021.sh"` in their own PowerShell and enter sudo password there, never in chat.
- Source package prepared: `output/releases/lifehub-20261021-web-backend.tar.gz` (178 allowlisted files, 285232 bytes), SHA-256 `ec5c8e8035efea60ce59dde66b7e1e6213c7540a2f23ee834242f517ee463475`. Includes chat/media/overview/health, migrations 0009–0011, frontend sources and locked dependencies, Docker/compose/deploy config. Excludes all .env files, local data and native build output.
- Next after SSH access: inspect actual server state and environment key presence without printing secrets; back up DB/source/settings and tag old images; upload package into staging; build using server production frontend OAuth args; run migrations with new API image; recreate API/worker/frontend; verify readiness, served assets, protected APIs and worker errors. Preserve server .env.production, user accounts and persistent volumes. Do not restore/downgrade DB automatically after new writes.
- Android APK remains a separate local test artifact; deploying the website alone cannot grant browser access to HealthKit/Health Connect.

---

# Release 2026-10-02 — full product expansion

- Code commit `a54443c` pushed to `dan4ik4/lifehub` main and deployed to https://lifehapp.online.
- API / worker / frontend replaced from prebuilt images. PostgreSQL, Redis and Caddy volumes/containers retained. Migration advanced from 0001 to 0008_weight_unit.
- Verified: `/health/ready` 200; private module APIs reject anonymous requests with 401; manifest/sw 200; production Google sign-in button rendered. Worker has zero `Worker tick failed` messages after update. DB accepts connections.
- VAPID generated privately on the server and accepted by py-vapid; environment mode remains 0600. Users opt in on their device. Actual notification delivery still requires a real subscribed device; no browser permissions were granted on behalf of users.
- Accounts preserved: 8 total, stored plans 3 Pro / 2 Trial / 3 Free. No changes to entitlements, Free selections or account records beyond default kg display column.
- Backup before migration: `/var/backups/lifehub/postgres-20261002T191828Z.dump`; source/settings backup `/var/backups/lifehub/source-before-product-20261002.tar.gz`, root-only. Previous images `lifehub-api:before-product-20261002` and `lifehub-frontend:before-product-20261002` retained.
- Backend verification: full isolated PostgreSQL/Redis suite 165 passed; latest dashboard budget delta also passed. Frontend 59 tests passed, TypeScript/build pass. Migration parity and upgrade/downgrade/upgrade checked on isolated PostgreSQL and SQLite. Browser QA used synthetic local data only.
- One pre-existing planning AI deadlock was found and fixed using consistent user-before-command row lock order.
- Disposable remote QA DB/Redis containers and their anonymous volumes removed after checks; production volumes untouched.
- Unresolved product decisions and AI approval block are recorded in [full-product-progress.md](full-product-progress.md).

Rollback application code if needed: retag the two `before-product-20261002` images to `lifehub-api:production` / `lifehub-frontend:latest`, then recreate api/worker/frontend with `--no-build --no-deps`. The migration is additive; do not downgrade or restore the production database automatically after users have written new records.

---

# Развёртывание Life Hub — 7 сентября 2026, 11:26 UTC

## Обновление 8 сентября 2026 — GitHub и включение ИИ

- По запросу пользователя проект впервые опубликован в https://github.com/dan4ik4/lifehub, ветка main, исходный коммит e4219a3. Проверены все файлы коммита: .env и .env.production исключены, секреты не обнаружены. Добавлены .gitattributes для переносов LF. Перед публикацией прошли 127 backend tests и 57 frontend tests; 5 PostgreSQL/Redis integration tests пропущены без отдельного тестового окружения.
- Сохранённый пользователем OpenAI key передан по SSH только в LIFEHUB_OPENAI_API_KEY на сервере и синхронизирован с локальным .env.production. Секрет не выводился и не добавлялся в Git. Предыдущая конфигурация сохранена в защищённом /srv/lifehub/releases/before-ai-*/.env.production.
- Реальный OpenAI запрос выявил invalid_json_schema: Pydantic Decimal quantity генерировал regex lookaround, который OpenAI отвергает. Введён отдельный генератор JSON-схемы только для OpenAI: простой шаблон десятичного числа; Pydantic продолжает проверять положительность, точность и длину. HTTP/domain schemas не изменены.
- 16 AI tests и ruff прошли, включая проверки schema payload через настоящий SDK с mock transport и отклонения некорректных количеств. Затем два реальных запроса с сервера к gpt-5.6-luna успешно сформировали задачу и покупку с количеством 1.5. Для проверки использован синтетический контекст без пользовательских данных; в рабочую базу записи не добавлялись.
- Собран новый backend image, применён к API и worker. Предыдущий образ: lifehub-api:before-ai-20260908; старый commands.py сохранён в releases/before-ai-code-20260908. Проверено наличие ключа и исправленной схемы в работающем API, API healthy, worker running, публичные / и /health/ready возвращают 200, readiness status=ok.
- ИИ включён. Финальное действие пользователя: отправить команду из блока «Просто скажите, что в планах» в собственном аккаунте. Полный сценарий с пользовательской сессией после этого обновления агентом не выполнялся.

## Обновление 7 сентября, после 12:10 UTC — диагностика Calendar callback

- Пользователь подтвердил вход Google. Исправлен redirect_uri_mismatch в консоли Google добавлением https://lifehapp.online/calendar/callback; затем добавлен тестовый аккаунт в Audience/Test users.
- Теперь возврат из Google доходит до приложения, но callback завершается общим сообщением об ошибке. В БД до исправления 7 OAuth starts, 2 consumed states, 0 connections и sync jobs. Логи API не сохраняли причину provider failure, поэтому первоначальный отказ Google пока не установлен.
- Обнаружен и исправлен дефект frontend api.ts: любой 401 от protected endpoint приводил к refresh и повтору запроса, включая calendar_reauth_required. Это повторяло одноразовый callback и маскировало исходную ошибку как invalid_calendar_state. Refresh теперь только для unauthorized/invalid_access; ошибки внешнего календаря не повторяются и не завершают сессию Life Hub.
- Google adapter различает отключённый Calendar API, недостающие scopes и неправильный OAuth client. Добавлены безопасный лог стабильного кода отказа callback и русские сообщения во фронте; токены/коды/ответы Google не логируются.
- 14 Google adapter tests, 57 frontend tests и ruff прошли. Production Docker build с TypeScript/Vite прошёл. Файлы обновлены по SCP, GitHub не использовался. Создана резервная копия базы; старые Docker images помечены before-calendar-fix-20260907, исходники сохранены в /srv/lifehub/releases/before-calendar-fix-20260907.
- Новая версия запущена, health/ready ok; публичный JS /assets/index-DNys9ykc.js содержит новые сообщения. Требуется новая попытка пользователя после обновления страницы: старый OAuth code одноразовый, повторно использовать его нельзя. После попытки проверить безопасную строку Calendar connection failed в api logs и новый экран ошибки. Не утверждать, что сам календарь уже подключён; не обходить Google consent и не создавать соединение вручную.

## Обновление 7 сентября, 11:51 UTC

- Пользователь подтвердил: Resend Verified, сайт открывается на ноутбуке, обычная регистрация работает.
- Проверка опубликованного сайта браузером теперь проходит. Официальная кнопка Google загружается.
- При нажатии Google в браузере получена конкретная ошибка GSI_LOGGER: The given origin is not allowed for the given client ID.
- Следующий обязательный шаг: в существующем Google Web OAuth client добавить Authorized JavaScript origin https://lifehapp.online (без пути и завершающего слеша). Код/сервер на этом этапе менять не нужно. После сохранения повторить вход с участием пользователя.
- Вход Google пока не завершён; пользовательские Google credentials не вводились. Настройка календарного callback остаётся отдельным следующим шагом.

## Выполнено

- Проект: C:/Users/danei/OneDrive/Документы/GitHub/lifehub.
- Домен lifehapp.online, www перенаправляется на основной домен. Namecheap и 1.1.1.1 возвращают 104.248.254.176. На ноутбуке остаётся старый DNS-кеш 192.64.119.229 (TTL около 389 секунд в 11:24 UTC).
- Доступ по SSH root@104.248.254.176 работает, StrictHostKeyChecking=yes. Ubuntu 24.04.4, 2 ГБ RAM. Docker 29.8.0, Compose 5.5.1 установлены из официального apt-репозитория, Docker включён в автозагрузку.
- Исходники загружены по SCP в /srv/lifehub без .git, node_modules, локальных баз и окружений. Git/GitHub не использовались.
- Созданы compose.production.yaml, deploy/Caddyfile, deploy/frontend.conf, backup.sh и systemd unit/timer; docs/deployment.md содержит инструкции.
- Создан отдельный .env.production с новыми независимыми PostgreSQL/JWT/OTP/Fernet секретами. Ключи Google и Resend взяты из локального .env. Оригинальный .env не менялся. Production env сохранён локально и на сервере (0600, каталог 0700). .env.* исключены из обоих Docker build context; .gitignore уже исключает их.
- VITE_GOOGLE_CLIENT_ID взят из единственного backend Google client ID; он совпадает с calendar client. Origin и redirect настроены со стороны приложения. Консоль Google ещё не проверена.
- Сборка frontend (TypeScript + Vite) и Python Docker image прошла. nginx -t, Caddy validate и compose config --quiet прошли.
- В edge network зарезервирован 172.30.81.2 для Caddy, автоматический диапазон 172.30.81.128/25. Первоначальный конфликт динамического адреса исправлен пересозданием контейнеров без удаления томов. Uvicorn доверяет proxy-заголовкам только адресу Caddy.
- Работают caddy, frontend, api, worker, db, redis. Миграция 0001 (head). DB/Redis/API healthy; остальные сервисы запущены. Наружу открыты SSH 22 и Caddy 80/443. Порты базы/Redis/API не опубликованы.
- Выпущены действительные HTTPS-сертификаты для lifehapp.online и www. Curl с --resolve и обычной проверкой TLS: главная 200, JS/CSS 200, /planning/calendar 200, /health/ready {status:ok}; HTTP -> HTTPS 308, www -> основной домен 301; защищённый API без токена возвращает 401.
- Включён lifehub-backup.timer ежедневно около 03:15 UTC. Первая копия /var/backups/lifehub/postgres-20260907T112356Z.dump (62 КБ), service Result=success; pg_restore --list проходит. Полное восстановление не тестировалось, копии пока только на этом сервере.
- Browser QA по домену не завершена: встроенный браузер получил ERR_CONNECTION_TIMED_OUT; обычный curl тоже идёт на старый DNS IP, curl --resolve на правильный сервер проходит. Нужно повторить после обновления кеша, не отключать проверку TLS и не менять системный DNS без необходимости.

## Следующие шаги — требуется участие пользователя

1. Resend Domains: добавить/открыть lifehapp.online, получить DNS-записи и внести их в Namecheap. На момент проверки отсутствуют стандартные resend._domainkey TXT и send MX/TXT. Подтвердить статус Verified. ВАЖНО: ключ корректно ограничен Sending access; HTTP 401 на GET /domains означает restricted_api_key с сообщением only send emails, а не недействительный ключ. Ключ не заменять и права не расширять ради этой проверки. Письма ещё не отправлялись.
2. Настроить существующий Google Web OAuth client в консоли: Authorized JavaScript origin https://lifehapp.online, Authorized redirect URI https://lifehapp.online/calendar/callback; Calendar API и тестовый пользователь при режиме Testing. Реальные вход и синхронизация не проверены.
3. После настройки Resend пользователь регистрируется с телефона, проверяем доставку шестизначного кода, сохранение задачи/события и перезагрузку. Не создавать вымышленные пользовательские учётные записи в рабочей базе и не обходить подтверждение почты.
4. OpenAI key пока отсутствует. Модель gpt-5.6-luna не подтверждена для OpenAI API; перед подключением проверить официальную документацию/доступные модели. AI пока не готов.
5. Настроить копии вне сервера и согласовать хранение. Автоматического удаления резервных копий пока нет.
