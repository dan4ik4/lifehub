# Full product implementation — 2026-10-02

User authorized implementing remaining Figma requirements in order, collecting ambiguities at the end. Reference: Life Hub FigJam XeDJPNn8P1S8ZcwAxjcpur, Development takes priority over Back when they conflict. This is a working expansion, not a claim that every Figma integration is finished.

## Implemented
- Existing password/Google authentication, six-digit email codes, planning and Google Calendar retained.
- Dashboard: today's recurring plans, habit check-ins, recent sleep, books in progress, monthly finances and budget remainder. Owner/module-scoped; manual/focus refresh.
- Goals/habits: Free one active goal and three habits, boolean/count/duration, weekdays, reminders, archive, check-ins, 30/90/365-day history (older history Pro). SMART guide; Pro milestone progress/edit/delete, task/habit links. Manual goal progress.
- Health: sleep/quality, workouts, weight, kg/lb profile preference, charts and Pro target. Pro custom workout programs with 110-name local exercise catalog, manual nutrition totals, medication schedule/intake tracking. No medical recommendations.
- Finance: manual income/expenses, custom categories Pro, monthly budgets with >80%/>100% alerts, recurring subscription schedules, savings/history, savings goals/monthly estimate, debts/partial payments/archive. Decimal amounts preserved as strings. Totals stay separated by currency.
- Books/diary: Open Library search/cache and direct cover URLs, unlimited book statuses/progress/rating, Pro notes/year/genre statistics; dated diary feed/calendar and Pro search.
- Browser Push: encrypted subscriptions, VAPID, service worker and opt-in setting; reminders for plans, habits, medication, subscription/debt due dates and budgets. Durable deduplication, bounded retries and source/entitlement recheck before delivery. Device logout unsubscribes. Private content is omitted from notification bodies.
- Profile: private normalized avatar, asynchronous encrypted JSON/CSV exports with expiry and readiness email, password-confirmed deletion with 30-day grace. Administrator restoration utility defaults to dry run.
- New accounts choose three Free modules. Existing selections and all account plans preserved.
- Eight schema revisions total (0001 through 0008); incremental migrations preserve existing records.
- Existing planning AI concurrent replay deadlock fixed by consistent user-before-command lock order.

## Verification and release state
- Full isolated PostgreSQL/Redis suite: 165 passed after fixing the planning AI race. No production data or third-party API credentials used in tests.
- SQLite migration parity and upgrade/downgrade/upgrade passed. PostgreSQL upgrade/downgrade/upgrade and Alembic metadata parity passed.
- Frontend TypeScript/Vite build and 59 tests passed, including exact formatting of large monetary values. Latest dashboard budget check: 10 passed / 1 PostgreSQL-only skip locally.
- Browser QA in a disposable local account: login, habit creation/check-in, expense save/totals, diary save/calendar counts, kg/lb preference and weight entry. Narrow viewport had no horizontal page overflow.
- Production release is pending at this checkpoint; see deployment-progress.md for the verified release outcome.
- Do not stage unrelated existing output/presentation-pl.

## Remaining requirements needing decisions/access
1. New AI features: goals/habits assistance, nutrition parsing, financial parsing/forecast, diary weekly summary, cross-module insights and voice input. Automatic approval review rejected implementation of new OpenAI payloads containing health/finance data without explicit consent. Do not work around that rejection. Ask permission for the specific text/context sent to OpenAI and user-facing consent before implementation. Existing planning AI is unchanged in scope.
2. Apple Calendar/HealthKit/Health Connect and on-device ML Kit receipt OCR require deciding native platforms and providing developer access/build infrastructure. Current app is web React/TypeScript. No fake native sync.
3. Payments: provider, legal entity/country, current prices/currency and monthly/annual plans; historical Figma prices are marked obsolete. No fake checkout.
4. Habits: conflicting day cutoff at 23:00 vs midnight. Streak calculation/reset awaits the decision; dated check-ins work.
5. Existing planning-only Free users: allow one-time expansion to three modules or preserve restriction? No automatic selection or entitlement changes.
6. Finance: one base currency vs multicurrency with conversion/rate source. Current totals never mix currencies.
7. Social-only account deletion: provider reauthentication or six-digit email code; support/restoration contact and legal text details missing.
8. Google Calendar: one Pro connection needs reconnection after revoked refresh token; one Trial connection stopped on entitlement expiry. Worker itself is healthy. Verify Cloud Console OAuth Testing/Production status; do not bypass consent or grant plans.

## Operations
- Worker product maintenance every 30 seconds; original calendar/reminder polling retained.
- Back up database and environment before migrations; keep previous API/frontend images for rollback. Do not remove volumes.
- Generate VAPID via scripts/init_webpush.py on the server; retain key pair across releases.
- Export files expire after 24 hours; final account purge begins only after a user-requested deletion has aged 30 days. Production contained zero previously soft-deleted users before this implementation.
- Restore by confirmed UUID only with scripts/restore_user.py; dry run by default, --apply after identity verification.
