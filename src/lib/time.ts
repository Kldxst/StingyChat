export function parseSqliteUtc(value: string): Date {
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/u.test(value)
    ? value
    : `${value.trim().replace(' ', 'T')}Z`;
  return new Date(normalized);
}

export function formatAdminTime(value: string, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const date = parseSqliteUtc(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone,
  }).format(date);
}
