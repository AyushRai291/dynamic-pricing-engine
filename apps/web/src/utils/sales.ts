const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function parseSalesDecimal(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatInr(value: string | number | null): string {
  const parsed = typeof value === 'number' ? value : value === null ? null : parseSalesDecimal(value);
  return parsed === null || !Number.isFinite(parsed) ? '—' : currencyFormatter.format(parsed);
}

export function formatSaleDate(value: string, compact = false): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  const monthLabel = MONTH_LABELS[Number(month) - 1];

  if (!monthLabel) {
    return value;
  }

  return compact ? `${day} ${monthLabel}` : `${day} ${monthLabel} ${year}`;
}

export function getLocalIsoDate(): string {
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isStrictIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
