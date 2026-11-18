# Weekly diary review — 2026-11-18

Implemented the next AI feature after bank CSV import. Financial forecasts and cross-module insights remain future work.

## Behavior

- Books/Diary contains an on-demand seven-day review. User selects the final date; the preceding six dates are included. It is Pro/trial only, matching the existing product specification.
- Generation requires messages/modules permission and a separate visible checkbox authorizing transmission of the selected diary dates, titles and texts to OpenAI. No automatic generation, scheduling, notifications or habit creation.
- Model input contains only the current user's non-deleted diary records in the selected period. It excludes chat history, other modules and older diary entries. Bounds: 100 entries and 60,000 title/text characters, with explicit rejection rather than truncation. Empty/future/invalid periods never invoke the model.
- Server displays the actual entry count and recorded days. Missing days are not treated as inactivity or negative mood. Structured output: summary, highlights, recurring themes and one optional reflection question. Highlights/themes cite existing source IDs; themes require at least two distinct entries. Text is treated as untrusted data, no tools/actions are exposed, and the prompt excludes invented events, diagnoses and treatment/financial advice.
- Generated review is saved privately, keyed by user/period/source hash. Reopening uses the saved output without spending quota; each generation attempt uses one request from the existing shared daily AI quota. Failed/stalled attempts can be retried, with an attempt timestamp preventing late responses from overwriting a newer attempt.
- Diary create/edit/delete invalidates affected reviews, including writes made through the existing assistant executor. Post-provider checks revalidate the user, subscription, consent, exact source hash and reservation. Changing entries or revoking consent during generation prevents saving the response.
- Source buttons filter diary records to the cited day. User can delete only the review; diary entries remain. Reviews are included in account export and final account purge. No raw input snapshot is stored separately.
- Migration 0015_diary_review creates diary_weekly_reviews. Generic CRUD gained an optional after_delete hook used only by diary invalidation; other resources retain their existing deletion behavior.

## Validation

- Full backend: 239 passed, 6 PostgreSQL/Redis integration skips. Final diary group: 12 passed (10 overlap with the full run), including source changes, consent revocation, ownership, exact cache/quota behavior, outside-period edits, moved entries and assistant-driven edits/deletions.
- Frontend: 88 tests passed; TypeScript/production build and Ruff passed.
- Isolated SQLite migration upgrade/check/downgrade/re-upgrade/check passed; deployment requires isolated PostgreSQL migration checks before production migration.
- Browser on a synthetic account/provider: consent, creation, source-day navigation, responsive width 390 with no horizontal overflow, and disappearance of the old review after editing a source entry. Temporary tab and QA servers closed. Real OpenAI and personal diary contents were not used in tests. Existing synthetic-app React duplicate-key warnings were observed, as in prior CSV QA; response checks found no duplicate resource IDs, and the originating pre-existing component was not established.

## Combined release prepared, NOT DEPLOYED

The new package includes both CSV import and diary review. The previous CSV-only archive remains intact.

- Upload directory: /home/lifeadmin/lifehub-release-20261118-diary/
- Archive: lifehub-20261118-diary-web-backend.tar.gz, 198 files.
- SHA256: 952e55ad3253ce2321d374a41ce2efc7309271123d2500bac3e4f0152a70f33f.
- Remote hash and bash syntax verified. Selected source baselines accept either the verified pre-CSV snapshot or the prepared CSV version; unexpected server edits abort the update.
- Script preserves production settings, builds sequentially, checks migrations on isolated PostgreSQL, backs up source/settings/DB, applies additive revisions, updates services and verifies public readiness, protected CSV/review APIs and served frontend code. Failed deployment restores old source/images without restoring/downgrading user data.

Run when ready to deploy this batch (sudo password stays in the user's terminal):

```powershell
ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-release-20261118-diary/deploy-20261118-diary.sh"
```

After DIARY_REVIEW_DEPLOYMENT_OK, independently verify public assets/endpoints and then evaluate authenticated real-provider behavior using synthetic entries. Do not claim production deployment or real-provider accuracy from mocked tests.

API reference used: https://developers.openai.com/api/docs/guides/structured-outputs .
