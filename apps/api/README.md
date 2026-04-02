# `apps/api` Foundation

Wave 0/1/2/3 API workspace provides FastAPI scaffolding and contract-first module backbones.

Implemented in this module:
- entrypoint: `app/main.py`
- baseline endpoints:
  - `GET /health/live`
  - `GET /health/ready`
  - `GET /version`
- PRD-11 audit endpoints:
  - `POST /internal/audit/append`
  - `GET /audit/events`
  - `GET /audit/events/{id}`
  - `GET /audit/export`
- PRD-01 auth/rbac endpoints:
  - `POST /auth/register`
  - `POST /auth/otp/send`
  - `POST /auth/otp/verify`
  - `POST /auth/login`
  - `POST /auth/refresh`
  - `POST /auth/logout`
  - `POST /auth/logout-all`
  - `POST /auth/forgot-password`
  - `POST /auth/reset-password`
  - `GET /auth/me`
- PRD-07/09 lifecycle/orchestration endpoints:
  - `POST /submissions/draft`
  - `POST /submissions/{id}/transition`
  - `GET /submissions/{id}/transitions`
  - `GET /submissions/{id}/integrations`
  - `POST /internal/integrations/dispatch`
- PRD-10 notification endpoints:
  - `GET /notifications`
  - `POST /internal/notifications/emit`
  - `POST /admin/notifications/templates`
- PRD-13 job queue endpoints:
  - `POST /internal/jobs/enqueue`
  - `GET /admin/jobs/{id}`
  - `POST /admin/jobs/{id}/replay`
- PRD-17 release scheduling endpoints:
  - `POST /submissions/{id}/schedule/resolve`
  - `PUT /submissions/{id}/schedule`
  - `POST /submissions/{id}/release/trigger`
- PRD-15 observability endpoints:
  - `GET /metrics`
  - `POST /admin/incidents/annotations`
- required scheduling event contract:
  - `submission.approved.scheduling.v1`
- Wave 3 contract artifacts:
  - `docs/contracts/prd10-notification-contract-v1.md`
  - `docs/contracts/prd13-prd17-prd15-cycle-boundary.md`
- test coverage for baseline endpoints in `tests/test_foundation_endpoints.py`
- test coverage for audit contracts and behavior in `tests/test_audit_endpoints.py`
- test coverage for auth/rbac contracts and behavior in `tests/test_auth_endpoints.py`
- PRD-07/09 service and contract tests in `tests/test_submission_*` and `tests/test_integration_orchestrator_service.py`
- PRD-10 service and contract tests in `tests/test_notification_*`
- PRD-13/15/17 service and contract tests in:
  - `tests/test_jobs_scheduling_observability_contracts.py`
  - `tests/test_job_queue_service.py`
  - `tests/test_release_scheduler_service.py`
  - `tests/test_jobs_scheduling_observability_api_routes.py`
- dependency and tooling config in `pyproject.toml`

Run locally:
1. `python3 -m venv .venv`
2. `source .venv/bin/activate`
3. `python -m pip install --upgrade pip`
4. `python -m pip install -e ".[dev]"`
5. `python -m ruff check .`
6. `python -m pytest tests`

Downstream modules should extend this workspace with:
- typed settings and strict env validation
- structured JSON logging and tracing
- OpenAPI contract versioning
- migration policy and expanded test coverage gates

Logging:
1. Backend logs are emitted as JSON lines to stdout and a rotating log file.
2. Default file path: `apps/api/logs/splice-api.log` (configurable via `SPLICE_LOG_DIR` and `SPLICE_LOG_FILE_NAME`).
3. Every HTTP request includes/returns `X-Correlation-ID`, and that value is present in log entries.
