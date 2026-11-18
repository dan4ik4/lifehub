# Voice quality fix, 2026-10-22

User confirmed deployment. Public verification on 2026-10-22: / and /health/ready return 200. Served bundle index-BV0BJzQV.js contains 64 kbit/s recording and microphone processing options. Effective backend model was checked by the deployment script, not independently inspected in this follow-up. Live acoustic quality still needs a user recording.

- Full gpt-4o-transcribe instead of mini; deterministic temperature 0.
- Russian transcription context with preservation of Polish/English code switching; no forced language and no translation/post-processing.
- 64 kbit/s instead of 24 kbit/s audio, mono preference and microphone echo cancellation, noise suppression, automatic gain control.
- Existing one-minute / 650 KB bounds and single-button send/cancel preserved.
- Backend media tests: 12 passed; frontend: 70 passed; TypeScript/build and Ruff passed.
- No live acoustic evaluation performed. User recording needed to assess remaining recognition mistakes; do not claim perfect recognition.
- Deployment script changes only transcription model in production dotenv, with backup and restoration on failure, and verifies effective model. Other settings remain intact.

Official reference: https://developers.openai.com/api/docs/guides/speech-to-text

Run: ssh -t lifeadmin@104.248.254.176 "sudo bash /home/lifeadmin/lifehub-release-20261022-voice/deploy-20261022-voice.sh"
