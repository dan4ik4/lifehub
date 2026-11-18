# Assistant update — 2026-10-22

Implemented in the GitHub/lifehub working directory; no GitHub push.

- Calendar day/week initial position: one whole hour before the earliest visible timed event/task, midnight minimum, 08:00 when empty. Runs after loaded data, once for selected date/view.
- User-scoped server preferences for messages, media and other modules; settings available in profile and chat. Migration 0012_assistant_preferences. Revoked consent enforced server-side for configured accounts.
- Normalized photos persisted at useful resolution (up to 1600px, capped output bytes); history API still returns thumbnails. Follow-up context includes up to three recent stored photos from recent conversation, within seven days. Older historical previews cannot regain their original detail. Audio is not persisted.
- Atomic batches up to 100 actions, one quota charge, idempotent replay, rollback on any failure. Multiple occurrences of one series use baseline-version checks with internal version advancement.
- Immediate ordinary additions/edits/single deletions. One confirmation for multiple deletions, deletion of a recurring series, and whole-list deletion. Clarification remains for missing/ambiguous data.
- Allowlisted create/update/delete/duplicate records in health, finance, books/diary, goals and habits. Uses the existing resource validators, ownership/version and subscription checks in an outer transaction. Supports habit checkins, medication intakes and debt payments. Planning supports list create/rename/delete and item update/delete, as well as existing calendar/task actions. Module context is bounded to 30 recent records per resource, with truncation indicators.
- Explicit visible list delete button, including built-in shopping list. Deleted built-in list is not silently recreated.
- Open module refreshes after assistant mutations.

Limitations: existing Planning entitlement requirement for access to chat remains. An attempted change to that entry gate was rejected by automatic approval review; no weakening was applied. Pro users can access all supported module operations; each operation retains its module entitlements. Health Connect/HealthKit imported daily snapshots are not sent to OpenAI. A real OpenAI end-to-end call was not made during these tests; provider transport and structured schema are covered by mocked SDK tests.

Browser QA: temporary synthetic account and model on ports 8001/5173. Calendar with first event 12:00 scrolled to 11:00 (scrollTop 660). Persistent permission API worked; settings checked at 390x844. QA servers stopped afterward so no fake provider remains running.

Validation: full backend suite 200 passed, 6 PostgreSQL/Redis integration tests skipped; frontend 70 passed; TypeScript and production build passed; migration roundtrip included.

Release: output/releases/lifehub-20261022-web-backend.tar.gz
SHA256: f5d7f2ee888ac67cd77c1e2ac843c36bea700f6922890ccd188a893059f2d8e0
Uploaded with deploy-20261022.sh to /home/lifeadmin/lifehub-release-20261022/.
Remote bash syntax and checksum passed. User confirmed running deployment on 2026-10-22.
Independent public verification: / returned 200, /health/ready returned 200, and /api/v1/users/me/assistant-preferences returned 401 without authentication. Served assets index-CSrET2Yl.js and index-BtoHz7g4.css; JavaScript contains the new assistant-preferences integration.
Deployment is publicly verified. Authenticated real-provider end-to-end behavior was not tested on production.
