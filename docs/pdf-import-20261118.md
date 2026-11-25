# PDF bank statements — 2026-11-18

User requested PDF import after finding PDF downloads in Pekao. Added it to the existing CSV workflow; direct banking APIs remain deferred.

## Using it

Open the assistant, choose **Выписка CSV / PDF**, enter a stable account name and its currency, select a bank PDF and consent to sending its extracted text to OpenAI. Check each proposed operation against the statement, edit if necessary, select it and confirm. PDF operations start unselected. Headers, balances and totals remain visible as excluded source blocks. Page numbers and the original text are displayed.

Supports downloaded PDFs with selectable text, up to 25 MB, 100 pages, 450,000 extracted characters, 5,000 nonblank text lines and 1,500 operations. Long statements process in the background. Reopen a running or completed import from the recent imports list. Password-protected PDFs and image-only pages require a readable copy from the bank. Synthetic tests cover a 36-page statement with 144 operations.

## Implementation

- `POST /api/v1/finance/pdf-imports` returns a preview or a processing record. `GET /api/v1/finance/csv-imports/{id}` reads its current status or finished preview. Existing confirmation endpoints handle both formats. Migration 0022 adds the encrypted PDF processing payload and its worker lease.
- Shared Planning/Finance entitlements, messages/modules preferences, explicit per-file consent, quota, owner scoping, idempotency, atomic confirmation and duplicate markers. CSV/PDF imports of the same account share duplicate detection. A bank ID is preferred; otherwise canonical date/amount/currency/title plus occurrence counts are heuristic. Different descriptions, formatting or missing bank IDs may defeat cross-format matching; review duplicates and totals.
- A disposable pypdf worker extracts text without writing the upload to disk. Linux worker limits are 512 MiB address space, 25 CPU seconds and 40 seconds wall time. Page content streams are capped at 10 MB. An encrypted or unreadable page stops extraction for the whole file.
- The configured OpenAI model receives bounded sections of extracted text. Each section is checked for complete line coverage. The next section reprocesses the last few lines, starting at the beginning of any transaction that overlaps the boundary. The full preview is published once all sections have passed validation.
- The model must partition every extracted line into ordered, nonoverlapping source blocks. Missing/repeated/truncated coverage rejects the result. Dates, titles, amounts, currency and optional IDs must occur in the assigned source block. Python parses dates and Decimal amounts; numeric boundaries prevent dropping a minus or fractional part. Unknown direction and unverifiable fields remain visible as invalid, unimportable rows. AI still interprets layout, transaction direction for unsigned columns, categories and excluded blocks; user review remains necessary.
- Original PDFs stay in memory during extraction. Pending extracted text and intermediate results are encrypted, and the worker clears them after success or failure. Existing privacy maintenance expires previews after 24 hours. Confirmed operations and duplicate markers persist.
- PDF uploads account for base64 overhead when enforcing the 25 MB file limit. Confirmation requests allow up to 4 MB of JSON. CSV retains its 100-operation limit.

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
