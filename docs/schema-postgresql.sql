BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL,
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001

CREATE TABLE login_attempts (
    email VARCHAR(320) NOT NULL,
    failures INTEGER NOT NULL,
    blocked_until TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_login_attempts PRIMARY KEY (email)
);

CREATE TABLE pending_registrations (
    id UUID NOT NULL,
    name VARCHAR(50) NOT NULL,
    email VARCHAR(320) NOT NULL,
    password_hash TEXT NOT NULL,
    otp_hash VARCHAR(64) NOT NULL,
    otp_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL,
    resend_count INTEGER NOT NULL,
    last_sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    locked_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_pending_registrations PRIMARY KEY (id),
    CONSTRAINT uq_pending_registrations_email UNIQUE (email)
);

CREATE INDEX ix_pending_registrations_expires_at ON pending_registrations (expires_at);

CREATE TABLE users (
    id UUID NOT NULL,
    name VARCHAR(50) NOT NULL,
    email VARCHAR(320) NOT NULL,
    password_hash TEXT,
    email_verified BOOLEAN NOT NULL,
    plan VARCHAR(10) NOT NULL,
    trial_ends TIMESTAMP WITH TIME ZONE,
    trial_started_at TIMESTAMP WITH TIME ZONE,
    onboarding_completed BOOLEAN NOT NULL,
    free_modules JSON NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_users PRIMARY KEY (id)
);

CREATE INDEX ix_users_email ON users (email);

CREATE UNIQUE INDEX uq_users_password_email ON users (email) WHERE password_hash IS NOT NULL;

CREATE TABLE auth_identities (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    provider VARCHAR(12) NOT NULL,
    provider_subject VARCHAR(255) NOT NULL,
    CONSTRAINT pk_auth_identities PRIMARY KEY (id),
    CONSTRAINT fk_auth_identities_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_identity_provider_subject UNIQUE (provider, provider_subject)
);

CREATE INDEX ix_auth_identities_user_id ON auth_identities (user_id);

CREATE TABLE calendar_connections (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    provider VARCHAR(16) NOT NULL,
    calendar_id VARCHAR(1024) NOT NULL,
    account_label VARCHAR(320) NOT NULL,
    encrypted_credentials TEXT,
    device_id VARCHAR(128),
    status VARCHAR(32) NOT NULL,
    sync_enabled BOOLEAN NOT NULL,
    active_job_id UUID,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    next_sync_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_calendar_connections PRIMARY KEY (id),
    CONSTRAINT fk_calendar_connections_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_calendar_user_provider UNIQUE (user_id, provider)
);

CREATE INDEX ix_calendar_connections_next_sync_at ON calendar_connections (next_sync_at);

CREATE INDEX ix_calendar_connections_user_id ON calendar_connections (user_id);

CREATE TABLE calendar_events (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    title VARCHAR(300) NOT NULL,
    notes TEXT,
    start_at TIMESTAMP WITH TIME ZONE NOT NULL,
    end_at TIMESTAMP WITH TIME ZONE NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    all_day BOOLEAN NOT NULL,
    rrule VARCHAR(2000),
    source VARCHAR(12) NOT NULL,
    connection_id UUID,
    external_read_only BOOLEAN NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_calendar_events PRIMARY KEY (id),
    CONSTRAINT ck_calendar_events_ck_event_positive_duration CHECK (end_at > start_at),
    CONSTRAINT fk_calendar_events_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_calendar_events_connection_id ON calendar_events (connection_id);

CREATE INDEX ix_calendar_events_deleted_at ON calendar_events (deleted_at);

CREATE INDEX ix_calendar_events_end_at ON calendar_events (end_at);

CREATE INDEX ix_calendar_events_start_at ON calendar_events (start_at);

CREATE INDEX ix_calendar_events_user_id ON calendar_events (user_id);

CREATE TABLE calendar_oauth_states (
    state_hash VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL,
    provider VARCHAR(16) NOT NULL,
    redirect_uri VARCHAR(2048) NOT NULL,
    device_id VARCHAR(128),
    encrypted_verifier TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_calendar_oauth_states PRIMARY KEY (state_hash),
    CONSTRAINT fk_calendar_oauth_states_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_calendar_oauth_states_user_id ON calendar_oauth_states (user_id);

CREATE TABLE email_change_challenges (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    new_email VARCHAR(320) NOT NULL,
    otp_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    registration_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL,
    resend_count INTEGER NOT NULL,
    last_sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_email_change_challenges PRIMARY KEY (id),
    CONSTRAINT fk_email_change_challenges_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_email_change_challenges_user_id UNIQUE (user_id)
);

CREATE TABLE password_reset_tokens (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    attempts INTEGER NOT NULL,
    last_sent_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_password_reset_tokens PRIMARY KEY (id),
    CONSTRAINT fk_password_reset_tokens_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_password_reset_tokens_user_id UNIQUE (user_id)
);

CREATE TABLE planning_ai_usage (
    user_id UUID NOT NULL,
    day DATE NOT NULL,
    count INTEGER NOT NULL,
    CONSTRAINT pk_planning_ai_usage PRIMARY KEY (user_id, day),
    CONSTRAINT fk_planning_ai_usage_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE TABLE planning_commands (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    response JSON,
    error_status INTEGER,
    error_code VARCHAR(64),
    error_message VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_planning_commands PRIMARY KEY (id),
    CONSTRAINT fk_planning_commands_user_id_users FOREIGN KEY(user_id) REFERENCES users (id),
    CONSTRAINT uq_planning_commands_user_id UNIQUE (user_id, idempotency_key)
);

CREATE INDEX ix_planning_commands_user_id ON planning_commands (user_id);

CREATE TABLE planning_lists (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    kind VARCHAR(12) NOT NULL,
    is_system BOOLEAN NOT NULL,
    system_key VARCHAR(20),
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_planning_lists PRIMARY KEY (id),
    CONSTRAINT fk_planning_lists_user_id_users FOREIGN KEY(user_id) REFERENCES users (id),
    CONSTRAINT uq_planning_system_list UNIQUE (user_id, system_key)
);

CREATE INDEX ix_planning_lists_user_id ON planning_lists (user_id);

CREATE TABLE planning_reminders (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    entity_type VARCHAR(10) NOT NULL,
    entity_id UUID NOT NULL,
    trigger_at TIMESTAMP WITH TIME ZONE,
    offset_minutes INTEGER,
    channel VARCHAR(10) NOT NULL,
    next_trigger_at TIMESTAMP WITH TIME ZONE,
    occurrence_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    delivery_key VARCHAR(100) NOT NULL,
    attempts INTEGER NOT NULL,
    last_error VARCHAR(100),
    next_attempt_at TIMESTAMP WITH TIME ZONE,
    lease_until TIMESTAMP WITH TIME ZONE,
    lease_token UUID,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_planning_reminders PRIMARY KEY (id),
    CONSTRAINT fk_planning_reminders_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_planning_reminders_entity_id ON planning_reminders (entity_id);

CREATE INDEX ix_planning_reminders_next_trigger_at ON planning_reminders (next_trigger_at);

CREATE INDEX ix_planning_reminders_user_id ON planning_reminders (user_id);

CREATE INDEX ix_reminder_due ON planning_reminders (next_trigger_at, cancelled_at);

CREATE TABLE refresh_sessions (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    family_id UUID NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    replaced_by_id UUID,
    device_info VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_refresh_sessions PRIMARY KEY (id),
    CONSTRAINT fk_refresh_sessions_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_refresh_sessions_token_hash UNIQUE (token_hash)
);

CREATE INDEX ix_refresh_sessions_expires_at ON refresh_sessions (expires_at);

CREATE INDEX ix_refresh_sessions_family_id ON refresh_sessions (family_id);

CREATE INDEX ix_refresh_sessions_user_id ON refresh_sessions (user_id);

CREATE TABLE tasks (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    title VARCHAR(300) NOT NULL,
    notes TEXT,
    start_at TIMESTAMP WITH TIME ZONE,
    due_at TIMESTAMP WITH TIME ZONE,
    timezone VARCHAR(100) NOT NULL,
    all_day BOOLEAN NOT NULL,
    priority VARCHAR(10) NOT NULL,
    rrule VARCHAR(2000),
    completed_at TIMESTAMP WITH TIME ZONE,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_tasks PRIMARY KEY (id),
    CONSTRAINT ck_tasks_ck_task_priority CHECK (priority IN ('none','low','medium','high')),
    CONSTRAINT fk_tasks_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_tasks_deleted_at ON tasks (deleted_at);

CREATE INDEX ix_tasks_due_at ON tasks (due_at);

CREATE INDEX ix_tasks_user_id ON tasks (user_id);

CREATE TABLE calendar_sync_cursors (
    connection_id UUID NOT NULL,
    cursor TEXT,
    CONSTRAINT pk_calendar_sync_cursors PRIMARY KEY (connection_id),
    CONSTRAINT fk_calendar_sync_cursors_connection_id_calendar_connections FOREIGN KEY(connection_id) REFERENCES calendar_connections (id) ON DELETE CASCADE
);

CREATE TABLE calendar_sync_jobs (
    id UUID NOT NULL,
    connection_id UUID NOT NULL,
    status VARCHAR(16) NOT NULL,
    phase VARCHAR(24) NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE NOT NULL,
    available_at TIMESTAMP WITH TIME ZONE NOT NULL,
    push_completed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    lease_until TIMESTAMP WITH TIME ZONE,
    lease_owner VARCHAR(64),
    attempts INTEGER NOT NULL,
    error_code VARCHAR(64),
    CONSTRAINT pk_calendar_sync_jobs PRIMARY KEY (id),
    CONSTRAINT fk_calendar_sync_jobs_connection_id_calendar_connections FOREIGN KEY(connection_id) REFERENCES calendar_connections (id) ON DELETE CASCADE
);

CREATE INDEX ix_calendar_jobs_due ON calendar_sync_jobs (status, available_at);

CREATE INDEX ix_calendar_sync_jobs_connection_id ON calendar_sync_jobs (connection_id);

CREATE TABLE event_exceptions (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    event_id UUID NOT NULL,
    occurrence_at TIMESTAMP WITH TIME ZONE NOT NULL,
    kind VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_event_exceptions PRIMARY KEY (id),
    CONSTRAINT fk_event_exceptions_event_id_calendar_events FOREIGN KEY(event_id) REFERENCES calendar_events (id) ON DELETE CASCADE,
    CONSTRAINT fk_event_exceptions_user_id_users FOREIGN KEY(user_id) REFERENCES users (id),
    CONSTRAINT uq_event_exception UNIQUE (event_id, occurrence_at)
);

CREATE INDEX ix_event_exceptions_event_id ON event_exceptions (event_id);

CREATE INDEX ix_event_exceptions_user_id ON event_exceptions (user_id);

CREATE TABLE external_event_links (
    id UUID NOT NULL,
    connection_id UUID NOT NULL,
    event_id UUID NOT NULL,
    external_id VARCHAR(1024) NOT NULL,
    etag VARCHAR(512),
    synced_version INTEGER NOT NULL,
    fingerprint VARCHAR(64),
    remote_exists BOOLEAN NOT NULL,
    CONSTRAINT pk_external_event_links PRIMARY KEY (id),
    CONSTRAINT fk_external_event_links_connection_id_calendar_connections FOREIGN KEY(connection_id) REFERENCES calendar_connections (id) ON DELETE CASCADE,
    CONSTRAINT fk_external_event_links_event_id_calendar_events FOREIGN KEY(event_id) REFERENCES calendar_events (id) ON DELETE CASCADE,
    CONSTRAINT uq_calendar_local_event UNIQUE (connection_id, event_id),
    CONSTRAINT uq_calendar_external_event UNIQUE (connection_id, external_id)
);

CREATE INDEX ix_external_event_links_connection_id ON external_event_links (connection_id);

CREATE INDEX ix_external_event_links_event_id ON external_event_links (event_id);

CREATE TABLE list_items (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    list_id UUID NOT NULL,
    title VARCHAR(300) NOT NULL,
    quantity NUMERIC(14, 4),
    unit VARCHAR(40),
    checked BOOLEAN NOT NULL,
    position INTEGER NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_list_items PRIMARY KEY (id),
    CONSTRAINT fk_list_items_list_id_planning_lists FOREIGN KEY(list_id) REFERENCES planning_lists (id) ON DELETE CASCADE,
    CONSTRAINT fk_list_items_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_list_items_list_id ON list_items (list_id);

CREATE INDEX ix_list_items_user_id ON list_items (user_id);

CREATE TABLE task_occurrences (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    task_id UUID NOT NULL,
    occurrence_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(15) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_task_occurrences PRIMARY KEY (id),
    CONSTRAINT fk_task_occurrences_task_id_tasks FOREIGN KEY(task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_task_occurrences_user_id_users FOREIGN KEY(user_id) REFERENCES users (id),
    CONSTRAINT uq_task_occurrence UNIQUE (task_id, occurrence_at)
);

CREATE INDEX ix_task_occurrences_task_id ON task_occurrences (task_id);

CREATE INDEX ix_task_occurrences_user_id ON task_occurrences (user_id);

CREATE TABLE apple_inbound_batches (
    id SERIAL NOT NULL,
    connection_id UUID NOT NULL,
    job_id UUID NOT NULL,
    batch_id UUID NOT NULL,
    payload JSON NOT NULL,
    cursor TEXT,
    final BOOLEAN NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE,
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_apple_inbound_batches PRIMARY KEY (id),
    CONSTRAINT fk_apple_inbound_batches_connection_id_calendar_connections FOREIGN KEY(connection_id) REFERENCES calendar_connections (id) ON DELETE CASCADE,
    CONSTRAINT fk_apple_inbound_batches_job_id_calendar_sync_jobs FOREIGN KEY(job_id) REFERENCES calendar_sync_jobs (id) ON DELETE CASCADE,
    CONSTRAINT uq_apple_inbound_batch UNIQUE (connection_id, batch_id)
);

CREATE INDEX ix_apple_inbound_batches_connection_id ON apple_inbound_batches (connection_id);

CREATE INDEX ix_apple_inbound_batches_job_id ON apple_inbound_batches (job_id);

CREATE TABLE apple_outbound_changes (
    id UUID NOT NULL,
    connection_id UUID NOT NULL,
    job_id UUID NOT NULL,
    event_id UUID NOT NULL,
    event_version INTEGER NOT NULL,
    operation VARCHAR(16) NOT NULL,
    payload JSON NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    external_id VARCHAR(1024),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_apple_outbound_changes PRIMARY KEY (id),
    CONSTRAINT fk_apple_outbound_changes_connection_id_calendar_connections FOREIGN KEY(connection_id) REFERENCES calendar_connections (id) ON DELETE CASCADE,
    CONSTRAINT fk_apple_outbound_changes_event_id_calendar_events FOREIGN KEY(event_id) REFERENCES calendar_events (id) ON DELETE CASCADE,
    CONSTRAINT fk_apple_outbound_changes_job_id_calendar_sync_jobs FOREIGN KEY(job_id) REFERENCES calendar_sync_jobs (id) ON DELETE CASCADE,
    CONSTRAINT uq_apple_outbound_version UNIQUE (connection_id, event_id, event_version)
);

CREATE INDEX ix_apple_outbound_changes_connection_id ON apple_outbound_changes (connection_id);

CREATE INDEX ix_apple_outbound_changes_job_id ON apple_outbound_changes (job_id);

INSERT INTO alembic_version (version_num) VALUES ('0001') RETURNING alembic_version.version_num;

COMMIT;
