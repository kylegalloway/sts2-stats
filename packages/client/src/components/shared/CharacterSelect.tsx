const CHAR_COLORS: Record<string, string> = {
  IRONCLAD: '#c05c5c',
  THE_SILENT: '#52b875',
  DEFECT: '#5b8dd9',
  WATCHER: '#c9903c',
  NECROBINDER: '#9c6fcc',
  REGENT: '#e8b86d',
};

export function charColor(char: string): string {
  return CHAR_COLORS[char] ?? '#7a7890';
}

interface CharacterSelectProps {
  value: string;
  onChange: (char: string) => void;
  characters: string[];
}

export default function CharacterSelect({ value, onChange, characters }: CharacterSelectProps) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
      <span className="ctrl-label">Character</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {characters.map((c) => (
          <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
        ))}
      </select>
    </label>
  );
}
