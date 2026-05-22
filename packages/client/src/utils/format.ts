const KEEP_UPPER = new Set(['hp', 'id', 'elo']);

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => KEEP_UPPER.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function formatName(raw: string | null | undefined): string {
  if (!raw) return '—';
  return titleCase(raw.replace(/_/g, ' '));
}

const ROOM_SUFFIX = /\s+(NORMAL|ELITE|BOSS|WEAK)$/i;

export function formatEnemy(raw: string | null | undefined): string {
  if (!raw) return '—';
  if (raw === 'NONE.NONE') return '—';
  const stripped = raw.replace(ROOM_SUFFIX, '');
  return titleCase(stripped.replace(/_/g, ' '));
}
