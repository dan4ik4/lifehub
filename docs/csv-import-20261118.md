# Bank CSV through AI — 2026-11-18

User selected CSV through AI as the interim finance workflow; direct bank APIs and Apple sign-in are deferred. This is the first piece of the remaining AI work. Weekly diary summaries, forecasting and cross-module insights are not implemented by this change.

## Implemented

- Chat opens a dedicated bank statement import dialog. Existing Planning/Finance entitlements and messages/modules consent are required. A separate visible checkbox authorizes sending the chosen CSV contents to OpenAI.
- Limits: 128 KB, 100 data rows, 30 columns and 1000 characters per cell. Semicolon/comma/tab delimiters, UTF-8/BOM, Windows-1250, Windows-1251 and UTF-16. A few leading metadata lines are supported. Unsupported layouts fail visibly; no silent first-100-row truncation.
- The model receives only the uploaded table, no unrelated health/module/history context, no tools, with store=False. It maps columns, categories and likely own-account transfers; Python extracts and validates original amounts/dates. Uses the existing configured OpenAI model and shared daily AI quota. No real OpenAI call made during validation.
- Every row remains visible, including excluded footer/transfer rows and row errors. Before confirmation, no finance transactions are created. User can edit valid row fields, deselect operations and explicitly override possible duplicates. Refunds are represented as income, not a reduction of the original expense.
- Exact Decimal server amounts and BigInt frontend totals, separated by currency. Positive/negative amount columns and separate debit/credit columns supported. Unknown direction/layout is rejected rather than invented.
- Owner-scoped previews, request replay and confirmation replay. User-row locks serialize confirmations on PostgreSQL. Bank reference IDs, otherwise canonical row fingerprints and occurrence counts, protect repeat/overlapping imports for the same named account. Manual transactions with identical date/title/amount/currency/kind are flagged as possible matches. Detection is heuristic without a stable bank ID; renaming an account changes the fingerprint scope. A duplicate may be added only through explicit override.
- Previews expire after 24 hours and are removed by privacy maintenance. Imported operations and durable duplicate markers remain; included in owner export and account purge. Original files are not stored, but preview rows contain source text until expiry.
- Migration 0014_csv_import creates finance_csv_imports and finance_csv_rows. Release packager now uses an explicit deploy-file allowlist, excluding local provisioning scripts.

## Validation

- Full backend regression: 226 passed, 6 PostgreSQL/Redis integration skips. After final edge cases, CSV group: 22 passed (19 overlap with the full run).
- Frontend: 88 passed; TypeScript and production build passed. Ruff passed.
- Isolated SQLite migration upgrade, model parity, downgrade to 0013, re-upgrade and parity passed. Deployment script additionally requires isolated PostgreSQL migration checks before touching production.
- Browser on a synthetic account/provider: file upload, explicit consent, preview, editing controls, transfer exclusion and confirmation saved two selected rows. Mobile width 390 checked. Temporary browser tab and QA servers closed. No real bank data or provider requests used. A React duplicate-key warning was observed from the synthetic application during QA; the import list uses unique database IDs and source indexes, and the warning's originating component was not established.

## Prepared release, NOT YET DEPLOYED

Uploaded to /home/lifeadmin/lifehub-release-20261118-csv/:

- lifehub-20261118-web-backend.tar.gz, 194 files, SHA256 6b9a7af61765a15cf20215c7f92c2f1c58bf959bafc3d34d715949a6f377e717.
- deploy-20261118-csv.sh and csv-baseline.json. Remote archive hash and bash syntax verified.

Script checks selected existing source hashes, preserves production environment/compose, builds sequentially, tests PostgreSQL migrations in an isolated container, backs up DB/source/environment, applies the additive migration, updates API/worker/frontend, verifies readiness, protected CSV API and publicly served CSV frontend. Failure restores previous source/images; never automatically downgrades or restores user data.

User must run sudo interactively; password must stay in their terminal:

```powershell
ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-release-20261118-csv/deploy-20261118-csv.sh"
```

After CSV_IMPORT_DEPLOYMENT_OK independently check public endpoints/assets, then verify an authenticated real-provider preview with a synthetic CSV before importing actual financial data. Do not claim deployed until that command succeeds. Existing bank layouts and actual model mapping still need real-provider evaluation.

API reference used: https://developers.openai.com/api/docs/guides/structured-outputs .
