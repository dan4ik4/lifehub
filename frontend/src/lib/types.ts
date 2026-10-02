export interface User {
  id: string; name: string; email: string; email_verified: boolean;
  auth_providers: ('password' | 'google' | 'apple')[];
  plan: 'free' | 'trial' | 'pro'; trial_ends: string | null;
  onboarding_completed: boolean; free_modules: string[]; timezone: string; weight_unit?: "kg" | "lb";
}
export interface TokenPair {
  access_token: string; refresh_token: string; token_type: 'bearer'; expires_in: number; refresh_expires_in: number;
}
export interface AuthSession { user: User; tokens: TokenPair; is_new_user: boolean; demo?: boolean }
export interface OtpChallenge {
  challenge_id: string; otp_expires_at: string; registration_expires_at: string;
  resend_available_at: string; attempts_left: number;
}
export interface Reminder { id: string; trigger_at: string | null; offset_minutes: number | null; channel: 'push' | 'email'; delivered_at: string | null }
export interface ReminderInput { trigger_at?: string; offset_minutes?: number; channel: 'push' | 'email' }
export interface Recurrence { rrule: string; human_text: string; timezone: string; next_occurrence_at: string | null }
export type Priority = 'none' | 'low' | 'medium' | 'high';
export interface Task {
  id: string; title: string; notes: string | null; start_at: string | null; due_at: string | null;
  timezone: string; all_day: boolean; priority: Priority; recurrence: Recurrence | null;
  completed: boolean; next_occurrence_at: string | null; reminders: Reminder[];
  version: number; created_at: string; updated_at: string;
}
export interface TaskOccurrence {
  task_id: string; occurrence_at: string | null; status: 'pending' | 'completed' | 'skipped';
  completed_at: string | null; effective_start_at: string | null; effective_due_at: string | null;
}
export interface CalendarEvent {
  id: string; title: string; notes: string | null; start_at: string; end_at: string; timezone: string;
  all_day: boolean; recurrence: Recurrence | null; source: 'local' | 'google' | 'apple' | 'ai';
  connection_id: string | null; external_read_only: boolean; version: number;
  created_at: string; updated_at: string; occurrence_at: string | null;
}
export interface CalendarRange { from: string; to: string; timezone: string; tasks: TaskOccurrence[]; events: CalendarEvent[] }
export interface PlanningList {
  id: string; name: string; kind: 'shopping' | 'custom'; is_system: boolean; is_editable: boolean;
  item_count: number; completed_count: number; version: number; created_at: string; updated_at: string;
}
export interface ListItem {
  id: string; list_id: string; title: string; quantity: string | number | null; unit: string | null;
  checked: boolean; position: number; version: number; created_at: string; updated_at: string;
}
export interface Page<T> { items: T[]; next_cursor?: string | null; total?: number }
export interface CalendarConnection {
  id: string; provider: 'google' | 'apple'; status: 'active' | 'reauth_required' | 'disconnected';
  account_label: string; sync_enabled: boolean; last_synced_at: string | null; created_at: string;
}
export interface SyncJob {
  job_id: string; status: 'queued' | 'running' | 'done' | 'failed'; accepted_at: string;
  phase: string; available_at: string; push_completed_at: string | null; error_code: string | null;
}
export type Notify = (message: string, kind?: 'success' | 'error' | 'info') => void;
