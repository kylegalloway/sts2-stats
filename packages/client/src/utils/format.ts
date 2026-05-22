const KEEP_UPPER = new Set(['hp', 'id', 'elo']);

export type CodexTag = 'gold' | 'green' | 'red' | 'blue' | 'purple' | 'energy' | 'star' | 'plain' | 'br';
export interface CodexSegment { text: string; tag: CodexTag; }

const COLOR_TAGS = new Set(['gold', 'green', 'red', 'blue', 'purple']);

// Converts spire-codex BBCode description text to renderable segments.
// Tags: [color]text[/color] for gold/green/red/blue/purple, [energy:N], [star:N], \n line breaks.
export function parseCodexDescription(raw: string): CodexSegment[] {
  const segments: CodexSegment[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) segments.push({ text: '', tag: 'br' });
    const line = lines[i];
    const re = /\[(gold|green|red|blue|purple)\](.*?)\[\/(gold|green|red|blue|purple)\]|\[(energy|star):(\d+)\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (m.index > last) segments.push({ text: line.slice(last, m.index), tag: 'plain' });
      if (m[4] !== undefined) {
        // [energy:N] or [star:N]
        segments.push({ text: m[5], tag: m[4] as 'energy' | 'star' });
      } else if (COLOR_TAGS.has(m[1])) {
        segments.push({ text: m[2], tag: m[1] as CodexTag });
      }
      last = m.index + m[0].length;
    }
    if (last < line.length) segments.push({ text: line.slice(last), tag: 'plain' });
  }
  return segments;
}

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
