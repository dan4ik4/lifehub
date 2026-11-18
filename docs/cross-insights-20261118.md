# Cross-module observations — 2026-11-18

Implemented the next requested AI item after import, diary reviews and monthly finance analysis. The following product-decisions/push/APK/real-device health tasks remain separate and deferred as previously agreed.

## Product behavior

- Main dashboard now has **Что видно вместе** for Pro/active trial. User selects at least two modules, 14 or 28 completed days ending no later than yesterday, and expense currency when Finance is included. Health is not selected by default. Default local preview uses Planning and Habits; preview never calls the model.
- Daily indicators: recorded task completions (one-off Task timestamps and TaskOccurrence completion timestamps), count of habit check-in records, recorded sleep hours, recorded workout minutes, expense totals in one currency, and count of diary entries. Habit counts include zero-value check-ins and are explicitly not a count of fulfilled habits. Deleted parent tasks/habits and deleted records are excluded. Historical archived habits may still contribute their nondeleted check-in history.
- No query of unselected module data. Diary text/titles, task and purchase names/notes, medications, weight and original bank files are not loaded for this analysis. Day and timestamp boundaries use the owner's timezone; sleep belongs to its wake-up date.
- Connected device sleep is used only for the currently enabled provider in the owner's current timezone. Manual sleep takes precedence for that date. Overlapping/invalid manual sleep days are excluded with a visible note and are not silently replaced by device values. This does not configure or test new mobile health integrations.
- Missing days remain absent. No zero activity, spending or missed habits are inferred. Each pair uses only common recorded dates, at least eight days total. The first varying indicator is split below vs at-or-above its own median, requiring at least three days per group; if this fails, the reverse orientation is attempted. Indicators within the same module are not compared.
- Daily values are rounded half-up to 0.01 before comparison, so evidence and group assignment agree. Median is displayed exactly for those rounded inputs (including a possible third fractional digit). The other indicator's group means are rounded for display. Equal means may be shown honestly; no nonzero relationship is invented.
- Comparisons are descriptive selected-record observations, not statistical significance, proven correlation or cause, and not medical/financial advice. No mood, diagnosis, emotional inference, treatment advice or automatic action is generated.
- Full deterministic comparisons and data coverage are available locally. Each comparison has an expandable daily evidence table and buttons opening the relevant module. Evidence links open the module, not a specific record editor or automatic day filter. Tables scroll inside their container on narrow screens.
- Separate per-request consent authorizes sending only precomputed comparison text, periods, medians/means and paired-day counts for selected modules to OpenAI. Health participation is explicitly stated when selected. Existing messages/modules preferences remain required. Daily evidence rows and individual records are not sent.
- AI only selects up to three supplied comparison IDs; the application renders original computed text and evidence. Unsupported/repeated IDs are rejected. No tools, invented narrative or causal explanation. One shared daily Pro AI request per generation attempt, no request for local previews/cached reads/insufficient data. Timeout 90 seconds, store=False, existing configured model.
- Bound: at most 2,000 source records of each queried kind per selected period. Excess input is rejected, not partially analyzed. No model call when common days/variation are insufficient.

## Cache and privacy

Migration 0018_cross_reviews adds an owner-scoped cache keyed by the selected period/modules/currency scope hash. It stores source hash, attempt state and chosen comparison IDs, not a duplicate raw source dataset. The source digest includes timezone, relevant versions/values and enabled health connection state.

GET recomputes the snapshot and hides mismatched cache output. POST checks the client's snapshot, reserves quota under the user lock, releases the DB during the provider call, then rechecks entitlement, preferences, account state, fresh data and attempt marker. Relevant changes during generation reject that result. A fresh processing reservation prevents duplicate requests; stale attempts can be retried and cannot overwrite newer attempts.

This uses refresh-time invalidation rather than adding callbacks to every module. Local data-change events, window focus and explicit refresh fetch fresh data and clear visible prior output; out-of-band edits are detected on the next refresh/read. It is not live push synchronization or a guarantee that no record can change immediately after a read. Returning to a different module/date/currency selection resets consent and uses a separately scoped cache.

User can delete only the selected overview, retaining source records. Account export/purge includes the cache. Privacy maintenance removes cache rows after 30 days since their last generation attempt; reads do not extend retention. Existing health/finance/calendar integration behavior remains unchanged.

## Validation

- Full backend: 307 passed, 6 PostgreSQL/Redis integration skips. Final targeted cross-module group: 17 passed. Covers exact groups/means/evidence, missing days and no variance, sub-cent median display, ownership/currency, unselected-module query exclusion, explicit consent/Pro/preferences, cached quota, stale requests/processing/retries, unsupported IDs, source changes and consent revocation during generation, enabled device/manual precedence/conflicts, completion/check-in/workout/diary counts, timezone boundaries, input bounds, deletion/export/expiry and minimal provider payload.
- Frontend: 90 tests passed; TypeScript/final production build and Ruff passed. No new dependency.
- Isolated SQLite migration upgrade/check/downgrade to 0017/re-upgrade/check passed. Prepared deployment requires isolated PostgreSQL migration checks, exact finance arithmetic and a synthetic cross-module comparison smoke test before touching production data.
- Browser with synthetic account/provider: module selection, explicit health consent, generation, daily evidence expansion, contained mobile table at width 390 without page overflow, scope/currency cache reset/reopening, and source module navigation. Viewport reset; temporary tab not retained; QA servers stopped. Existing synthetic overview duplicate-key warnings also occurred; their pre-existing origin was not changed by this task. Screenshot under ignored output/qa/cross-insights.png.
- One real OpenAI request received synthetic aggregate comparisons only, selected supported IDs and passed output validation. No personal health/bank/diary data or production records were used.
- Archive/source parity and scans against actual local secret values and credential patterns passed.

## Latest combined release — prepared, NOT deployed

Includes cross-module observations, monthly finance analysis, CSV/PDF import and weekly diary review. Earlier packages remain intact. Install this batch instead of running the older batches in sequence.

- Directory: /home/lifeadmin/lifehub-release-20261118-insights/
- Archive: lifehub-20261118-insights-web-backend.tar.gz, 214 files.
- SHA256: 0fb3a0911f0ebcc31a24699417d097e518ca06da61d5679859c48e1c79080a8b.
- Remote SHA256 and bash syntax verified. Reviewed source-baseline checks, preserved environment/runtime config, sequential builds, isolated parser/PostgreSQL/finance/comparison checks, database/source/environment backup, additive migration and service/public API/served asset verification. Failure restores prior source/images without automatically restoring/downgrading user data.

```powershell
ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-release-20261118-insights/deploy-20261118-insights.sh"
```

Sudo remains interactive in the user's terminal; never ask for the password in chat. Do not claim deployed until CROSS_INSIGHTS_DEPLOYMENT_OK and independent public checks succeed. Check an authenticated synthetic overview after rollout before using real personal data.

API reference: https://developers.openai.com/api/docs/guides/structured-outputs .
