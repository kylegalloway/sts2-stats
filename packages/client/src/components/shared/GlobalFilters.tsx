import { useStore } from '../../store.js';

const ASC_OPTIONS = [
  { label: 'All', value: '' },
  ...Array.from({ length: 11 }, (_, i) => ({ label: `${i}+`, value: String(i) })),
];
const LAST_N_OPTIONS = [
  { label: 'All time', value: '' },
  { label: 'Last 10', value: '10' },
  { label: 'Last 25', value: '25' },
  { label: 'Last 50', value: '50' },
  { label: 'Last 100', value: '100' },
  { label: 'Last 200', value: '200' },
];

export default function GlobalFilters() {
  const { ascension, setAscension, lastN, setLastN } = useStore();

  return (
    <>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <span className="ctrl-label">Ascension</span>
        <select value={ascension} onChange={(e) => setAscension(e.target.value)}>
          {ASC_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <span className="ctrl-label">Recency</span>
        <select value={lastN} onChange={(e) => setLastN(e.target.value)}>
          {LAST_N_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </>
  );
}
