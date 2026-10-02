# Life Hub

Личное пространство с авторизацией и пятью модулями: планирование, цели и привычки, здоровье, финансы, книги и дневник. Бэкенд — Python/FastAPI, PostgreSQL, Redis и отдельный worker. Фронтенд — React/TypeScript.

Новые аккаунты Free выбирают три модуля; Pro открывает все. Существующие наборы модулей сохраняются. ИИ сейчас работает в планировании; расширение ИИ, оплата, Apple и нативные интеграции ещё не завершены. Полный статус и вопросы: [docs/full-product-progress.md](docs/full-product-progress.md).

Интерфейс и его настройки: [docs/frontend.md](docs/frontend.md).

## Запуск

Нужны Python 3.13+ и Docker Desktop с Linux containers. Для разработки фронтенда вне Docker нужны Node.js 24 и pnpm 11.19.0.

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
./.venv/Scripts/python.exe scripts/init_env.py
```

Если `.env` уже существует, скрипт оставляет его без изменений. Он создаёт отдельные случайные JWT/OTP secrets, ключ шифрования календарных токенов и пароль локальной БД; значения не выводятся в консоль. На этой машине `.env` и локальное окружение уже подготовлены.

Заполните параметры внешних сервисов в `.env` (описаны ниже). БД и Redis запускаются отдельно:

```powershell
docker compose up -d db redis
./.venv/Scripts/python.exe -m alembic upgrade head
./.venv/Scripts/python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log --no-proxy-headers
```

В другом терминале запустите worker:

```powershell
./.venv/Scripts/python.exe -m app.workers.scheduler
```

Вариант полностью в Docker:

```powershell
docker compose up --build -d
```

Приложение в Docker: [Life Hub](http://127.0.0.1:5173). API: [Swagger](http://127.0.0.1:8000/docs), [ReDoc](http://127.0.0.1:8000/redoc), [OpenAPI JSON](http://127.0.0.1:8000/openapi.json). Проверки процесса и зависимостей: `/health/live`, `/health/ready`.

Для разработки интерфейса при работающем API:

```powershell
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Откройте [http://127.0.0.1:5173](http://127.0.0.1:5173). Если этот порт уже занят Docker-фронтендом, сначала выполните `docker compose stop frontend` из корня проекта. Vite и Docker-фронтенд проксируют `/api` к бэкенду: браузер работает с одним origin, отдельная настройка CORS для этого запуска не нужна.

Для внешнего доступа используйте HTTPS reverse proxy и настройте `LIFEHUB_ALLOWED_HOSTS`; `LIFEHUB_CORS_ORIGINS` нужен при отдельных origin фронтенда и API. По умолчанию порты доступны только локально. Приложение использует Bearer-токены. Веб-клиент хранит реальные токены в `sessionStorage` вкладки, без постоянного сохранения в `localStorage`. Если прокси передаёт IP клиента, доверяйте forwarded headers только адресу этого прокси, чтобы сохранить корректность лимитов по IP.

## Что реализовано

**Авторизация:** предварительная регистрация, подтверждение email шестизначным OTP, повторная отправка, login, Google/Apple ID token verification, JWT access/refresh, ротация refresh с обнаружением повторного использования, logout, восстановление и смена пароля, OTP-смена email, чтение и обновление минимального профиля.

**Планирование:** задачи и отдельные состояния их повторений, выполнение/отмена выполнения, календарь дня/недели, события, RRULE, удаление вхождения/будущих вхождений/серии, напоминания, системный список «Покупки», пользовательские списки, массовое добавление пунктов, версии объектов, Free/Trial/Pro-проверки, Google Calendar и Apple device bridge. Быстрый ввод через Luna обслуживает только команды планирования.

**Веб-интерфейс:** вход и регистрация, ввод шестизначного кода, восстановление пароля, настройка имени и часового пояса, раздел «Мой день» с фильтрами задач, календарь, списки, ИИ-ввод, настройки профиля и подключений. Free выбран по умолчанию; пробные 72 часа запускаются только явным выбором пользователя. Кнопка «Сначала осмотреться» включает отдельное демо с примерами в `localStorage`; оно не создаёт реальный аккаунт и не отправляет запросы внешним провайдерам.

Запросы к объектам ограничены владельцем. Чужой UUID возвращает 404. Привилегии проверяет бэкенд, включая команды ИИ и фоновые задания. Ошибки используют единый формат:

```json
{"error":{"code":"version_conflict","message":"Resource was changed by another request","details":[]},"trace_id":"..."}
```

## Правила авторизации

Источник при расхождениях — страница «Разработка», как уточнил заказчик.

- Email нормализуется `trim + lowercase`. Уникальность email действует среди аккаунтов с паролем. Google/Apple создают отдельные аккаунты по identity провайдера и не объединяются по совпавшему email.
- Пароль: минимум 8 символов, заглавная и строчная буквы, цифра. Argon2; пароли и коды не возвращаются в API и не записываются в логи.
- OTP: 6 цифр, 10 минут. Предварительная регистрация: 12 часов, 5 неверных попыток на код, **3 отправки всего на одну регистрацию, включая первую**, пауза 60 секунд. Исчерпание попыток/запрос четвёртой отправки инвалидирует старую проверку; новую регистрацию можно начать с новым `challenge_id` после паузы 60 секунд от последнего письма. Блокировки email на 12 часов нет. Общие лимиты по IP продолжают действовать.
- Access JWT: 15 минут. Refresh JWT: 30 дней, ротация на каждом обновлении. Повторное использование отзывает семейство refresh. Сброс/смена пароля отзывает все refresh пользователя; уже выданные access действуют до своих 15 минут.
- После 5 неудачных входов email блокируется на 15 минут. Лимиты по IP/email и `Retry-After` реализованы через Redis; при отказе Redis защищённые операции возвращают 503.
- `forgot-password` всегда возвращает нейтральное 202, в том числе для отсутствующего/social-only аккаунта. У social-only аккаунтов нет парольного восстановления или добавления пароля.

Регистрация:

```http
POST /api/v1/auth/preregister
Content-Type: application/json

{"email":"user@example.com","password":"CorrectPassword9"}
```

Ответ 202 содержит `challenge_id` и сроки. Подтверждение:

```json
{"challenge_id":"UUID-ИЗ-ОТВЕТА","otp":"123456"}
```

Это тело для `POST /api/v1/auth/confirm`. Код приходит только на почту; `123456` — пример, а не работающий универсальный код. Имя необязательно при preregister, задаётся после регистрации через `PATCH /api/v1/users/me` (до 50 символов), согласно «Разработке».

**Окончательный контракт восстановления:**

```http
POST /api/v1/auth/reset-password
Content-Type: application/json

{"email":"user@example.com","code":"123456","new_password":"NewPassword9"}
```

Email добавлен для однозначной привязки шестизначного кода. Ссылки с reset token не используются. `/pre-register` и `/send-code` поддерживаются как совместимые алиасы `/preregister` и `/resend`.

Google social request: `{"provider":"google","token":"ID_TOKEN"}`. Apple: дополнительно `nonce` — исходное случайное значение, SHA256 которого было передано Apple при запросе входа. Проверяются подпись JWKS, issuer, audience, expiry, provider subject и подтверждённый email. Apple first-login name задаётся через `PATCH /users/me`.

## Доступ и минимальный профиль

`PATCH /api/v1/users/me` принимает `name`, `timezone`, `free_modules`, `plan` (`free`/`trial`) и `onboarding_completed`. Это минимальная поддержка состояния пользователя, необходимая двум модулям; отдельного billing-модуля нет.

```json
{"name":"Даниил","timezone":"Europe/Warsaw","free_modules":["planning"],"plan":"free","onboarding_completed":true}
```

Новый onboarding выбирает только `["planning"]`. Для совместимости API также принимает прежние три разных кода из `planning`, `goals_habits`, `health`, `finance`, `books`; `books_diary` — алиас `books`. Старый выбор аккаунта сохраняется. Один другой модуль, два, четыре модуля или дубли не принимаются. Завершить onboarding без допустимого выбора нельзя. Сохранённый Free-выбор неизменяемый, в том числе на Pro.

Явный выбор `plan=trial` активирует 72 часа один раз; срок вычисляет сервер. При завершении onboarding вместе с trial должен быть уже сохранён или передан допустимый `free_modules`. `plan=pro` и `trial_ends` от клиента не принимаются. Подписку Pro впоследствии должен назначать доверенный billing backend; интерфейс не имитирует оплату. Тесты Pro используют изолированные тестовые аккаунты.

Если Free-пользователь не выбрал planning, ответ — `403 module_locked`. Повторы, приоритеты, дополнительные списки и синхронизация требуют Pro/активный Trial: `403 pro_required`. После Trial проверка срока действует сразу, независимо от worker.

## Время, повторы, версии

Все datetime-запросы содержат смещение (`Z` или `+02:00`), `timezone` — имя IANA. БД хранит UTC. `all_day` использует местную полночь; конец многодневного события исключающий. Если timezone не передан при создании, используется timezone пользователя.

Повтор хранится одной RRULE. Таблицы occurrences/exceptions хранят только состояния и исключения. Календарный интервал полуоткрытый `[from,to)`, объединяет задачи и развёрнутые события. Добавленный `occurrence_at` в event response однозначно адресует вхождение.

```http
DELETE /api/v1/planning/events/{event_id}?scope=this&occurrence_at=2026-09-07T08%3A00%3A00Z
```

`this` и `future` требуют `occurrence_at`; `all` удаляет серию. PATCH задач/событий/пунктов списка требует текущую `version`; устаревшая версия возвращает 409. Двойное выполнение задачи возвращает `409 already_completed`.

Технические пределы защищают API: календарь до 93 дней; до 5000 развёрнутых вхождений и 50000 просмотренных кандидатов RRULE; не более 10 напоминаний на объект и 100 пунктов в bulk. Большой/слишком сложный запрос возвращает 422. Лимиты и допустимые фильтры также видны в OpenAPI.

## Напоминания

Тело напоминания: ровно одно из `trigger_at` или `offset_minutes`, плюс `channel=push|email`. Offset задачи отсчитывается от `due_at`, иначе от `start_at`; у события — от начала. Worker пропускает удалённые и выполненные вхождения, учитывает доступ и повторяет неуспешную доставку.

Email доставляется через Resend. Для push задайте HTTPS `LIFEHUB_REMINDER_WEBHOOK_URL` и `LIFEHUB_REMINDER_WEBHOOK_TOKEN`. Это интерфейс доставки к сервису push, который отправляет на устройства через FCM/APNs. Payload содержит `reminder_id`, `user_id`, `entity_type`, `entity_id`, `title`, `notes`, `occurrence_at`; заголовки `Authorization: Bearer ...` и `Idempotency-Key`. Принимающий сервис должен надёжно поставить сообщение в очередь и исключить дубли по ключу перед ответом 2xx. Без настроенного транспорта напоминание не помечается доставленным.

## Календарная синхронизация

Сначала отправляются изменения Life Hub. Загрузка внешних изменений разрешена минимум через секунду после окончания отправки. По умолчанию цикл запускается каждые 300 секунд (`LIFEHUB_CALENDAR_SYNC_INTERVAL_SECONDS`), worker проверяет очередь раз в секунду. Ручная синхронизация возвращает 202 и ID задания; состояние можно получить по API.

Параллельные задания используют lease и блокировки. Сопоставления external ID/ETag/version препятствуют дублированию и повторной отправке импортированных изменений. Отправляемые локальные изменения имеют приоритет в текущем цикле; более поздние локальные изменения сохраняются для следующего прохода.

В веб-интерфейсе Google возвращает пользователя на `<origin>/calendar/callback`, например `http://127.0.0.1:5173/calendar/callback`. Этот точный адрес должен быть указан в `LIFEHUB_CALENDAR_REDIRECT_URIS` и в Authorized redirect URIs Google OAuth-клиента. Клиент проверяет `state` и отправляет полученный код в авторизованный POST бэкенда. Путь backend `/api/v1/planning/calendar-connections/google/callback` не является адресом браузерного возврата.

Подробные Google OAuth и Apple EventKit/Flutter контракты: [docs/calendar-sync.md](docs/calendar-sync.md). Apple Calendar подключается через клиент на iPhone: браузер не имеет доступа к EventKit. В этом проекте реализованы серверный device-протокол и его отображение в веб-настройках; приложения iPhone пока нет. Без подключённого клиента Apple-задание ожидает его подтверждения.

## Быстрый ввод через Luna

```http
POST /api/v1/ai/chat
Authorization: Bearer ACCESS_TOKEN
Idempotency-Key: UNIQUE-REQUEST-ID
Content-Type: application/json

{"context":"planning","mode":"command","message":"Завтра в 16:00 к врачу"}
```

Модель возвращает типизированный черновик одной команды: `create_task`, `update_task`, `create_event`, `add_list_items`. Его проверяют обычные сервисы планирования. При неоднозначности возвращается `422 ambiguous_command` без записи объектов. Данные других модулей модели не передаются.

Free: 3 сообщения в сутки; Trial/Pro: 50. Сброс по UTC-полуночи. Резервирование лимита атомарно до модели; отказ/ошибка модели тоже считается сообщением. Один и тот же `Idempotency-Key` и тело возвращают сохранённый результат без нового вызова/записи. Повтор ключа с другим телом — 409. После прерванного процесса команда считается незавершённой, а по истечении 2 минут — ошибкой; новый запрос использует новый ключ.

Используется [Responses API со Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), `store=false`, ограничение ответа и таймаут. Модель по спецификации — `gpt-5.6-luna`, задаётся через `LIFEHUB_OPENAI_MODEL`. Без ключа API явно отвечает `503 provider_unavailable`.

## Настройка внешних сервисов

| Функция | Параметры `.env` |
|---|---|
| Email OTP/reset/reminders | `LIFEHUB_RESEND_API_KEY`, `LIFEHUB_EMAIL_FROM` с проверенным доменом |
| Google login | `LIFEHUB_GOOGLE_CLIENT_IDS` — JSON-массив client ID |
| Apple login | `LIFEHUB_APPLE_CLIENT_IDS` — JSON-массив допустимых audience |
| Google Calendar | `LIFEHUB_GOOGLE_CALENDAR_CLIENT_ID`, `LIFEHUB_GOOGLE_CALENDAR_CLIENT_SECRET`, `LIFEHUB_CALENDAR_REDIRECT_URIS` |
| Apple Calendar | Allowlisted redirect URI и Flutter-клиент по описанному device-контракту |
| Luna quick add | `LIFEHUB_OPENAI_API_KEY`, `LIFEHUB_OPENAI_MODEL` |
| Push reminders | `LIFEHUB_REMINDER_WEBHOOK_URL`, `LIFEHUB_REMINDER_WEBHOOK_TOKEN` |

Для Google/Apple-входа в браузере дополнительно нужны публичные `VITE_GOOGLE_CLIENT_ID`, `VITE_APPLE_CLIENT_ID`, `VITE_APPLE_REDIRECT_URI`. При разработке они задаются в `frontend/.env.local`, при Docker-сборке — в корневом `.env` и передаются через build args. Ключи API и client secrets во фронтенд не передаются. Подробные значения и порядок подключения — [docs/frontend.md](docs/frontend.md).

Ключи внешних аккаунтов не создаются автоматически. Без них соответствующие подключения недоступны; успешная интеграция не имитируется. После изменения серверного `.env` пересоздайте процессы: `docker compose up -d --force-recreate api worker`. Изменение публичных `VITE_`-настроек требует перезапуска Vite или пересборки Docker-фронтенда: `docker compose up -d --build frontend`.

Автоматические тесты проверяют интеграционные протоколы на управляемых ответах провайдеров; реальные письма, Google/Apple-аккаунты и платные запросы модели в тестах не вызываются.

## Проверки

Результаты последних запусков и границы проверки — [docs/verification.md](docs/verification.md).

```powershell
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe scripts/check_postgres.py
./.venv/Scripts/python.exe -m ruff check app tests scripts
```

Проверки фронтенда из папки `frontend`:

```powershell
pnpm test
pnpm build
```

Тесты фронтенда покрывают сессию и обновление токенов, демо, часовые пояса и DST, раскладку календаря и сохранение расписания при редактировании. `pnpm build` также проверяет TypeScript.

`pytest -q` запускает изолированные SQLite-тесты; специальные PostgreSQL/Redis-тесты без настроек пропускаются. `scripts/check_postgres.py` применяет миграции к локальной БД проекта и запускает весь набор в отдельных временных схемах PostgreSQL, а также настоящий Redis. Скрипт не очищает таблицы приложения. Включены гонки refresh/reset, версий и AI-idempotency; OTP/социальные токены; права; DST/RRULE; напоминания; синхронизация и повторная доставка Apple delta.

В файловой песочнице Windows pytest может требовать разрешения на временные каталоги; для обычного PowerShell это не требуется.

Спецификации: [Back](docs/figjam-back.txt), [Разработка](docs/figjam-development.xml). Актуальный программный контракт: [docs/openapi.json](docs/openapi.json). Начальная миграция: `migrations/versions/0001_initial_authentication_and_planning_.py`; её PostgreSQL DDL — [docs/schema-postgresql.sql](docs/schema-postgresql.sql).

## Уведомления и личные данные

Для Web Push выполните `python scripts/init_webpush.py --env-file .env.production` на сервере перед пересозданием API/worker. Скрипт не выводит ключи и не заменяет существующие. Значение `LIFEHUB_WEBPUSH_SUBJECT` по умолчанию — адрес приложения. Ключи не коммитятся. Разрешение на уведомления пользователь включает сам в профиле; включение или отключение сохраняется отдельно для браузера. Worker проверяет события каждые 30 секунд, повторяет неудачные доставки и исключает уже неактуальные напоминания. Планирование сохраняет собственную очередь напоминаний.

На iPhone/iPad Web Push требует приложение на экране «Домой»; см. [документацию WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/). Manifest включает standalone-режим; service worker не кэширует личные ответы API.

Экспорт JSON или CSV запрашивается в профиле, готовится worker, шифруется на сервере и доступен владельцу 24 часа. По готовности отправляется письмо без содержимого экспорта. Фото нормализуется в JPEG без исходных метаданных. Удаление аккаунта с паролем закрывает доступ сразу и очищает данные через 30 дней. Для восстановления после подтверждения личности администратор использует `python scripts/restore_user.py UUID`, проверяет результат и только затем запускает с `--apply`. Восстановление старых сессий не происходит. Для аккаунтов только Google/Apple способ повторного подтверждения ещё требует решения.
