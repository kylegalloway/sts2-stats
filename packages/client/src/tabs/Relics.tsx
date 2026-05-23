import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import GlobalFilters from '../components/shared/GlobalFilters.js';
import EntityTooltip from '../components/shared/EntityTooltip.js';
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

const RARITIES = ['Common', 'Ancient', 'Starter'];
const MIN_COUNT_OPTIONS = [1, 2, 3, 5, 10];

const pct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

export default function Relics() {
  const { selectedCharacter, setSelectedCharacter, ascension, lastN } = useStore();
  const [search, setSearch] = useState('');
  const [selectedRarity, setSelectedRarity] = useState('');
  const [minCount, setMinCount] = useState(1);

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<{ relics: RelicStat[] }>({
    queryKey: ['relics', selectedCharacter, ascension, lastN],
    queryFn: () => api.getRelics(selectedCharacter || undefined, ascension || undefined, lastN || undefined) as Promise<{ relics: RelicStat[] }>,
  });

  const { data: cachedRelics } = useQuery<{ id: string; rarity: string | null }[]>({
    queryKey: ['codex-cached-relics'],
    queryFn: () => api.getCodexCachedRelics(),
    staleTime: 5 * 60 * 1000,
  });

  const relicRarityMap = new Map<string, string>(
    (cachedRelics ?? []).flatMap((r) => {
      if (!r.rarity) return [];
      const tier = r.rarity.replace(/ Relic$/i, '');
      return [[formatName(r.id), tier]];
    })
  );

  if (isLoading) return <div className="loading">Loading…</div>;
  if (!data) return null;

  const filteredRelics = data.relics.filter((r) => {
    if (selectedRarity && relicRarityMap.get(formatName(r.relic_key)) !== selectedRarity) return false;
    if (r.obtain_count < minCount) return false;
    return true;
  });

  const topQuality = [...filteredRelics]
    .filter((r) => r.quality_score != null)
    .sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0))
    .slice(0, 20);

  const topWR = [...filteredRelics]
    .filter((r) => r.win_rate != null && r.obtain_count >= 2)
    .sort((a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0))
    .slice(0, 20);

  const cols: Column<RelicStat>[] = [
    {
      key: 'relic_key', label: 'Relic',
      render: (v) => (
        <EntityTooltip name={formatName(v as string)} entityType="relic">
          <span>{formatName(v as string)}</span>
        </EntityTooltip>
      ),
    },
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
        <GlobalFilters />
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Rarity</span>
          <select value={selectedRarity} onChange={(e) => setSelectedRarity(e.target.value)}>
            <option value="">All</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Min Count</span>
          <select value={minCount} onChange={(e) => setMinCount(Number(e.target.value))}>
            {MIN_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </label>
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
          <p className="dim" style={{ fontSize: '.75rem', margin: '0 0 .75rem' }}>
            Wilson lower-bound on win rate — balances win% with sample size so high-n relics rank above fluky small samples.
          </p>
          <HBarChart
            data={topQuality.map((r) => ({ label: formatName(r.relic_key), value: +(r.quality_score ?? 0).toFixed(3) }))}
            color="#c9903c"
            height={Math.max(180, topQuality.length * 32)}
            entityType="relic"
          />
        </div>
        <div className="chart-card">
          <h3>Top 20 by Win Rate (≥2 runs)</h3>
          <HBarChart
            data={topWR.map((r) => ({ label: formatName(r.relic_key), value: Math.round((r.win_rate ?? 0) * 100) }))}
            color="#52b875"
            valueFormatter={(v) => `${v}%`}
            height={Math.max(180, topWR.length * 32)}
            entityType="relic"
          />
        </div>
      </div>

      <div className="tcard">
        <div className="tcard-head">
          <span className="tcard-title">All Relics</span>
          <span className="dim" style={{ fontSize: '.75rem' }}>{filteredRelics.length} relics</span>
        </div>
        <SortableTable
          columns={cols}
          rows={filteredRelics}
          defaultSortKey="quality_score"
          filterText={search}
          filterKeys={['relic_key']}
        />
      </div>
    </div>
  );
}
