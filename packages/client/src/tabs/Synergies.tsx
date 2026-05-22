import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import { useStore } from '../store.js';

interface Synergy {
  character: string;
  card_id: string;
  relic_key: string;
  occurrences: number;
  win_rate: number;
  baseline_wr: number;
  lift: number;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function liftClass(v: number) {
  if (v >= 1.3) return 'lift-high';
  if (v >= 1.1) return 'lift-med';
  if (v >= 0.9) return 'lift-low';
  return 'lift-neg';
}

export default function Synergies() {
  const { selectedCharacter, setSelectedCharacter } = useStore();
  const [minOcc, setMinOcc] = useState(2);
  const [search, setSearch] = useState('');

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<{ synergies: Synergy[] }>({
    queryKey: ['synergies', selectedCharacter, minOcc],
    queryFn: () => api.getSynergies(selectedCharacter || undefined, minOcc) as Promise<{ synergies: Synergy[] }>,
  });

  const cols: Column<Synergy>[] = [
    { key: 'character', label: 'Character', render: (v) => <span>{String(v).replace(/_/g, ' ')}</span> },
    { key: 'card_id', label: 'Card' },
    { key: 'relic_key', label: 'Relic' },
    { key: 'occurrences', label: 'Co-occurs', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'win_rate', label: 'Win Rate', render: (v) => <span className="pct">{pct(v as number)}</span> },
    { key: 'baseline_wr', label: 'Baseline', render: (v) => <span className="pct dim">{pct(v as number)}</span> },
    {
      key: 'lift', label: 'Lift',
      render: (v) => <span className={liftClass(v as number)}>{(v as number).toFixed(2)}x</span>,
    },
  ];

  if (isLoading) return <div className="loading">Loading…</div>;

  return (
    <div className="content">
      <div className="controls">
        <CharacterSelect
          value={selectedCharacter}
          onChange={setSelectedCharacter}
          characters={chars.data ?? []}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Min Co-occurs</span>
          <select value={minOcc} onChange={(e) => setMinOcc(Number(e.target.value))}>
            {[2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Search</span>
          <input
            className="search-input"
            placeholder="Filter card / relic…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="tcard">
        <div className="tcard-head">
          <span className="tcard-title">Card + Relic Synergies</span>
          <span className="dim" style={{ fontSize: '.75rem' }}>
            Lift = win rate ÷ baseline. 1.3x = 30% more wins than average.
          </span>
        </div>
        <SortableTable
          columns={cols}
          rows={data?.synergies ?? []}
          defaultSortKey="lift"
          filterText={search}
          filterKeys={['card_id', 'relic_key', 'character']}
        />
      </div>
    </div>
  );
}
