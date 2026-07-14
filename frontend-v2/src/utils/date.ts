// Lightweight date helpers for epoch (seconds) values from the API.
import { format, formatDistanceToNowStrict } from 'date-fns';

export function relTime(epochSec: number | null | undefined): string {
  if (!epochSec) return '';
  try {
    return formatDistanceToNowStrict(new Date(epochSec * 1000), { addSuffix: true });
  } catch {
    return '';
  }
}

export function fmtDay(epochSec: number | null | undefined): string {
  if (!epochSec) return '—';
  try {
    return format(new Date(epochSec * 1000), 'MMM d, yyyy');
  } catch {
    return '—';
  }
}

export function fmtDayShort(epochSec: number | null | undefined): string {
  if (!epochSec) return '—';
  try {
    return format(new Date(epochSec * 1000), 'MMM d');
  } catch {
    return '—';
  }
}

export function daysUntil(epochSec: number | null | undefined): number | null {
  if (!epochSec) return null;
  const ms = epochSec * 1000 - Date.now();
  return Math.round(ms / 86400000);
}

export function daysUntilLabel(epochSec: number | null | undefined): string {
  const d = daysUntil(epochSec);
  if (d === null) return '';
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d > 0) return `in ${d}d`;
  if (d === -1) return 'Yesterday';
  return `${Math.abs(d)}d ago`;
}
