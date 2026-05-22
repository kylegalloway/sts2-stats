import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import HBarChart from '../components/charts/HBarChart.js';
import { useStore } from '../store.js';
import { formatEnemy, formatName } from '../utils/format.js';

interface KillStat { killed_by: string; count: number; pct: number; }
interface BossStat {
  boss: string; act: string; total: number; wins: number; losses: number;
  win_rate: number | null; avg_hp_pct_wins: number | null; avg_hp_pct_losses: number | null;
}
interface EnemyInflectionStat {
  encounter_id: string; room_type: string | null;
  inflection_appearances: number; avg_damage_in_window: number | null;
  avg_hp_deficit: number | null; avg_floor_reached: number | null;
  win_rate: number | null; kill_count: number;
}

const pct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

export default function Deaths() {
  const { selectedCharacter, setSelectedCharacter } = useStore();
  const [search, setSearch] = useState('');

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<{ kills: KillStat[] }>({
    queryKey: ['kills', selectedCharacter],
    queryFn: () => api.getKills(selectedCharacter || undefined) as Promise<{ kills: KillStat[] }>,
  });

  const { data: bossData } = useQuery<{ bosses: BossStat[] }>({
    queryKey: ['boss-stats', selectedCharacter],
    queryFn: () => api.getBossStats(selectedCharacter || undefined) as Promise<{ bosses: BossStat[] }>,
  });

  const { data: inflectionData } = useQuery<{ enemies: EnemyInflectionStat[] }>({
    queryKey: ['enemy-inflection', selectedCharacter],
    queryFn: () => api.getEnemyInflection(selectedCharacter || undefined) as Promise<{ enemies: EnemyInflectionStat[] }>,
  });

  const cols: Column<KillStat>[] = [
    { key: 'killed_by', label: 'Killed By', render: (v) => <span>{formatEnemy(v as string)}</span> },
    { key: 'count', label: 'Deaths', render: (v) => <span className="num loss">{String(v)}</span> },
    { key: 'pct', label: '% of Deaths', render: (v) => <span className="pct">{((v as number) * 100).toFixed(1)}%</span> },
  ];

  const inflectionCols: Column<EnemyInflectionStat>[] = [
    { key: 'encounter_id', label: 'Enemy', render: (v) => <span>{formatEnemy(v as string)}</span> },
    { key: 'room_type', label: 'Room', render: (v) => <span>{formatName(v as string | null)}</span> },
    { key: 'inflection_appearances', label: 'Inflection Runs', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'avg_damage_in_window', label: 'Avg Dmg (Window)', render: (v) => <span className="num loss">{v == null ? '—' : (v as number).toFixed(1)}</span> },
    { key: 'avg_hp_deficit', label: 'Avg HP Deficit', render: (v) => <span className="num loss">{v == null ? '—' : `${((v as number) * 100).toFixed(1)}%`}</span> },
    { key: 'win_rate', label: 'Win%', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
    { key: 'kill_count', label: 'Kill Count', render: (v) => <span className="num loss">{String(v)}</span> },
  ];

  const bossCols: Column<BossStat>[] = [
    { key: 'boss', label: 'Boss', render: (v) => <span>{formatEnemy(v as string)}</span> },
    { key: 'act', label: 'Act' },
    { key: 'total', label: 'Faced', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'wins', label: 'Wins', render: (v) => <span className="num win">{String(v)}</span> },
    { key: 'losses', label: 'Losses', render: (v) => <span className="num loss">{String(v)}</span> },
    { key: 'win_rate', label: 'Win%', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
    { key: 'avg_hp_pct_wins', label: 'Entry HP% (W)', render: (v) => <span className="num win">{pct(v as number | null)}</span> },
    { key: 'avg_hp_pct_losses', label: 'Entry HP% (L)', render: (v) => <span className="num loss">{pct(v as number | null)}</span> },
  ];

  const top15 = (data?.kills ?? []).slice(0, 15);

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
          <span className="ctrl-label">Search</span>
          <input
            className="search-input"
            placeholder="Filter killer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>

      {top15.length > 0 && (
        <div className="charts-row col1">
          <div className="chart-card">
            <h3>Top 15 Causes of Death</h3>
            <HBarChart
              data={top15.map((k) => ({ label: formatEnemy(k.killed_by), value: k.count }))}
              color="#e05c5c"
              height={Math.max(200, top15.length * 36)}
            />
          </div>
        </div>
      )}

      {(bossData?.bosses ?? []).length > 0 && (
        <div className="tcard">
          <div className="tcard-head"><span className="tcard-title">Boss Encounters</span></div>
          <SortableTable
            columns={bossCols}
            rows={bossData!.bosses}
            defaultSortKey="total"
          />
        </div>
      )}

      {(inflectionData?.enemies ?? []).length > 0 && (
        <div className="tcard">
          <div className="tcard-head"><span className="tcard-title">Inflection Enemies</span></div>
          <p className="tcard-desc">Enemies that appeared during your worst 3-floor HP drops — sorted by how far below average HP you were at that moment.</p>
          <SortableTable
            columns={inflectionCols}
            rows={inflectionData!.enemies}
            defaultSortKey="avg_hp_deficit"
          />
        </div>
      )}

      <div className="tcard">
        <div className="tcard-head"><span className="tcard-title">Death Log</span></div>
        <SortableTable
          columns={cols}
          rows={data?.kills ?? []}
          defaultSortKey="count"
          filterText={search}
          filterKeys={['killed_by']}
        />
      </div>
    </div>
  );
}
