# Развёртывание Life Hub — 7 сентября 2026, 11:26 UTC

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
