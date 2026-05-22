import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import LineChart from '../components/charts/LineChart.js';
import { useStore } from '../store.js';

interface FloorStat { floor: number; avg_hp_pct: number | null; avg_gold: number | null; sample_size: number; }

export default function HpGold() {
  const { selectedCharacter, setSelectedCharacter } = useStore();

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<{ floors: FloorStat[] }>({
    queryKey: ['hp-gold', selectedCharacter],
    queryFn: () => api.getHpGold(selectedCharacter || undefined) as Promise<{ floors: FloorStat[] }>,
  });

  if (isLoading) return <div className="loading">Loading…</div>;

  const floors = data?.floors ?? [];

  const hpData = floors.map((f) => ({
    floor: f.floor,
    hp_pct: f.avg_hp_pct != null ? Math.round(f.avg_hp_pct * 100) : null,
  }));

  const goldData = floors.map((f) => ({
    floor: f.floor,
    gold: f.avg_gold != null ? Math.round(f.avg_gold) : null,
  }));

  return (
    <div className="content">
      <div className="controls">
        <CharacterSelect
          value={selectedCharacter}
          onChange={setSelectedCharacter}
          characters={chars.data ?? []}
        />
      </div>

      <div className="charts-row col1">
        <div className="chart-card">
          <h3>Average HP % per Floor</h3>
          <LineChart
            data={hpData}
            xKey="floor"
            series={[{ dataKey: 'hp_pct', label: 'Avg HP %', color: '#52b875' }]}
            yTickFormatter={(v) => `${v}%`}
            xTickFormatter={(v) => `F${v}`}
            height={300}
          />
        </div>
      </div>

      <div className="charts-row col1">
        <div className="chart-card">
          <h3>Average Gold per Floor</h3>
          <LineChart
            data={goldData}
            xKey="floor"
            series={[{ dataKey: 'gold', label: 'Avg Gold', color: '#c9903c' }]}
            xTickFormatter={(v) => `F${v}`}
            height={300}
          />
        </div>
      </div>
    </div>
  );
}
