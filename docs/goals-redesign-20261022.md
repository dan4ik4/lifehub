# Goals and habits redesign — 2026-10-22

User confirmed deployment. Public checks: / and /health/ready returned 200; served bundle index-DO0Qq_kt.js contains goal tracking UI (target_value, contributes, gh-goals, gh-calendar). Authenticated production actions and database schema were not independently inspected in this follow-up. GitHub not pushed. Release: lifehub-20261022-goals-web-backend.tar.gz.

One main screen with daily progress, habit checks, goal cards, Add chooser and Statistics modal. Numeric checkins are total per day, with zero to undo. Goal relationship visible in both directions; create linked habit from a goal or choose a goal in an existing habit. Existing milestone/task detail remains under goal additional details. Mobile layouts checked at 390 and 320 pixels; desktop 1365 pixels. Temporary synthetic QA servers stopped and tab closed.

Migration 0013_goal_tracking adds nullable target, manual baseline, unit and explicit habit contribution opt-in. Displayed total is baseline plus all stored checkin values of currently linked non-deleted contributing habits with matching units. Retrying daily mark replaces its value, never adds twice. Unlink/delete excludes that habit contribution; archive preserves contribution. Link form discloses this. This is progress tracking, not a bank transfer or finance ledger transaction. Goal deletion unlinks habits. Owner/version/Pro restrictions retained. Older forms preserve omitted numeric settings. Dashboard and assistant context use calculated progress.

Monthly statistics use current schedule and active habits; schedule revisions are not historized. Future, unscheduled and pre-creation dates excluded. Free history remains 30 days; inaccessible dates neutral. Goal/habit lists paginated, history requests batched by eight. Ordinary goals retain manual progress; numeric goals use measured totals.

Validation: backend full suite 207 passed, 6 integration skips requiring PostgreSQL/Redis; migration roundtrip passed; frontend 73 passed; TypeScript/build/Ruff passed. Browser checked create goal 1000 zł with 240 initial, link habit, mark 10 -> 250 / 1000 (25%), daily progress, mobile month view. Screenshot: C:/Users/danei/OneDrive/Документы/ChatGPT/lifehub/goals-preview.png.

Deploy command: ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-release-20261022-goals/deploy-20261022-goals.sh"

Script backs up DB/config/source, verifies migrations in isolated PostgreSQL, checks new columns and runtime readiness. User reports deployment completed; public availability and frontend release independently verified.
