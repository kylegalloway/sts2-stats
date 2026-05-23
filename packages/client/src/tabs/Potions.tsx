import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import GlobalFilters from '../components/shared/GlobalFilters.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import HBarChart from '../components/charts/HBarChart.js';
import { useStore } from '../store.js';
import { formatName } from '../utils/format.js';

interface PotionStat {
  potion_id: string;
  times_offered: number;
  times_obtained: number;
  pick_rate: number | null;
  times_used: number;
  times_discarded: number;
  use_rate: number | null;
  discard_rate: number | null;
}
interface PotionUsageByRoom { room_type: string; times_used: number; }
interface PotionBossUsageStat {
  potion_id: string;
  used_at_boss: number;
  used_elsewhere: number;
  total_used: number;
  boss_use_pct: number | null;
}
interface PotionsResponse {
  stats: PotionStat[];
  usageByRoom: PotionUsageByRoom[];
  bossUsage: PotionBossUsageStat[];
}

const pct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const num = (v: number | null) => v == null ? '—' : String(v);

const ROOM_COLORS: Record<string, string> = {
  boss: '#e8503a',
  elite: '#c9903c',
  monster: '#5b8dd9',
  event: '#40a070',
  treasure: '#9b7ec8',
  shop: '#aaa',
  rest_site: '#6db3b3',
};

const MIN_OFFERED_OPTIONS = [1, 2, 3, 5, 10];

export default function Potions() {
  const { selectedCharacter, setSelectedCharacter, ascension, lastN } = useStore();
  const [search, setSearch] = useState('');
  const [minOffered, setMinOffered] = useState(1);

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<PotionsResponse>({
    queryKey: ['potions', selectedCharacter, ascension, lastN],
    queryFn: () => api.getPotions(selectedCharacter || undefined, ascension || undefined, lastN || undefined) as Promise<PotionsResponse>,
  });

  if (isLoading) return <div className="loading">Loading…</div>;
  if (!data) return null;

  const filteredStats = data.stats.filter((p) => {
    if (p.times_offered < minOffered) return false;
    if (search && !p.potion_id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const { usageByRoom, bossUsage } = data;
  const topByOffered = filteredStats.slice(0, 20);
  const topUsed = [...filteredStats].sort((a, b) => b.times_used - a.times_used).slice(0, 15);

  const statCols: Column<PotionStat>[] = [
    { key: 'potion_id', label: 'Potion', render: (v) => <span>{formatName(v as string)}</span> },
    { key: 'times_offered', label: 'Offered', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'times_obtained', label: 'Taken', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'pick_rate', label: 'Pick Rate', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
    { key: 'times_used', label: 'Used', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'times_discarded', label: 'Discarded', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'use_rate', label: 'Use Rate', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
    { key: 'discard_rate', label: 'Discard Rate', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
  ];

  const bossUsageCols: Column<PotionBossUsageStat>[] = [
    { key: 'potion_id', label: 'Potion', render: (v) => <span>{formatName(v as string)}</span> },
    { key: 'total_used', label: 'Total Used', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'used_at_boss', label: 'At Boss', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'used_elsewhere', label: 'Elsewhere', render: (v) => <span className="num">{num(v as number)}</span> },
    {
      key: 'boss_use_pct',
      label: 'Boss Use %',
      render: (v) => {
        const p = v as number | null;
        const color = p != null && p >= 0.5 ? '#e8503a' : undefined;
        return <span className="pct" style={{ color }}>{pct(p)}</span>;
      },
    },
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
          <span className="ctrl-label">Min Offered</span>
          <select value={minOffered} onChange={(e) => setMinOffered(Number(e.target.value))}>
            {MIN_OFFERED_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Search</span>
          <input
            className="search-input"
            placeholder="Filter potions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      <div className="charts-row col2">
        <div className="chart-card">
          <h3>Pick Rate (Top 20 by Offered)</h3>
          <HBarChart
            data={topByOffered.map((p) => ({ label: formatName(p.potion_id), value: +((p.pick_rate ?? 0) * 100).toFixed(1) }))}
            color="#9b7ec8"
            height={Math.max(180, topByOffered.length * 32)}
            valueFormatter={(v) => `${v}%`}
          />
        </div>
        <div className="chart-card">
          <h3>Use Rate (Top 15 by Used)</h3>
          <p className="dim" style={{ fontSize: '.75rem', margin: '0 0 .75rem' }}>
            % of obtained potions that were actually used (not discarded or held)
          </p>
          <HBarChart
            data={topUsed.map((p) => ({ label: formatName(p.potion_id), value: +((p.use_rate ?? 0) * 100).toFixed(1) }))}
            color="#5b8dd9"
            height={Math.max(180, topUsed.length * 32)}
            valueFormatter={(v) => `${v}%`}
          />
        </div>
      </div>

      {usageByRoom.length > 0 && (
        <div className="charts-row col2">
          <div className="chart-card">
            <h3>Usage by Room Type</h3>
            <HBarChart
              data={usageByRoom.map((u) => ({ label: formatName(u.room_type), value: u.times_used }))}
              colorFn={(label) => ROOM_COLORS[label.toLowerCase().replace(/ /g, '_')] ?? '#888'}
              height={Math.max(120, usageByRoom.length * 40)}
            />
          </div>
          <div className="chart-card">
            <h3>Boss vs Elsewhere</h3>
            <p className="dim" style={{ fontSize: '.75rem', margin: '0 0 .75rem' }}>
              % of each potion's uses that happened at boss fights
            </p>
            <SortableTable
              columns={bossUsageCols}
              rows={bossUsage}
              defaultSortKey="boss_use_pct"
            />
          </div>
        </div>
      )}

      <div className="tcard">
        <div className="tcard-head">
          <span className="tcard-title">All Potions</span>
          <span className="dim" style={{ fontSize: '.75rem' }}>{filteredStats.length} potions</span>
        </div>
        <SortableTable
          columns={statCols}
          rows={filteredStats}
          defaultSortKey="times_offered"
        />
      </div>
    </div>
  );
}
