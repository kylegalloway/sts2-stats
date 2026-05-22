import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import HBarChart from '../components/charts/HBarChart.js';
import { useStore } from '../store.js';
import { formatName } from '../utils/format.js';

interface RelicStat {
  relic_key: string;
  obtain_count: number;
  obtain_rate: number;
  win_rate: number | null;
  quality_score: number | null;
  avg_floor: number | null;
}

const pct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

export default function Relics() {
  const { selectedCharacter, setSelectedCharacter } = useStore();
  const [search, setSearch] = useState('');

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<{ relics: RelicStat[] }>({
    queryKey: ['relics', selectedCharacter],
    queryFn: () => api.getRelics(selectedCharacter || undefined) as Promise<{ relics: RelicStat[] }>,
  });

  if (isLoading) return <div className="loading">Loading…</div>;
  if (!data) return null;

  const topQuality = [...data.relics]
    .filter((r) => r.quality_score != null)
    .sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0))
    .slice(0, 20);

  const topWR = [...data.relics]
    .filter((r) => r.win_rate != null && r.obtain_count >= 2)
    .sort((a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0))
    .slice(0, 20);

  const cols: Column<RelicStat>[] = [
    { key: 'relic_key', label: 'Relic', render: (v) => <span>{formatName(v as string)}</span> },
    { key: 'obtain_count', label: 'Count', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'obtain_rate', label: 'Obtain Rate', render: (v) => <span className="pct">{pct(v as number)}</span> },
    { key: 'win_rate', label: 'Win Rate', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
    { key: 'quality_score', label: 'Quality', render: (v) => <span className="num">{v == null ? '—' : (v as number).toFixed(3)}</span> },
    { key: 'avg_floor', label: 'Avg Floor', render: (v) => <span className="num">{v == null ? '—' : (v as number).toFixed(1)}</span> },
  ];

  return (
    <div className="content">
      <div className="controls">
        <CharacterSelect
          value={selectedCharacter}
          onChange={setSelectedCharacter}
          characters={chars.data ?? []}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Search</span>
          <input
            className="search-input"
            placeholder="Filter relics…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="charts-row col2">
        <div className="chart-card">
          <h3>Top 20 by Quality Score</h3>
          <HBarChart
            data={topQuality.map((r) => ({ label: formatName(r.relic_key), value: +(r.quality_score ?? 0).toFixed(3) }))}
            color="#c9903c"
            height={Math.max(180, topQuality.length * 32)}
          />
        </div>
        <div className="chart-card">
          <h3>Top 20 by Win Rate (≥2 runs)</h3>
          <HBarChart
            data={topWR.map((r) => ({ label: formatName(r.relic_key), value: Math.round((r.win_rate ?? 0) * 100) }))}
            color="#52b875"
            valueFormatter={(v) => `${v}%`}
            height={Math.max(180, topWR.length * 32)}
          />
        </div>
      </div>

      <div className="tcard">
        <div className="tcard-head">
          <span className="tcard-title">All Relics</span>
          <span className="dim" style={{ fontSize: '.75rem' }}>{data.relics.length} relics</span>
        </div>
        <SortableTable
          columns={cols}
          rows={data.relics}
          defaultSortKey="quality_score"
          filterText={search}
          filterKeys={['relic_key']}
        />
      </div>
    </div>
  );
}
