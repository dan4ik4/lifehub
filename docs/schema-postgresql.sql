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

-- Running upgrade 0001 -> 0002_web_push

CREATE TABLE push_subscriptions (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    endpoint_hash VARCHAR(64) NOT NULL,
    encrypted_subscription TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_push_subscriptions PRIMARY KEY (id),
    CONSTRAINT fk_push_subscriptions_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_push_subscriptions_endpoint_hash UNIQUE (endpoint_hash)
);

CREATE INDEX ix_push_subscriptions_user_id ON push_subscriptions (user_id);

UPDATE alembic_version SET version_num='0002_web_push' WHERE alembic_version.version_num = '0001';

-- Running upgrade 0002_web_push -> 0003_product_modules

CREATE TABLE books (
    title VARCHAR(300) NOT NULL,
    author VARCHAR(300) NOT NULL,
    status VARCHAR(10) NOT NULL,
    total_pages INTEGER,
    current_page INTEGER NOT NULL,
    rating INTEGER,
    genre VARCHAR(100) NOT NULL,
    cover_id INTEGER,
    open_library_key VARCHAR(60),
    notes TEXT NOT NULL,
    started_on DATE,
    finished_on DATE,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_books PRIMARY KEY (id),
    CONSTRAINT fk_books_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_books_deleted_at ON books (deleted_at);

CREATE INDEX ix_books_user_id ON books (user_id);

CREATE TABLE diary_entries (
    day DATE NOT NULL,
    title VARCHAR(300) NOT NULL,
    text TEXT NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_diary_entries PRIMARY KEY (id),
    CONSTRAINT fk_diary_entries_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_diary_entries_day ON diary_entries (day);

CREATE INDEX ix_diary_entries_deleted_at ON diary_entries (deleted_at);

CREATE INDEX ix_diary_entries_user_id ON diary_entries (user_id);

CREATE TABLE finance_budgets (
    month VARCHAR(7) NOT NULL,
    category VARCHAR(100) NOT NULL,
    amount NUMERIC(16, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_finance_budgets PRIMARY KEY (id),
    CONSTRAINT fk_finance_budgets_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_budgets_deleted_at ON finance_budgets (deleted_at);

CREATE INDEX ix_finance_budgets_month ON finance_budgets (month);

CREATE INDEX ix_finance_budgets_user_id ON finance_budgets (user_id);

CREATE TABLE finance_debts (
    title VARCHAR(300) NOT NULL,
    direction VARCHAR(12) NOT NULL,
    amount NUMERIC(16, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    due_date DATE,
    status VARCHAR(10) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_finance_debts PRIMARY KEY (id),
    CONSTRAINT fk_finance_debts_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_debts_deleted_at ON finance_debts (deleted_at);

CREATE INDEX ix_finance_debts_user_id ON finance_debts (user_id);

CREATE TABLE finance_goals (
    title VARCHAR(300) NOT NULL,
    target NUMERIC(16, 2) NOT NULL,
    saved NUMERIC(16, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    due_date DATE NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_finance_goals PRIMARY KEY (id),
    CONSTRAINT fk_finance_goals_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_goals_deleted_at ON finance_goals (deleted_at);

CREATE INDEX ix_finance_goals_user_id ON finance_goals (user_id);

CREATE TABLE finance_savings (
    title VARCHAR(300) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    amount NUMERIC(16, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_finance_savings PRIMARY KEY (id),
    CONSTRAINT fk_finance_savings_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_savings_deleted_at ON finance_savings (deleted_at);

CREATE INDEX ix_finance_savings_user_id ON finance_savings (user_id);

CREATE TABLE finance_subscriptions (
    title VARCHAR(300) NOT NULL,
    amount NUMERIC(16, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    period VARCHAR(12) NOT NULL,
    next_payment DATE NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_finance_subscriptions PRIMARY KEY (id),
    CONSTRAINT fk_finance_subscriptions_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_subscriptions_deleted_at ON finance_subscriptions (deleted_at);

CREATE INDEX ix_finance_subscriptions_user_id ON finance_subscriptions (user_id);

CREATE TABLE finance_transactions (
    day DATE NOT NULL,
    title VARCHAR(300) NOT NULL,
    kind VARCHAR(8) NOT NULL,
    amount NUMERIC(16, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    category VARCHAR(100) NOT NULL,
    notes TEXT NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_finance_transactions PRIMARY KEY (id),
    CONSTRAINT fk_finance_transactions_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_transactions_day ON finance_transactions (day);

CREATE INDEX ix_finance_transactions_deleted_at ON finance_transactions (deleted_at);

CREATE INDEX ix_finance_transactions_user_id ON finance_transactions (user_id);

CREATE TABLE goals (
    title VARCHAR(300) NOT NULL,
    description TEXT NOT NULL,
    due_date DATE,
    status VARCHAR(16) NOT NULL,
    progress INTEGER NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_goals PRIMARY KEY (id),
    CONSTRAINT fk_goals_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_goals_deleted_at ON goals (deleted_at);

CREATE INDEX ix_goals_user_id ON goals (user_id);

CREATE TABLE health_medications (
    title VARCHAR(300) NOT NULL,
    dosage VARCHAR(100) NOT NULL,
    times JSON NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_medications PRIMARY KEY (id),
    CONSTRAINT fk_health_medications_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_health_medications_deleted_at ON health_medications (deleted_at);

CREATE INDEX ix_health_medications_user_id ON health_medications (user_id);

CREATE TABLE health_nutrition (
    day DATE NOT NULL,
    meal VARCHAR(12) NOT NULL,
    title VARCHAR(300) NOT NULL,
    calories NUMERIC(10, 2) NOT NULL,
    protein NUMERIC(10, 2) NOT NULL,
    fat NUMERIC(10, 2) NOT NULL,
    carbs NUMERIC(10, 2) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_nutrition PRIMARY KEY (id),
    CONSTRAINT fk_health_nutrition_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_health_nutrition_day ON health_nutrition (day);

CREATE INDEX ix_health_nutrition_deleted_at ON health_nutrition (deleted_at);

CREATE INDEX ix_health_nutrition_user_id ON health_nutrition (user_id);

CREATE TABLE health_sleep (
    start_at TIMESTAMP WITH TIME ZONE NOT NULL,
    end_at TIMESTAMP WITH TIME ZONE NOT NULL,
    quality INTEGER NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_sleep PRIMARY KEY (id),
    CONSTRAINT fk_health_sleep_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_health_sleep_deleted_at ON health_sleep (deleted_at);

CREATE INDEX ix_health_sleep_end_at ON health_sleep (end_at);

CREATE INDEX ix_health_sleep_user_id ON health_sleep (user_id);

CREATE TABLE health_weight (
    day DATE NOT NULL,
    kg NUMERIC(7, 3) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_weight PRIMARY KEY (id),
    CONSTRAINT fk_health_weight_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_health_weight_day ON health_weight (day);

CREATE INDEX ix_health_weight_deleted_at ON health_weight (deleted_at);

CREATE INDEX ix_health_weight_user_id ON health_weight (user_id);

CREATE TABLE health_workouts (
    day DATE NOT NULL,
    title VARCHAR(300) NOT NULL,
    minutes INTEGER NOT NULL,
    notes TEXT NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_workouts PRIMARY KEY (id),
    CONSTRAINT fk_health_workouts_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_health_workouts_day ON health_workouts (day);

CREATE INDEX ix_health_workouts_deleted_at ON health_workouts (deleted_at);

CREATE INDEX ix_health_workouts_user_id ON health_workouts (user_id);

CREATE TABLE finance_debt_payments (
    debt_id UUID NOT NULL,
    day DATE NOT NULL,
    amount NUMERIC(16, 2) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_finance_debt_payments PRIMARY KEY (id),
    CONSTRAINT fk_finance_debt_payments_debt_id_finance_debts FOREIGN KEY(debt_id) REFERENCES finance_debts (id) ON DELETE CASCADE,
    CONSTRAINT fk_finance_debt_payments_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_debt_payments_debt_id ON finance_debt_payments (debt_id);

CREATE INDEX ix_finance_debt_payments_deleted_at ON finance_debt_payments (deleted_at);

CREATE INDEX ix_finance_debt_payments_user_id ON finance_debt_payments (user_id);

CREATE TABLE goal_milestones (
    goal_id UUID NOT NULL,
    title VARCHAR(300) NOT NULL,
    progress INTEGER NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_goal_milestones PRIMARY KEY (id),
    CONSTRAINT fk_goal_milestones_goal_id_goals FOREIGN KEY(goal_id) REFERENCES goals (id) ON DELETE CASCADE,
    CONSTRAINT fk_goal_milestones_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_goal_milestones_deleted_at ON goal_milestones (deleted_at);

CREATE INDEX ix_goal_milestones_goal_id ON goal_milestones (goal_id);

CREATE INDEX ix_goal_milestones_user_id ON goal_milestones (user_id);

CREATE TABLE goal_task_links (
    goal_id UUID NOT NULL,
    task_id UUID NOT NULL,
    CONSTRAINT pk_goal_task_links PRIMARY KEY (goal_id, task_id),
    CONSTRAINT fk_goal_task_links_goal_id_goals FOREIGN KEY(goal_id) REFERENCES goals (id) ON DELETE CASCADE,
    CONSTRAINT fk_goal_task_links_task_id_tasks FOREIGN KEY(task_id) REFERENCES tasks (id) ON DELETE CASCADE
);

CREATE TABLE habits (
    title VARCHAR(300) NOT NULL,
    kind VARCHAR(16) NOT NULL,
    target NUMERIC(14, 4) NOT NULL,
    unit VARCHAR(40) NOT NULL,
    weekdays JSON NOT NULL,
    reminder_time VARCHAR(5),
    goal_id UUID,
    archived BOOLEAN NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_habits PRIMARY KEY (id),
    CONSTRAINT fk_habits_goal_id_goals FOREIGN KEY(goal_id) REFERENCES goals (id) ON DELETE SET NULL,
    CONSTRAINT fk_habits_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_habits_deleted_at ON habits (deleted_at);

CREATE INDEX ix_habits_goal_id ON habits (goal_id);

CREATE INDEX ix_habits_user_id ON habits (user_id);

CREATE TABLE health_medication_intakes (
    medication_id UUID NOT NULL,
    day DATE NOT NULL,
    time VARCHAR(5) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_medication_intakes PRIMARY KEY (id),
    CONSTRAINT fk_health_medication_intakes_medication_id_health_medications FOREIGN KEY(medication_id) REFERENCES health_medications (id) ON DELETE CASCADE,
    CONSTRAINT fk_health_medication_intakes_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_medication_intake_slot UNIQUE (medication_id, day, time)
);

CREATE INDEX ix_health_medication_intakes_day ON health_medication_intakes (day);

CREATE INDEX ix_health_medication_intakes_deleted_at ON health_medication_intakes (deleted_at);

CREATE INDEX ix_health_medication_intakes_medication_id ON health_medication_intakes (medication_id);

CREATE INDEX ix_health_medication_intakes_user_id ON health_medication_intakes (user_id);

CREATE TABLE habit_checkins (
    habit_id UUID NOT NULL,
    day DATE NOT NULL,
    value NUMERIC(14, 4) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_habit_checkins PRIMARY KEY (id),
    CONSTRAINT fk_habit_checkins_habit_id_habits FOREIGN KEY(habit_id) REFERENCES habits (id) ON DELETE CASCADE,
    CONSTRAINT fk_habit_checkins_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT uq_habit_checkin_day UNIQUE (habit_id, day)
);

CREATE INDEX ix_habit_checkins_day ON habit_checkins (day);

CREATE INDEX ix_habit_checkins_deleted_at ON habit_checkins (deleted_at);

CREATE INDEX ix_habit_checkins_habit_id ON habit_checkins (habit_id);

CREATE INDEX ix_habit_checkins_user_id ON habit_checkins (user_id);

UPDATE alembic_version SET version_num='0003_product_modules' WHERE alembic_version.version_num = '0002_web_push';

-- Running upgrade 0003_product_modules -> 0004_user_privacy

CREATE TABLE user_avatars (
    user_id UUID NOT NULL,
    image BYTEA NOT NULL,
    CONSTRAINT pk_user_avatars PRIMARY KEY (user_id),
    CONSTRAINT fk_user_avatars_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE user_exports (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    format VARCHAR(8) NOT NULL,
    status VARCHAR(12) NOT NULL,
    encrypted_data BYTEA,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    notified BOOLEAN NOT NULL,
    notification_attempts INTEGER NOT NULL,
    notification_retry_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_user_exports PRIMARY KEY (id),
    CONSTRAINT fk_user_exports_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_user_exports_status ON user_exports (status);

CREATE INDEX ix_user_exports_user_id ON user_exports (user_id);

UPDATE alembic_version SET version_num='0004_user_privacy' WHERE alembic_version.version_num = '0003_product_modules';

-- Running upgrade 0004_user_privacy -> 0005_product_notices

CREATE TABLE product_notices (
    key VARCHAR(160) NOT NULL,
    user_id UUID NOT NULL,
    module VARCHAR(32) NOT NULL,
    pro_only BOOLEAN NOT NULL,
    url VARCHAR(100) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    delivered_at TIMESTAMP WITH TIME ZONE,
    retry_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL,
    CONSTRAINT pk_product_notices PRIMARY KEY (key),
    CONSTRAINT fk_product_notices_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_product_notices_expires_at ON product_notices (expires_at);

CREATE INDEX ix_product_notices_retry_at ON product_notices (retry_at);

CREATE INDEX ix_product_notices_user_id ON product_notices (user_id);

UPDATE alembic_version SET version_num='0005_product_notices' WHERE alembic_version.version_num = '0004_user_privacy';

-- Running upgrade 0005_product_notices -> 0006_health_programs

CREATE TABLE health_programs (
    title VARCHAR(300) NOT NULL,
    exercises JSON NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_programs PRIMARY KEY (id),
    CONSTRAINT fk_health_programs_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_health_programs_user_id ON health_programs (user_id);

CREATE INDEX ix_health_programs_deleted_at ON health_programs (deleted_at);

CREATE TABLE health_weight_targets (
    kg NUMERIC(7, 3) NOT NULL,
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_weight_targets PRIMARY KEY (id),
    CONSTRAINT fk_health_weight_targets_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_health_weight_targets_user_id ON health_weight_targets (user_id);

CREATE INDEX ix_health_weight_targets_deleted_at ON health_weight_targets (deleted_at);

UPDATE alembic_version SET version_num='0006_health_programs' WHERE alembic_version.version_num = '0005_product_notices';

-- Running upgrade 0006_health_programs -> 0007_savings_history

CREATE TABLE finance_savings_history (
    savings_id UUID NOT NULL,
    amount NUMERIC(16, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    previous_amount NUMERIC(16, 2),
    previous_currency VARCHAR(3),
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_finance_savings_history PRIMARY KEY (id),
    CONSTRAINT fk_finance_savings_history_savings_id_finance_savings FOREIGN KEY(savings_id) REFERENCES finance_savings (id) ON DELETE CASCADE,
    CONSTRAINT fk_finance_savings_history_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_savings_history_deleted_at ON finance_savings_history (deleted_at);

CREATE INDEX ix_finance_savings_history_savings_id ON finance_savings_history (savings_id);

CREATE INDEX ix_finance_savings_history_user_id ON finance_savings_history (user_id);

UPDATE alembic_version SET version_num='0007_savings_history' WHERE alembic_version.version_num = '0006_health_programs';

-- Running upgrade 0007_savings_history -> 0008_weight_unit

ALTER TABLE users ADD COLUMN weight_unit VARCHAR(2) DEFAULT 'kg' NOT NULL;

UPDATE alembic_version SET version_num='0008_weight_unit' WHERE alembic_version.version_num = '0007_savings_history';

-- Running upgrade 0008_weight_unit -> 0009_chat_history

ALTER TABLE planning_commands ADD COLUMN request_text TEXT;

UPDATE alembic_version SET version_num='0009_chat_history' WHERE alembic_version.version_num = '0008_weight_unit';

-- Running upgrade 0009_chat_history -> 0010_chat_photos

ALTER TABLE planning_commands ADD COLUMN request_photos JSON;

UPDATE alembic_version SET version_num='0010_chat_photos' WHERE alembic_version.version_num = '0009_chat_history';

-- Running upgrade 0010_chat_photos -> 0011_device_health

CREATE TABLE health_connections (
    user_id UUID NOT NULL,
    provider VARCHAR(20) NOT NULL,
    enabled BOOLEAN NOT NULL,
    sync_token UUID NOT NULL,
    revision INTEGER NOT NULL,
    last_synced_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT pk_health_connections PRIMARY KEY (user_id),
    CONSTRAINT fk_health_connections_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE health_device_days (
    user_id UUID NOT NULL,
    provider VARCHAR(20) NOT NULL,
    day DATE NOT NULL,
    timezone VARCHAR(100) NOT NULL,
    steps INTEGER,
    sleep_seconds INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_health_device_days PRIMARY KEY (user_id, provider, day),
    CONSTRAINT fk_health_device_days_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

UPDATE alembic_version SET version_num='0011_device_health' WHERE alembic_version.version_num = '0010_chat_photos';

-- Running upgrade 0011_device_health -> 0012_assistant_preferences

ALTER TABLE users ADD COLUMN chat_preferences JSON DEFAULT '{}' NOT NULL;

UPDATE alembic_version SET version_num='0012_assistant_preferences' WHERE alembic_version.version_num = '0011_device_health';

-- Running upgrade 0012_assistant_preferences -> 0013_goal_tracking

ALTER TABLE goals ADD COLUMN target_value NUMERIC(14, 4);

ALTER TABLE goals ADD COLUMN current_value NUMERIC(14, 4) DEFAULT '0' NOT NULL;

ALTER TABLE goals ADD COLUMN unit VARCHAR(40) DEFAULT '' NOT NULL;

ALTER TABLE habits ADD COLUMN contributes BOOLEAN DEFAULT false NOT NULL;

UPDATE alembic_version SET version_num='0013_goal_tracking' WHERE alembic_version.version_num = '0012_assistant_preferences';

-- Running upgrade 0013_goal_tracking -> 0014_csv_import

CREATE TABLE finance_csv_imports (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    request_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    account VARCHAR(100) NOT NULL,
    status VARCHAR(16) NOT NULL,
    rows JSON NOT NULL,
    result JSON,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_finance_csv_imports PRIMARY KEY (id),
    CONSTRAINT uq_finance_csv_imports_user_id UNIQUE (user_id, request_key),
    CONSTRAINT fk_finance_csv_imports_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_csv_imports_user_id ON finance_csv_imports (user_id);

CREATE TABLE finance_csv_rows (
    user_id UUID NOT NULL,
    account_hash VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    transaction_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_finance_csv_rows PRIMARY KEY (user_id, account_hash, fingerprint),
    CONSTRAINT fk_finance_csv_rows_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_finance_csv_rows_transaction_id_finance_transactions FOREIGN KEY(transaction_id) REFERENCES finance_transactions (id) ON DELETE CASCADE
);

UPDATE alembic_version SET version_num='0014_csv_import' WHERE alembic_version.version_num = '0013_goal_tracking';

-- Running upgrade 0014_csv_import -> 0015_diary_review

CREATE TABLE diary_weekly_reviews (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    end_day DATE NOT NULL,
    source_hash VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    output JSON,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_diary_weekly_reviews PRIMARY KEY (id),
    CONSTRAINT uq_diary_weekly_reviews_user_id UNIQUE (user_id, end_day, source_hash),
    CONSTRAINT fk_diary_weekly_reviews_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_diary_weekly_reviews_user_id ON diary_weekly_reviews (user_id);

UPDATE alembic_version SET version_num='0015_diary_review' WHERE alembic_version.version_num = '0014_csv_import';

-- Running upgrade 0015_diary_review -> 0016_pdf_import

ALTER TABLE finance_csv_imports ADD COLUMN source_format VARCHAR(8) DEFAULT 'csv' NOT NULL;

UPDATE alembic_version SET version_num='0016_pdf_import' WHERE alembic_version.version_num = '0015_diary_review';

-- Running upgrade 0016_pdf_import -> 0017_finance_review

CREATE TABLE finance_reviews (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    month VARCHAR(7) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    source_hash VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    output JSON,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_finance_reviews PRIMARY KEY (id),
    CONSTRAINT uq_finance_reviews_user_id UNIQUE (user_id, month, currency),
    CONSTRAINT fk_finance_reviews_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_finance_reviews_user_id ON finance_reviews (user_id);

UPDATE alembic_version SET version_num='0017_finance_review' WHERE alembic_version.version_num = '0016_pdf_import';

-- Running upgrade 0017_finance_review -> 0018_cross_reviews

CREATE TABLE cross_module_reviews (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    scope_hash VARCHAR(64) NOT NULL,
    source_hash VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    output JSON,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT pk_cross_module_reviews PRIMARY KEY (id),
    CONSTRAINT uq_cross_module_reviews_user_id UNIQUE (user_id, scope_hash),
    CONSTRAINT fk_cross_module_reviews_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_cross_module_reviews_user_id ON cross_module_reviews (user_id);

UPDATE alembic_version SET version_num='0018_cross_reviews' WHERE alembic_version.version_num = '0017_finance_review';

-- Running upgrade 0018_cross_reviews -> 0019_journal_workouts

ALTER TABLE health_workouts ADD COLUMN efforts JSON DEFAULT '[]' NOT NULL;

ALTER TABLE diary_entries ADD COLUMN mood INTEGER;

ALTER TABLE diary_entries ADD COLUMN tags JSON DEFAULT '[]' NOT NULL;

UPDATE alembic_version SET version_num='0019_journal_workouts' WHERE alembic_version.version_num = '0018_cross_reviews';

-- Running upgrade 0019_journal_workouts -> 0020_dashboard_closed_days

CREATE TABLE dashboard_closed_days (
    user_id UUID NOT NULL,
    day DATE NOT NULL,
    CONSTRAINT pk_dashboard_closed_days PRIMARY KEY (user_id, day),
    CONSTRAINT fk_dashboard_closed_days_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

UPDATE alembic_version SET version_num='0020_dashboard_closed_days' WHERE alembic_version.version_num = '0019_journal_workouts';

-- Running upgrade 0020_dashboard_closed_days -> 0021_results

CREATE TABLE results_snapshots (
    user_id UUID NOT NULL,
    kind VARCHAR(8) NOT NULL,
    start DATE NOT NULL,
    payload JSON NOT NULL,
    built_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ai_attempted BOOLEAN NOT NULL,
    ai_selection JSON,
    CONSTRAINT pk_results_snapshots PRIMARY KEY (user_id, kind, start),
    CONSTRAINT fk_results_snapshots_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE results_preferences (
    user_id UUID NOT NULL,
    ai_enabled BOOLEAN NOT NULL,
    decided BOOLEAN NOT NULL,
    hidden_pairs JSON NOT NULL,
    CONSTRAINT pk_results_preferences PRIMARY KEY (user_id),
    CONSTRAINT fk_results_preferences_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE reading_deltas (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    book_id UUID NOT NULL,
    day DATE NOT NULL,
    pages INTEGER NOT NULL,
    CONSTRAINT pk_reading_deltas PRIMARY KEY (id),
    CONSTRAINT fk_reading_deltas_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_reading_deltas_book_id_books FOREIGN KEY(book_id) REFERENCES books (id) ON DELETE CASCADE
);

CREATE INDEX ix_reading_deltas_user_day ON reading_deltas (user_id, day);

UPDATE alembic_version SET version_num='0021_results' WHERE alembic_version.version_num = '0020_dashboard_closed_days';

-- Running upgrade 0021_results -> 0022_pdf_batches

ALTER TABLE finance_csv_imports ADD COLUMN pdf_payload TEXT;

ALTER TABLE finance_csv_imports ADD COLUMN pdf_claim_until TIMESTAMP WITH TIME ZONE;

UPDATE alembic_version SET version_num='0022_pdf_batches' WHERE alembic_version.version_num = '0021_results';

-- Running upgrade 0022_pdf_batches -> 0023_health_details

ALTER TABLE health_weight ADD COLUMN notes TEXT DEFAULT '' NOT NULL;

ALTER TABLE health_weight_targets ADD COLUMN mode VARCHAR(8) DEFAULT 'maintain' NOT NULL;

ALTER TABLE health_workouts ADD COLUMN program_id UUID;

ALTER TABLE health_medications ADD COLUMN weekdays JSON DEFAULT '[0,1,2,3,4,5,6]' NOT NULL;

ALTER TABLE health_medications ADD COLUMN course_end DATE;

ALTER TABLE health_medications ADD COLUMN stock INTEGER;

ALTER TABLE health_medications ADD COLUMN stock_since TIMESTAMP WITH TIME ZONE;

ALTER TABLE health_medication_intakes ADD COLUMN skipped BOOLEAN DEFAULT 'false' NOT NULL;

ALTER TABLE health_medication_intakes ADD COLUMN taken_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE health_nutrition_targets (
    id UUID NOT NULL,
    user_id UUID NOT NULL,
    version INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    deleted_at TIMESTAMP WITH TIME ZONE,
    calories INTEGER NOT NULL,
    protein INTEGER NOT NULL,
    fat INTEGER NOT NULL,
    carbs INTEGER NOT NULL,
    CONSTRAINT pk_health_nutrition_targets PRIMARY KEY (id),
    CONSTRAINT fk_health_nutrition_targets_user_id_users FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_health_nutrition_targets_user_id ON health_nutrition_targets (user_id);

CREATE INDEX ix_health_nutrition_targets_deleted_at ON health_nutrition_targets (deleted_at);

UPDATE alembic_version SET version_num='0023_health_details' WHERE alembic_version.version_num = '0022_pdf_batches';

COMMIT;
