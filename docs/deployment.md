# Сервер Life Hub

Адрес приложения: https://lifehapp.online. Сервер: Ubuntu 24.04, SSH `root@104.248.254.176`. Файлы находятся в `/srv/lifehub`. Исходники загружаются по SSH, GitHub не используется.

## Запуск и обновление

На сервере из `/srv/lifehub`:

```sh
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build
docker compose --env-file .env.production -f compose.production.yaml up -d --no-build --wait
docker compose --env-file .env.production -f compose.production.yaml ps
```

Перед обновлением рабочей базы выполнить `/bin/sh deploy/backup.sh`. Миграции запускает одноразовый контейнер migrate; API стартует только после их успешного завершения. Изменение VITE_GOOGLE_CLIENT_ID требует пересборки фронта. После изменения Caddyfile проверить и перезагрузить Caddy через `docker compose ... exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`, подставив полные параметры compose из команд выше.

## Настройки и сеть

`.env.production` содержит отдельные пароли базы, JWT/OTP секреты и ключ шифрования. Он исключён из Git и Docker build context. На сервере права 0600, каталог приложения 0700. Не выводить конфигурацию compose целиком: в ней раскрываются значения окружения.

Наружу опубликованы только 80/443 у Caddy. PostgreSQL, Redis, API и frontend не публикуют свои порты. Caddy напрямую передаёт `/api/*` и две проверки `/health/live`, `/health/ready` в API, остальные пути — во frontend. Uvicorn доверяет proxy-заголовкам только от адреса Caddy 172.30.81.2. Сеть edge использует 172.30.81.0/24; при переносе проверить отсутствие конфликта подсетей.

Caddy автоматически выпускает и обновляет сертификаты; его данные сохраняются в отдельных томах. Все постоянные сервисы имеют restart policy; Docker включён в автозагрузку. Логи ограничены 3 файлами по 10 МБ на сервис. HTTP access logs отключены, чтобы не записывать OAuth-коды из URL.

## Резервные копии

`deploy/backup.sh` сохраняет PostgreSQL в формате pg_dump -Fc в `/var/backups/lifehub`. Таймер lifehub-backup.timer предназначен для ежедневного запуска около 03:15 UTC и проверяется при установке. Удаления старых копий пока нет. Это копии на том же сервере: нужно отдельно настроить хранение вне сервера и срок хранения. Ключ шифрования из .env.production также необходим для восстановления интеграций. Никогда не выполнять `down -v` для рабочей базы.

## Внешние сервисы

Resend: домен отправителя lifehapp.online должен иметь статус Verified. Ключ Sending access достаточен для приложения; GET /domains с ним возвращает 401 restricted_api_key и не проверяет статус домена. Не заменять такой ключ на Full access только ради проверки.

Google: у существующего Web OAuth client добавить Authorized JavaScript origin `https://lifehapp.online`, Authorized redirect URI `https://lifehapp.online/calendar/callback`; включить Calendar API. Если приложение Google в Testing, добавить пользователя в Test users. Клиентский ID уже передаётся при сборке; секрет доступен только бэку. Реальный вход/синхронизация проверяются после настройки Google и участия пользователя.

OpenAI: ключ отсутствовал при первом запуске. AI не проверен и не готов к использованию. Перед подключением проверить API-идентификатор модели: существующий gpt-5.6-luna пока не подтверждён для OpenAI API.
