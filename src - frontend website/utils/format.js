/**
 * Common date formats for the app (transactions, uploads, etc.)
 * Use these so all transaction dates display consistently.
 */

const DATE_OPTIONS = { day: '2-digit', month: 'short', year: 'numeric' };
const LOCALE = 'en-GB';

function parseDateLike(dateString) {
  const raw = String(dateString).trim();
  // Keep DB calendar dates timezone-safe: treat YYYY-MM-DD (with or without ISO time suffix) as local calendar date
  // so that "2025-03-06T00:00:00.000Z" displays as 6 Mar 2025, not the previous day in timezones behind UTC.
  const datePart = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (datePart) {
    const [, y, m, d] = datePart;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }
  return new Date(raw);
}

/** Format a date for display (e.g. "28 Feb 2026") */
export function formatTransactionDate(dateString) {
  if (dateString == null || dateString === '') return '—';
  try {
    const date = parseDateLike(dateString);
    if (Number.isNaN(date.getTime())) return String(dateString);
    return date.toLocaleDateString(LOCALE, DATE_OPTIONS);
  } catch {
    return String(dateString);
  }
}

/** Format date and time for display (e.g. "28 Feb 2026, 10:30 am") */
export function formatDateTime(dateString) {
  if (dateString == null || dateString === '') return '—';
  try {
    const date = parseDateLike(dateString);
    if (Number.isNaN(date.getTime())) return String(dateString);
    return date.toLocaleDateString(LOCALE, {
      ...DATE_OPTIONS,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateString);
  }
}

/** For input[type="date"] value (YYYY-MM-DD) */
export function toDateInputValue(dateString) {
  if (dateString == null || dateString === '') return '';
  try {
    const raw = String(dateString).trim();
    const datePart = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (datePart) return `${datePart[1]}-${datePart[2]}-${datePart[3]}`;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return '';
  }
}
