import { locale } from '../lib/language';
import { formatAmount } from './format';
import type { User } from '../lib/types';

export const isPro = (user: User) =>
  user.plan === "pro" ||
  (user.plan === "trial" &&
    !!user.trial_ends &&
    Date.parse(user.trial_ends) > Date.now());
export const text = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);
export const amount = formatAmount;
export const dateLabel = (value: unknown) =>
  value
    ? new Date(
        text(value).length === 10 ? text(value) + "T12:00:00" : text(value),
      ).toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

export function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div className="record-progress">
      <div>
        <span>{label}</span>
        <strong>{Math.round(value)}%</strong>
      </div>
      <progress
        value={Math.min(100, Math.max(0, value))}
        max={100}
        aria-label={label}
      />
    </div>
  );
}
