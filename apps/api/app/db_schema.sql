CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  current_state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_transitions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  reason TEXT,
  request_id TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

CREATE TABLE IF NOT EXISTS integration_outcomes (
  idempotency_key TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  transition_event_id TEXT,
  integration_events_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_event_log (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  target TEXT,
  event_name TEXT,
  payload_json TEXT,
  emitted_at TEXT
);

-- Agent F: PRD-10 Notifications
CREATE TABLE IF NOT EXISTS notifications (
  notification_id TEXT PRIMARY KEY,
  type TEXT,
  severity TEXT,
  status TEXT,
  channel TEXT,
  title TEXT,
  message TEXT,
  submission_id TEXT,
  recipient_email TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Agent F: PRD-11 Audit
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT,
  request_id TEXT,
  idempotency_key TEXT UNIQUE,
  prev_hash TEXT,
  event_hash TEXT,
  created_at TEXT NOT NULL
);

-- Agent G: PRD-13 Background Jobs
CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  job_type TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  status TEXT,
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  payload_json TEXT,
  correlation_id TEXT,
  created_at TEXT,
  scheduled_for TEXT,
  started_at TEXT,
  ended_at TEXT,
  next_retry_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id TEXT PRIMARY KEY,
  job_run_id TEXT,
  payload_json TEXT,
  failure_reason TEXT,
  created_at TEXT,
  replayed_at TEXT
);

-- Agent G: PRD-17 Release Scheduling
CREATE TABLE IF NOT EXISTS release_schedules (
  submission_id TEXT PRIMARY KEY,
  preferred_month TEXT,
  planned_release_at TEXT,
  timezone TEXT,
  source TEXT,
  updated_by TEXT,
  updated_at TEXT,
  version INTEGER DEFAULT 1,
  release_triggered_at TEXT
);

CREATE TABLE IF NOT EXISTS schedule_overrides (
  id TEXT PRIMARY KEY,
  submission_id TEXT,
  old_release_at TEXT,
  new_release_at TEXT,
  reason TEXT,
  actor_id TEXT,
  created_at TEXT
);

-- Agent G: PRD-15 Observability
CREATE TABLE IF NOT EXISTS incident_annotations (
  id TEXT PRIMARY KEY,
  source TEXT,
  severity TEXT,
  note TEXT,
  linked_entity TEXT,
  failure_class TEXT,
  correlation_id TEXT,
  remediation_status TEXT,
  remediation_owner TEXT,
  remediation_link TEXT,
  audit_event_id TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TEXT
);

-- Agent Y: PRD-02 Creator Workspace
CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT,
  label_name TEXT,
  defaults_json TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS submission_metadata (
  submission_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  pack_name TEXT,
  label_name TEXT,
  release_month TEXT,
  notes TEXT,
  tags_json TEXT,
  airtable_form_completed INTEGER DEFAULT 0,
  airtable_payload_checksum TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submission_drafts (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  autosave_json TEXT,
  last_saved_at TEXT
);

CREATE TABLE IF NOT EXISTS airtable_submission_links (
  submission_id TEXT PRIMARY KEY,
  airtable_base_id TEXT NOT NULL,
  airtable_table_name TEXT NOT NULL,
  airtable_view_name TEXT NOT NULL,
  airtable_record_id TEXT,
  airtable_record_url TEXT,
  airtable_payload_checksum TEXT,
  sync_status TEXT NOT NULL CHECK (
    sync_status IN (
      'pending',
      'linked',
      'duplicate_detected',
      'missing_remote',
      'desynced',
      'sync_error'
    )
  ),
  last_synced_at TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_airtable_submission_links_record_id
ON airtable_submission_links(airtable_record_id)
WHERE airtable_record_id IS NOT NULL;

-- Agent R: PRD-08 Review Console
CREATE TABLE IF NOT EXISTS review_decisions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);

CREATE TABLE IF NOT EXISTS review_tags (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS review_flags (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  flag_type TEXT,
  severity TEXT,
  added_by TEXT,
  created_at TEXT
);

-- Agent Q: PRD-14 Admin Config & Operations
CREATE TABLE IF NOT EXISTS admin_configs (
  id TEXT PRIMARY KEY,
  config_type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT,
  is_draft INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_secrets_meta (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  key_ref TEXT NOT NULL,
  rotated_at TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_health (
  provider TEXT PRIMARY KEY,
  status_class TEXT NOT NULL,
  recommended_action TEXT NOT NULL,
  status_copy TEXT NOT NULL,
  credential_status TEXT NOT NULL,
  error_code TEXT,
  last_checked_at TEXT NOT NULL,
  last_rotated_at TEXT,
  last_failure_context TEXT,
  last_error TEXT,
  last_latency_ms INTEGER NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integration_credentials (
  provider TEXT PRIMARY KEY,
  credentials_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Agent P: PRD-03/12 File Intake
CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  local_pack_path TEXT,
  dropbox_dest_path TEXT,
  sha256_manifest_json TEXT,
  chunk_state_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  completed_at TEXT,
  locked_at TEXT
);

CREATE TABLE IF NOT EXISTS asset_manifest (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  sha256 TEXT,
  mime TEXT,
  locked INTEGER DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES upload_sessions(id)
);

-- PRD-01: Authentication & RBAC (SQLite persistence)
CREATE TABLE IF NOT EXISTS auth_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_user_roles (
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, role),
  FOREIGN KEY (user_id) REFERENCES auth_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_otp_challenges (
  challenge_id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  purpose TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_otp_throttles (
  throttle_key TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  send_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  refresh_token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  device_id TEXT,
  revoked_at TEXT,
  revoke_reason TEXT,
  replaced_by_hash TEXT,
  FOREIGN KEY (user_id) REFERENCES auth_users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_family_id ON auth_sessions(family_id);

CREATE TABLE IF NOT EXISTS auth_login_failures (
  email TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

-- PRD-04/05: QC policy and evaluation persistence
CREATE TABLE IF NOT EXISTS qc_policy_versions (
  policy_id TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  rule_set_version TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (policy_id, policy_version)
);

CREATE TABLE IF NOT EXISTS qc_policy_idempotency (
  request_key TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qc_reports (
  report_id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  rule_set_version TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  applied_policy_id TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_qc_reports_submission_id ON qc_reports(submission_id);
CREATE INDEX IF NOT EXISTS idx_qc_reports_generated_at ON qc_reports(generated_at);

CREATE TABLE IF NOT EXISTS qc_findings (
  finding_id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  blocking INTEGER NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  remediation TEXT NOT NULL,
  context_json TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES qc_reports(report_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qc_findings_report_id ON qc_findings(report_id);

CREATE TABLE IF NOT EXISTS qc_evaluation_idempotency (
  request_key TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (report_id) REFERENCES qc_reports(report_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_qc_eval_submission_id ON qc_evaluation_idempotency(submission_id);

-- PRD-07: submission state metadata persistence
CREATE TABLE IF NOT EXISTS submission_state_metadata (
  submission_id TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
);
