import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import EntityTooltip from '../components/shared/EntityTooltip.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import HBarChart from '../components/charts/HBarChart.js';
import { useStore } from '../store.js';
import { formatName } from '../utils/format.js';

interface CardStat {
  card_id: string;
  offered: number;
  picked: number;
  pick_rate: number;
  win_rate: number | null;
  quality_score: number | null;
}
interface CardElo { card_id: string; elo: number; }
interface CardProgressionStat {
  card_id: string;
  times_offered: number;
  times_picked: number;
  pick_rate: number;
  avg_floor_when_picked: number | null;
  avg_floor_when_passed: number | null;
  floor_delta: number | null;
  global_avg_floor: number;
  overrated_score: number;
  underrated_score: number;
}
interface CardsResponse { cards: CardStat[]; elo: CardElo[]; progression: CardProgressionStat[]; }
interface SkipRateStat { act: string; total_choices: number; skipped: number; skip_rate: number; }

const pct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const num = (v: number | null) => v == null ? '—' : v.toFixed(0);
const fl = (v: number | null) => v == null ? '—' : v.toFixed(1);
const delta = (v: number | null) => {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}`;
};

const RARITIES = ['Common', 'Uncommon', 'Rare', 'Starter'];

export default function Cards() {
  const { selectedCharacter, setSelectedCharacter } = useStore();
  const [search, setSearch] = useState('');
  const [progSearch, setProgSearch] = useState('');
  const [selectedRarity, setSelectedRarity] = useState('');

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<CardsResponse>({
    queryKey: ['cards', selectedCharacter],
    queryFn: () => api.getCards(selectedCharacter || undefined) as Promise<CardsResponse>,
  });

  const { data: skipRates } = useQuery<SkipRateStat[]>({
    queryKey: ['card-skip-rates', selectedCharacter],
    queryFn: () => api.getCardSkipRates(selectedCharacter || undefined) as Promise<SkipRateStat[]>,
  });

  const { data: cachedCards } = useQuery<{ id: string; rarity: string | null; color: string | null }[]>({
    queryKey: ['codex-cached-cards'],
    queryFn: () => api.getCodexCachedCards(),
    staleTime: 5 * 60 * 1000,
  });

  const rarityMap = new Map<string, string>(
    (cachedCards ?? []).flatMap((c) => {
      if (!c.rarity) return [];
      const displayName = c.id.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
      return [[displayName, c.rarity]];
    })
  );

  if (isLoading) return <div className="loading">Loading…</div>;
  if (!data) return null;

  const topElo = data.elo.slice(0, 20);
  const topQuality = [...data.cards]
    .filter((c) => c.quality_score != null)
    .sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0))
    .slice(0, 20);

  const prog = data.progression ?? [];
  const topOverrated = [...prog]
    .filter((c) => c.overrated_score > 0)
    .sort((a, b) => b.overrated_score - a.overrated_score)
    .slice(0, 15);
  const topUnderrated = [...prog]
    .filter((c) => c.underrated_score > 0)
    .sort((a, b) => b.underrated_score - a.underrated_score)
    .slice(0, 15);

  const filteredCards = selectedRarity
    ? data.cards.filter((c) => rarityMap.get(formatName(c.card_id)) === selectedRarity)
    : data.cards;

  const mainCols: Column<CardStat>[] = [
    {
      key: 'card_id', label: 'Card',
      render: (v) => (
        <EntityTooltip name={formatName(v as string)} entityType="card">
          <span>{formatName(v as string)}</span>
        </EntityTooltip>
      ),
    },
    { key: 'offered', label: 'Seen', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'picked', label: 'Picked', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'pick_rate', label: 'Pick Rate', render: (v) => <span className="pct">{pct(v as number)}</span> },
    { key: 'win_rate', label: 'Win Rate', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
    { key: 'quality_score', label: 'Quality', render: (v) => <span className="num">{v == null ? '—' : (v as number).toFixed(3)}</span> },
  ];

  const progCols: Column<CardProgressionStat>[] = [
    {
      key: 'card_id', label: 'Card',
      render: (v) => (
        <EntityTooltip name={formatName(v as string)} entityType="card">
          <span>{formatName(v as string)}</span>
        </EntityTooltip>
      ),
    },
    { key: 'times_offered', label: 'Offered', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'pick_rate', label: 'Pick Rate', render: (v) => <span className="pct">{pct(v as number)}</span> },
    { key: 'avg_floor_when_picked', label: 'Avg Floor (Took)', render: (v) => <span className="num">{fl(v as number | null)}</span> },
    { key: 'avg_floor_when_passed', label: 'Avg Floor (Passed)', render: (v) => <span className="num">{fl(v as number | null)}</span> },
    {
      key: 'floor_delta',
      label: 'Floor Δ',
      render: (v) => {
        const d = v as number | null;
        const color = d == null ? undefined : d > 0 ? '#40a070' : d < 0 ? '#c94040' : undefined;
        return <span className="num" style={{ color, fontWeight: d != null && Math.abs(d) > 3 ? 600 : undefined }}>{delta(d)}</span>;
      },
    },
    {
      key: 'overrated_score',
      label: 'Risk Score',
      render: (v) => <span className="num">{(v as number) > 0 ? (v as number).toFixed(2) : '—'}</span>,
    },
    {
      key: 'underrated_score',
      label: 'Opp Score',
      render: (v) => <span className="num">{(v as number) > 0 ? (v as number).toFixed(2) : '—'}</span>,
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
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Rarity</span>
          <select value={selectedRarity} onChange={(e) => setSelectedRarity(e.target.value)}>
            <option value="">All</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>

      {skipRates && skipRates.length > 0 && (
        <div className="charts-row col2">
          <div className="chart-card">
            <h3>Skip Rate by Act</h3>
            <p className="dim" style={{ fontSize: '.75rem', margin: '0 0 .75rem' }}>
              % of card reward choices where no card was picked
            </p>
            <HBarChart
              data={skipRates.map((s) => ({ label: s.act, value: +(s.skip_rate * 100).toFixed(1) }))}
              color="#9b7ec8"
              height={Math.max(120, skipRates.length * 40)}
              valueFormatter={(v) => `${v}%`}
            />
          </div>
          <div className="chart-card">
            <h3>Skip Counts by Act</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
              <thead>
                <tr>
                  {['Act', 'Choices', 'Skipped', 'Skip %'].map((h) => (
                    <th key={h} style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #333', color: '#aaa' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skipRates.map((s) => (
                  <tr key={s.act}>
                    <td style={{ padding: '4px 8px' }}>{s.act}</td>
                    <td style={{ textAlign: 'right', padding: '4px 8px' }} className="num">{s.total_choices}</td>
                    <td style={{ textAlign: 'right', padding: '4px 8px' }} className="num">{s.skipped}</td>
                    <td style={{ textAlign: 'right', padding: '4px 8px' }} className="pct">{(s.skip_rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="charts-row col2">
        <div className="chart-card">
          <h3>Top 20 by ELO</h3>
          <HBarChart
            data={topElo.map((c) => ({ label: formatName(c.card_id), value: Math.round(c.elo) }))}
            color="#c9903c"
            height={Math.max(180, topElo.length * 32)}
          />
        </div>
        <div className="chart-card">
          <h3>Top 20 by Quality Score</h3>
          <HBarChart
            data={topQuality.map((c) => ({ label: formatName(c.card_id), value: +(c.quality_score ?? 0).toFixed(3) }))}
            color="#5b8dd9"
            height={Math.max(180, topQuality.length * 32)}
          />
        </div>
      </div>

      {(topOverrated.length > 0 || topUnderrated.length > 0) && (
        <>
          <div className="tcard" style={{ marginBottom: '1rem' }}>
            <div className="tcard-head">
              <span className="tcard-title">Floor Progression by Pick Decision</span>
              <span className="dim" style={{ fontSize: '.75rem' }}>
                Compares avg floor reached when you took vs passed a card (min 3 offers, 3+ pass samples)
              </span>
            </div>
          </div>
          <div className="charts-row col2">
            {topOverrated.length > 0 && (
              <div className="chart-card">
                <h3>Taking Too Often</h3>
                <p className="dim" style={{ fontSize: '.75rem', margin: '0 0 .75rem' }}>
                  High pick rate, but runs go fewer floors when you take it
                </p>
                <HBarChart
                  data={topOverrated.map((c) => ({
                    label: formatName(c.card_id),
                    value: +Math.abs(c.floor_delta ?? 0).toFixed(1),
                  }))}
                  color="#c94040"
                  height={Math.max(180, topOverrated.length * 32)}
                  valueFormatter={(v) => `${v} fl`}
                />
              </div>
            )}
            {topUnderrated.length > 0 && (
              <div className="chart-card">
                <h3>Worth Picking More</h3>
                <p className="dim" style={{ fontSize: '.75rem', margin: '0 0 .75rem' }}>
                  Low pick rate, but runs go more floors when you take it
                </p>
                <HBarChart
                  data={topUnderrated.map((c) => ({
                    label: formatName(c.card_id),
                    value: +(c.floor_delta ?? 0).toFixed(1),
                  }))}
                  color="#40a070"
                  height={Math.max(180, topUnderrated.length * 32)}
                  valueFormatter={(v) => `${v} fl`}
                />
              </div>
            )}
          </div>

          <div className="tcard">
            <div className="tcard-head">
              <span className="tcard-title">Progression Details</span>
              <span className="dim" style={{ fontSize: '.75rem' }}>{prog.length} cards</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginLeft: 'auto' }}>
                <input
                  className="search-input"
                  placeholder="Filter…"
                  value={progSearch}
                  onChange={(e) => setProgSearch(e.target.value)}
                  style={{ fontSize: '.8rem' }}
                />
              </label>
            </div>
            <SortableTable
              columns={progCols}
              rows={prog}
              defaultSortKey="floor_delta"
              filterText={progSearch}
              filterKeys={['card_id']}
            />
          </div>
        </>
      )}

      <div className="tcard">
        <div className="tcard-head">
          <span className="tcard-title">All Cards</span>
          <span className="dim" style={{ fontSize: '.75rem' }}>{filteredCards.length} cards</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginLeft: 'auto' }}>
            <input
              className="search-input"
              placeholder="Filter…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ fontSize: '.8rem' }}
            />
          </label>
        </div>
        <SortableTable
          columns={mainCols}
          rows={filteredCards}
          defaultSortKey="quality_score"
          filterText={search}
          filterKeys={['card_id']}
        />
      </div>
    </div>
  );
}
