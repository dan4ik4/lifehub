# PDF bank statements — 2026-11-18

User requested PDF import after finding PDF downloads in Pekao. Added it to the existing CSV workflow; direct banking APIs remain deferred.

## Using it

Open the assistant, choose **Выписка CSV / PDF**, enter a stable account name and its currency, select a bank PDF and consent to sending its extracted text to OpenAI. Check each proposed operation against the statement, edit if necessary, select it and confirm. PDF operations start unselected. Headers, balances and totals remain visible as excluded source blocks. Page numbers and the original text are displayed.

Supports downloaded PDFs with selectable text, up to 5 MB, 15 pages, 60,000 characters, 1,200 nonblank text lines and 100 operations. Password-protected documents, image-only pages/scans, unreadable pages and oversized statements fail visibly. No OCR was added. Choose a shorter statement period if needed. Actual Pekao layouts still need evaluation with a representative statement; do not infer support for every bank layout from synthetic tests.

## Implementation

- `POST /api/v1/finance/pdf-imports` creates a preview. Existing recent-preview and confirmation endpoints under `/finance/csv-imports` handle both formats, preserving deployed CSV clients. Migration 0016 adds `source_format` with a CSV default to the existing preview table.
- Shared Planning/Finance entitlements, messages/modules preferences, explicit per-file consent, quota, owner scoping, idempotency, atomic confirmation and duplicate markers. CSV/PDF imports of the same account share duplicate detection. A bank ID is preferred; otherwise canonical date/amount/currency/title plus occurrence counts are heuristic. Different descriptions, formatting or missing bank IDs may defeat cross-format matching; review duplicates and totals.
- A disposable pypdf 7.1.1 worker extracts text without writing the upload to disk. Linux worker limits: 512 MiB address space, 15 CPU seconds and 20 seconds wall time; page content streams capped at 10 MB. Encrypted or unreadable pages reject the entire document rather than silently omitting a page.
- Only extracted, numbered source lines go to the configured OpenAI model. Structured output, no tools, `store=False`, 90-second timeout, shared daily quota. No unrelated module/history context or original PDF bytes are sent.
- The model must partition every extracted line into ordered, nonoverlapping source blocks. Missing/repeated/truncated coverage rejects the result. Dates, titles, amounts, currency and optional IDs must occur in the assigned source block. Python parses dates and Decimal amounts; numeric boundaries prevent dropping a minus or fractional part. Unknown direction and unverifiable fields remain visible as invalid, unimportable rows. AI still interprets layout, transaction direction for unsigned columns, categories and excluded blocks; user review remains necessary.
- Original PDFs are not persisted. Extracted preview text expires after 24 hours through existing privacy maintenance; confirmed operations and duplicate markers persist. Account export and purge include both formats.
- PDF POST requests allow up to 7,000,000 JSON bytes for base64 overhead, including a streamed-body bound. Other API paths retain the existing 1 MiB header limit. Frontend container proxy body size/timeouts accommodate PDF uploads; production Caddy talks directly to the API.

## Validation

- Full backend regression: 266 passed, 6 PostgreSQL/Redis integration skips. Subsequent focused PDF/CSV group: 49 passed; final PDF group after additional sign/fraction safeguards: 29 passed.
- Frontend: 88 tests passed; TypeScript and final production build passed. Ruff passed.
- SQLite migration upgrade/check/downgrade to 0015/re-upgrade/check passed. Deployment also requires isolated PostgreSQL migration checks and a parser smoke test inside the production Linux image before applying production migrations.
- Browser with synthetic account/provider: actual PDF file chooser/upload, consent, source pages, unselected proposals, confirmation saved two selected operations; 390px viewport had no horizontal overflow. Temporary tab/servers closed. Screenshot under ignored `output/qa/pdf-import.png`. The existing synthetic overview duplicate-key warning also appeared; its origin was not changed by this task.
- One real OpenAI request on a synthetic PDF extracted the two expected operations with exact dates, signs, amounts and currencies, with source coverage validated. Nothing was saved by that evaluation; no real bank statement, credentials or personal finance data was sent.

## Latest combined release — prepared, not deployed

Includes PDF, CSV and weekly diary review. This supersedes the earlier deployment commands for this batch; old packages remain intact.

- `/home/lifeadmin/lifehub-release-20261118-pdf/`
- `lifehub-20261118-pdf-web-backend.tar.gz`, 201 files.
- SHA256: `447bde03b2de84121a39bb18737dae23c5d7022bcfe3b48fb1bffe198bcaf0fd`.
- `deploy-20261118-pdf.sh` and `pdf-baseline.json` preserve runtime configuration, check reviewed source baselines, build sequentially, test the Linux parser and isolated PostgreSQL migrations, back up source/environment/database, apply additive migrations, recreate services and check public readiness/protected APIs/served frontend. On failure, restore old source/images without automatically restoring or downgrading user data.

```powershell
ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-release-20261118-pdf/deploy-20261118-pdf.sh"
```

Sudo password stays in the user's terminal. Do not claim deployment until `PDF_IMPORT_DEPLOYMENT_OK` and independent public checks succeed. Then evaluate an authenticated synthetic preview on production before using actual statements.

References: https://pypdf.readthedocs.io/en/stable/user/extract-text.html and https://developers.openai.com/api/docs/guides/structured-outputs .
