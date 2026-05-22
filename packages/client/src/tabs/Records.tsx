import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client.js';
import KpiCard from '../components/shared/KpiCard.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import { useStore } from '../store.js';
import { formatName } from '../utils/format.js';

interface RunSummary {
  id: number; character: string; ascension: number; seed: string | null;
  run_time: number | null; floor_reached: number; deck_size: number | null;
  total_damage_taken: number | null; elite_count: number | null; victory: number;
}
interface PersonalBests {
  fastest_win: RunSummary | null; least_damage_win: RunSummary | null;
  smallest_deck_win: RunSummary | null; most_elites_win: RunSummary | null;
  highest_asc_win: RunSummary | null;
}
interface Streaks {
  current_win_streak: number; current_loss_streak: number;
  longest_win_streak: number; longest_loss_streak: number;
}
interface FunStats {
  total_runs: number; total_time_played_s: number; total_floors_climbed: number;
  total_damage_taken: number; total_gold_earned: number; gold_hoarded_at_death: number;
  most_common_death_floor: number | null; most_common_death_floor_count: number | null;
  luckiest_win: RunSummary | null; unluckiest_loss: RunSummary | null;
}
interface RecordsData { personal_bests: PersonalBests; streaks: Streaks; fun_stats: FunStats; }
interface WinFingerprint {
  win_avg_deck_size: number | null; loss_avg_deck_size: number | null;
  win_avg_upgrade_rate: number | null; loss_avg_upgrade_rate: number | null;
  win_avg_cards_purged: number | null; loss_avg_cards_purged: number | null;
}

const fmtTime = (s: number | null | undefined) => {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const fmtRunTime = (s: number | null | undefined) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

const num = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString();
const pct = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const f1 = (v: number | null | undefined) => v == null ? '—' : v.toFixed(1);

function runLabel(r: RunSummary | null) {
  if (!r) return '—';
  return `${formatName(r.character)} A${r.ascension}`;
}

export default function Records() {
  const { selectedCharacter, setSelectedCharacter } = useStore();

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<RecordsData>({
    queryKey: ['records', selectedCharacter],
    queryFn: () => api.getRecords(selectedCharacter || undefined) as Promise<RecordsData>,
  });

  const { data: fingerprint } = useQuery<WinFingerprint>({
    queryKey: ['win-fingerprint', selectedCharacter],
    queryFn: () => api.getWinFingerprint(selectedCharacter || undefined) as Promise<WinFingerprint>,
  });

  if (isLoading) return <div className="loading">Loading…</div>;
  if (!data) return null;

  const { personal_bests: pb, streaks, fun_stats: fs } = data;

  const fingerprintRows = fingerprint ? [
    { metric: 'Avg Deck Size', wins: f1(fingerprint.win_avg_deck_size), losses: f1(fingerprint.loss_avg_deck_size) },
    { metric: 'Avg Upgrade Rate', wins: pct(fingerprint.win_avg_upgrade_rate), losses: pct(fingerprint.loss_avg_upgrade_rate) },
    { metric: 'Avg Cards Purged', wins: f1(fingerprint.win_avg_cards_purged), losses: f1(fingerprint.loss_avg_cards_purged) },
  ] : [];

  const fpCols: Column<(typeof fingerprintRows)[0]>[] = [
    { key: 'metric', label: 'Metric' },
    { key: 'wins', label: 'Wins', render: (v) => <span className="num win">{String(v)}</span> },
    { key: 'losses', label: 'Losses', render: (v) => <span className="num loss">{String(v)}</span> },
  ];

  return (
    <div className="content">
      <div className="controls">
        <CharacterSelect
          value={selectedCharacter}
          onChange={setSelectedCharacter}
          characters={chars.data ?? []}
        />
      </div>

      <div className="section-label">Personal Bests</div>
      <div className="kpi-row">
        <KpiCard
          value={fmtRunTime(pb.fastest_win?.run_time)}
          label={`Fastest Win — ${runLabel(pb.fastest_win)}`}
        />
        <KpiCard
          value={num(pb.least_damage_win?.total_damage_taken)}
          label={`Least Damage — ${runLabel(pb.least_damage_win)}`}
        />
        <KpiCard
          value={num(pb.smallest_deck_win?.deck_size)}
          label={`Smallest Deck — ${runLabel(pb.smallest_deck_win)}`}
        />
        <KpiCard
          value={num(pb.most_elites_win?.elite_count)}
          label={`Most Elites — ${runLabel(pb.most_elites_win)}`}
        />
        <KpiCard
          value={pb.highest_asc_win ? `A${pb.highest_asc_win.ascension}` : '—'}
          label={`Highest Ascension Win — ${formatName(pb.highest_asc_win?.character ?? null)}`}
        />
      </div>

      <div className="section-label">Streaks</div>
      <div className="kpi-row">
        <KpiCard value={streaks.current_win_streak} label="Current Win Streak" className="win" />
        <KpiCard value={streaks.longest_win_streak} label="Longest Win Streak" className="win" />
        <KpiCard value={streaks.current_loss_streak} label="Current Loss Streak" className="loss" />
        <KpiCard value={streaks.longest_loss_streak} label="Longest Loss Streak" className="loss" />
      </div>

      <div className="section-label">Fun Stats</div>
      <div className="kpi-row">
        <KpiCard value={num(fs.total_runs)} label="Total Runs" />
        <KpiCard value={fmtTime(fs.total_time_played_s)} label="Time Played" />
        <KpiCard value={num(fs.total_floors_climbed)} label="Floors Climbed" />
        <KpiCard value={num(fs.total_damage_taken)} label="Total Damage Taken" />
        <KpiCard value={num(fs.total_gold_earned)} label="Gold Earned" />
      </div>
      <div className="kpi-row">
        <KpiCard value={num(fs.gold_hoarded_at_death)} label="Gold Hoarded at Death" />
        <KpiCard
          value={fs.most_common_death_floor != null ? `F${fs.most_common_death_floor}` : '—'}
          label={`Most Common Death Floor${fs.most_common_death_floor_count != null ? ` (×${fs.most_common_death_floor_count})` : ''}`}
        />
        <KpiCard
          value={num(fs.luckiest_win?.total_damage_taken)}
          label={`Luckiest Win (most dmg, still won) — ${runLabel(fs.luckiest_win)}`}
        />
        <KpiCard
          value={`F${fs.unluckiest_loss?.floor_reached ?? '—'}`}
          label={`Unluckiest Loss (furthest floor) — ${runLabel(fs.unluckiest_loss)}`}
        />
      </div>

      {fingerprintRows.length > 0 && (
        <>
          <div className="section-label">Win Condition Fingerprint</div>
          <div className="tcard">
            <div className="tcard-head">
              <span className="tcard-title">Avg Stats — Wins vs Losses</span>
            </div>
            <SortableTable columns={fpCols} rows={fingerprintRows} defaultSortKey="metric" />
          </div>
        </>
      )}
    </div>
  );
}
