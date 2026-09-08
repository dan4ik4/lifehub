# Calendar synchronization

The Python backend implements Google Calendar synchronization and an Apple Calendar device bridge. Run the API and the separate scheduler after applying migrations. All endpoints below require `Authorization: Bearer <access_token>`, Planning access, and Pro or an unexpired trial. Disconnect remains available without Pro when Planning is accessible.

## Configuration and scheduling

Configure these environment variables in `.env` or your deployment:

| Setting | Purpose |
| --- | --- |
| `LIFEHUB_ENCRYPTION_KEY` | Fernet key protecting Google credentials and the OAuth PKCE verifier in PostgreSQL. |
| `LIFEHUB_GOOGLE_CALENDAR_CLIENT_ID` | Google OAuth web application client ID. |
| `LIFEHUB_GOOGLE_CALENDAR_CLIENT_SECRET` | Its client secret. |
| `LIFEHUB_CALENDAR_REDIRECT_URIS` | JSON list of exact allowed client callback URIs, for example `["https://app.example.com/calendar/callback"]`. |
| `LIFEHUB_CALENDAR_SYNC_INTERVAL_SECONDS` | Automatic interval after a completed or terminally failed job; default `300`, minimum `10`. |
| `LIFEHUB_WORKER_POLL_SECONDS` | Worker polling interval; default `1` second. |

Start the worker with `python -m app.workers.scheduler`. It runs calendar jobs, reminders, and expired-auth cleanup. Auth cleanup runs on startup and then hourly. PostgreSQL owns queues, leases, retries, mappings, and cursors; restarting the worker does not erase them.

Each job sends pending Life Hub changes outward first. After **all outbound writes succeed** (or Apple acknowledgements arrive), the worker saves `push_completed_at` and schedules the inbound phase no earlier than `push_completed_at + 1 second`. This is a persisted phase transition, with no sleep inside API requests. Actual execution can be later because of polling, rate limits, provider availability, or an offline device.

A pending Life Hub edit wins the outbound phase. Google ETag conflicts cause the adapter to fetch the latest ETag and retry that local snapshot. If a user changes a local event after its outbound snapshot was sent, the following inbound phase preserves the newer local version; the next job exports it. Inbound writes also compare the database version before updating. Content fingerprints suppress echoes of our own outbound changes. The one-second separation establishes direction and ordering; the version checks protect changes made during that interval.

Automatic scheduling and workers enforce the active Pro/trial entitlement. Only one job can be active per connection. A worker claims a job with a persisted two-minute lease and renews it around provider calls. Retryable errors receive bounded backoff and five attempts per phase. An offline Apple device is awaited for up to one day. Provider credential errors set `status=reauth_required`; clients must reconnect.

## Google Calendar

Enable the Google Calendar API and configure the exact redirect URI in the Google OAuth application. The integration requests event read/write access and calendar-list read access, uses PKCE and a one-use state expiring after ten minutes, and synchronizes the account's primary calendar. Access and refresh tokens never appear in connection responses.

1. `POST /api/v1/planning/calendar-connections/google/start`

   ```json
   {"redirect_uri":"https://app.example.com/calendar/callback"}
   ```

2. Open the returned `authorize_url`. Google redirects to the configured client URI. The client forwards the returned code and state to `POST /api/v1/planning/calendar-connections/google/callback`:

   ```json
   {"state":"<state returned by start>","code":"<Google authorization code>"}
   ```

3. The `201` response contains the connection ID. The worker schedules the first sync automatically. To request another job, send `{}` to `POST /api/v1/planning/calendar-connections/{connection_id}/sync`. A `202` response contains `job_id`; an already active job produces `409 sync_running`.

4. Read `GET /api/v1/planning/calendar-connections/{connection_id}/sync/{job_id}` until the status becomes `done` or `failed`.

Outbound inserts use a persisted deterministic external ID, so retrying an uncertain insert does not create another event. Updates use ETags. Soft-deleted local events become provider deletions. Incremental inbound sync saves Google's sync token; a `410` response restarts a full sync, including reconciliation of deleted remote events. Timed and all-day events, a single RRULE, EXDATE cancellations, and changed/cancelled recurring instances are normalized into the local event/exception model. All-day event ends are exclusive and use the calendar's timezone.

Special Google event types, non-editable invitations, and series with recurrence forms beyond the single-RRULE contract are imported with `external_read_only=true`. RDATE/EXRULE and multiple-RRULE series are outside the editable single-RRULE model; the local view retains the first RRULE and supported exclusions. Such events must be managed in Google Calendar.

`GET /api/v1/planning/calendar-connections` lists active or reconnect-required connections. Reconnect by repeating start/callback when status is `reauth_required`. Same-calendar reauthorization preserves mappings and the cursor. Selecting another calendar/account retains previous imports as detached read-only history and resets mappings for the new calendar. `DELETE /api/v1/planning/calendar-connections/{connection_id}` stops jobs and clears server credentials; Google revocation is attempted as well.

## Apple Calendar: Flutter / EventKit contract

Apple Calendar access runs on the user's device through EventKit. The backend does not pretend that Apple exposes a Google-style calendar OAuth API. Flutter requests calendar permission, reads/writes EventKit, maintains a durable event-ID mapping, and exchanges normalized changes with the backend. This repository supplies the backend and protocol only.

The current contract binds one Apple connection to one `device_id` and one selected `calendar_id`. Generate and persist a stable application installation identifier as `device_id`. Maintain a stable `external_id` for each calendar event and a durable mapping to its current EventKit identifier. The server treats `external_id` as an opaque string. Reinstalling or switching the bridge device requires reconnecting.

### 1. Request permission and register the connection

Call `POST /api/v1/planning/calendar-connections/apple/start`:

```json
{"redirect_uri":"https://app.example.com/calendar/callback","device_id":"iphone-installation-01"}
```

The response contains `authorize_url="lifehub://calendar/request-access?state=..."`, `state`, and `expires_at`. Handle this application link in Flutter, request read/write calendar access from the OS, and let the user select a writable calendar. `redirect_uri` must be in the same configured allowlist even though the device flow returns an application link.

After the OS grants access, call `POST /api/v1/planning/calendar-connections/apple/callback`:

```json
{
  "state":"<state returned by start>",
  "device_id":"iphone-installation-01",
  "calendar_id":"eventkit-calendar-01",
  "account_label":"My Apple Calendar",
  "permission_granted":true
}
```

The server verifies the authenticated user, initiating device, state lifetime, and one-use state. The device is responsible for truthfully reporting OS permission. The `201` response supplies the connection ID; the examples below use `11111111-1111-4111-8111-111111111111`.

### 2. Receive and apply outbound operations

The scheduler creates jobs automatically, or the client sends `{}` to `/calendar-connections/{connection_id}/sync`. Poll:

```http
GET /api/v1/planning/calendar-connections/11111111-1111-4111-8111-111111111111/device/outbox?device_id=iphone-installation-01
```

Example response (timestamps are illustrative):

```json
{
  "job":{
    "job_id":"22222222-2222-4222-8222-222222222222",
    "status":"queued",
    "phase":"wait_device",
    "accepted_at":"2026-09-05T12:00:00Z",
    "available_at":"2026-09-05T12:00:01Z",
    "push_completed_at":null,
    "error_code":null
  },
  "calendar_id":"eventkit-calendar-01",
  "changes":[{
    "operation_id":"33333333-3333-4333-8333-333333333333",
    "event_id":"44444444-4444-4444-8444-444444444444",
    "event_version":2,
    "operation":"upsert",
    "external_id":null,
    "payload":{
      "event_id":"44444444-4444-4444-8444-444444444444",
      "deleted":false,
      "title":"Meeting",
      "notes":null,
      "start_at":"2026-09-07T07:00:00Z",
      "end_at":"2026-09-07T08:00:00Z",
      "timezone":"Europe/Warsaw",
      "all_day":false,
      "rrule":"FREQ=WEEKLY;COUNT=3",
      "excluded_occurrences":[]
    }
  }],
  "more":false,
  "pull_allowed_at":null
}
```

For `upsert`, create or update the mapped EventKit event. For `delete`, remove it if present; an already absent event counts as applied. Persist the `operation_id`, stable external event ID, and mapping so replaying the same operation after a network error cannot duplicate the event. Apply the transmitted snapshot and acknowledge only after the local calendar write succeeds. Do not acknowledge unavailable or rejected writes. An outbox contains at most 500 operations; acknowledge and fetch again while `more=true` or unacknowledged operations remain.

Call `POST /api/v1/planning/calendar-connections/{connection_id}/device/ack`:

```json
{
  "device_id":"iphone-installation-01",
  "job_id":"22222222-2222-4222-8222-222222222222",
  "acknowledgements":[{
    "operation_id":"33333333-3333-4333-8333-333333333333",
    "external_id":"apple-event-stable-01",
    "etag":"device-revision-7"
  }]
}
```

`etag` is optional device revision metadata. Repeating the same acknowledgement returns `200 {"accepted":true}`. Reusing the operation with another external ID yields `409 acknowledgement_conflict`. An unknown operation or job cannot acknowledge another user's work.

### 3. Wait for permission to send inbound deltas

Continue polling the outbox. Once the worker sees all acknowledgements, it sets the job phase to `pull` and fills `push_completed_at` and `pull_allowed_at`. Send inbound changes only after server time reaches `pull_allowed_at`, at least one second after outbound completion. Early submissions receive `409 push_not_completed` or `409 pull_not_ready`.

Read EventKit changes **after applying the outbound operations**. Supply normalized complete snapshots of changed events and explicit tombstones for deletions. Use stable external IDs and include the changes caused by the applied outbound writes if your device tracker cannot exclude them; the backend compares fingerprints to avoid echoes.

### 4. Send inbound batches and finish the job

Call `POST /api/v1/planning/calendar-connections/{connection_id}/device/deltas`:

```json
{
  "device_id":"iphone-installation-01",
  "job_id":"22222222-2222-4222-8222-222222222222",
  "batch_id":"55555555-5555-4555-8555-555555555555",
  "changes":[
    {
      "external_id":"apple-event-stable-02",
      "title":"Created on iPhone",
      "start_at":"2026-09-08T10:00:00+02:00",
      "end_at":"2026-09-08T11:00:00+02:00",
      "timezone":"Europe/Warsaw",
      "all_day":false,
      "notes":null,
      "rrule":null,
      "excluded_occurrences":[],
      "etag":"device-revision-8",
      "read_only":false
    },
    {"external_id":"apple-event-removed-03","deleted":true}
  ],
  "cursor":"device-checkpoint-8",
  "final":true
}
```

The response is `202 {"accepted":true}`: the batch is durable and will be applied by the worker. Each batch contains at most 500 changes. For larger transfers send sequential batches with unique `batch_id` values and `final=false`, then one last `final=true` batch. Send an empty final batch when there are no changes. Resending an identical batch is safe; changing its payload under the same ID produces `409 idempotency_conflict`. No new batch is accepted after a final batch. Poll the job endpoint until `done` before advancing the device's durable checkpoint.

`cursor` is an opaque device checkpoint, saved by the server on the final batch. The device owns its change tracker and checkpoint persistence; the outbox does not currently return this cursor. Omission from a batch never means deletion. On first connection or a device rescan, include existing events and tombstones derived from the device's previous mapping.

For a recurring instance, provide `recurring_parent_id` (the master's stable external ID) and `original_start_at`. A deleted instance cancels that occurrence. A moved instance cancels the original occurrence and supplies a complete replacement snapshot with its own external ID. Send the master before its exceptions; the worker also sorts each batch with masters first. Whole series use one RFC 5545 RRULE and `excluded_occurrences`; dates must have offsets and timezone names must be IANA names. All-day boundaries are local midnight with an exclusive end date.

If the app is offline or OS access is unavailable, operations stay pending; the backend does not report an Apple job as done until outbound acknowledgements and the final inbound batch are processed. Resume using the current outbox/job after reconnection. A failed or expired job can be retried with a new sync request; pending outbound operation IDs are reused. Keep EventKit permission handling and background-execution restrictions in the Flutter client.
