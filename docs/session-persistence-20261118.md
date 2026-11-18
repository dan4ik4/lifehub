# Persistent login — 2026-11-18

User requested working in order, one item at a time. Current item: preserve website login after closing and reopening it.

Implemented: real sessions in localStorage, one-time migration from sessionStorage, cached stable React snapshots, shared logout/account state and Web Locks for single-use refresh rotation across tabs on HTTPS. Demo sessions remain tab-scoped. Blocked browser storage falls back to tab storage/in-memory operation. Existing server expiration/revocation rules remain in effect (default refresh lifetime: 30 days).

Verification: 80 frontend tests passed, TypeScript and production build passed. Tests include reopening with expired access, rotation persistence, two independent tabs refreshing concurrently, logout during refresh, account switching, storage notifications and unavailable storage.

Prepared frontend-only deployment at `/home/lifeadmin/lifehub-session-20261118/`. Remote syntax and uploaded SHA256 checked. Script validates the server source against the tested baseline, backs up source/image, builds/recreates only frontend, checks public readiness and served session code, and restores the previous frontend on failure. Source after SHA256: b4ffd0108ff1b068d4bc2eaf48f0cc9f91da91e07918e3bf6fadfbdae7cf91eb.

DEPLOYED AND VERIFIED: user confirmed closing/reopening retains login. Independent public checks confirmed readiness HTTP 200 and the served JavaScript contains the new persistent-session code. Deployment command used:

```powershell
ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-session-20261118/deploy-session-20261118.sh"
```

Item 1 is complete. This document is included in the current LifeHub source snapshot for GitHub (item 3).

## Source snapshot validation — 2026-11-18

Backend: 207 tests passed; 6 PostgreSQL/Redis integration tests skipped without dedicated services. Ruff passed. Frontend: 80 tests passed; TypeScript and production build passed. Prepared files were checked for credential patterns and matches against actual local secret values; no matches found. Release packages, temporary data, local databases, device builds, signing files, the unrelated FamilyQuest demo and the one-off Artem server provisioning script are excluded from publication. The existing main branch was synchronized with origin before committing.

## Requested order after item 1

2. Health integration status explained. User explicitly deferred real-device Health Connect/HealthKit work until AFTER resolving Google sign-in in the APK (item 10). Return to health integration after that; do not request a phone test now.
3. Save all intended project changes to GitHub (inspect secrets/build/test artifacts first).
4. Discuss bank connections and easier finance tracking.
5. Subscription payments deferred.
6. Review remaining integration setup.
7. Finish the agreed remaining AI functionality, clarifying concrete scope first.
8. Present all outstanding product decisions for discussion.
9. Configure and verify real push notifications.
10. Diagnose Google sign-in in the Android APK. After this is resolved, return to the deferred real-device health integration checks from item 2.

Do not implement the later items simultaneously.
