# Mixed assistant dialogue fix

User confirmed deployment. Public / and /health/ready checks returned 200 after confirmation. Running backend implementation and authenticated model behavior were not independently verified in this follow-up. A batch containing clarification becomes one clarification before confirmation and before any domain writes. No partial changes. Replies accompanying writes are excluded; server reports actual results. Reply-only batches become a reply. Executor retains defensive rejection.

Validation: 35 command, chat and assistant integration tests passed; separate dialogue normalization test passed. Ruff passed. Tests cover replay, persisted question, follow-up, bulk delete not entering confirmation, and no partial task creation. No live OpenAI call.

Release uploaded to /home/lifeadmin/lifehub-release-20261022-dialogue. Run deploy-20261022-dialogue.sh with sudo. Previous voice configuration fix preserved.
