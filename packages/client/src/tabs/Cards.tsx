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

interface DimensionStat {
  group: string;
  total_cards: number;
  total_offered: number;
  total_picked: number;
  pick_rate: number;
  win_rate: number | null;
  avg_elo: number | null;
}
interface DimensionBreakdown {
  rarity: DimensionStat[];
  type: DimensionStat[];
  color: DimensionStat[];
  cost: DimensionStat[];
}
interface UpgradeImpact {
  card_id: string;
  runs_with_upgraded: number;
  runs_with_base: number;
  win_rate_upgraded: number | null;
  win_rate_base: number | null;
  avg_floor_upgraded: number | null;
  avg_floor_base: number | null;
}

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
interface EnchantmentStat { enchantment_id: string; total_runs: number; wins: number; win_rate: number; }

const pct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
const num = (v: number | null) => v == null ? '—' : v.toFixed(0);
const fl = (v: number | null) => v == null ? '—' : v.toFixed(1);
const delta = (v: number | null) => {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(1)}`;
};

const RARITIES = ['Common', 'Uncommon', 'Rare', 'Basic', 'Ancient', 'Curse', 'Status'];
const CARD_TYPES = ['Attack', 'Skill', 'Power', 'Curse', 'Status'];
const MIN_OFFERED_OPTIONS = [1, 3, 5, 10, 20];

export default function Cards() {
  const { selectedCharacter, setSelectedCharacter, ascension, lastN } = useStore();
  const [search, setSearch] = useState('');
  const [progSearch, setProgSearch] = useState('');
  const [legendOpen, setLegendOpen] = useState(false);
  const [selectedRarity, setSelectedRarity] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [minOffered, setMinOffered] = useState(1);

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<CardsResponse>({
    queryKey: ['cards', selectedCharacter, ascension, lastN],
    queryFn: () => api.getCards(selectedCharacter || undefined, ascension || undefined, lastN || undefined) as Promise<CardsResponse>,
  });

  const { data: skipRates } = useQuery<SkipRateStat[]>({
    queryKey: ['card-skip-rates', selectedCharacter, ascension, lastN],
    queryFn: () => api.getCardSkipRates(selectedCharacter || undefined, ascension || undefined, lastN || undefined) as Promise<SkipRateStat[]>,
  });

  const { data: cachedCards, refetch: refetchCachedCards } = useQuery<{ id: string; rarity: string | null; color: string | null }[]>({
    queryKey: ['codex-cached-cards'],
    queryFn: () => api.getCodexCachedCards(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: dimensionData, refetch: refetchDimension } = useQuery<DimensionBreakdown>({
    queryKey: ['cards-by-dimension', selectedCharacter, ascension, lastN],
    queryFn: () => api.getCardsByDimension(selectedCharacter || undefined, ascension || undefined, lastN || undefined) as Promise<DimensionBreakdown>,
  });

  const { data: upgradeData } = useQuery<{ upgrade_impact: UpgradeImpact[] }>({
    queryKey: ['cards-upgrade-impact', selectedCharacter, ascension, lastN],
    queryFn: () => api.getUpgradeImpact(selectedCharacter || undefined, ascension || undefined, lastN || undefined) as Promise<{ upgrade_impact: UpgradeImpact[] }>,
  });

  const { data: enchantmentData } = useQuery<{ enchantments: EnchantmentStat[] }>({
    queryKey: ['enchantments', selectedCharacter, ascension, lastN],
    queryFn: () => api.getEnchantments(selectedCharacter || undefined, ascension || undefined, lastN || undefined) as Promise<{ enchantments: EnchantmentStat[] }>,
  });

  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const handleSeedCodex = async () => {
    setSeedStatus('Seeding…');
    try {
      const result = await api.seedCodexCards() as { inserted?: number; error?: string };
      if (result.error) { setSeedStatus(`Error: ${result.error}`); return; }
      setSeedStatus(`Seeded ${result.inserted ?? 0} cards`);
      await Promise.all([refetchCachedCards(), refetchDimension()]);
    } catch {
      setSeedStatus('Seed failed');
    }
  };

  const rarityMap = new Map<string, string>(
    (cachedCards ?? []).flatMap((c) => {
      if (!c.rarity) return [];
      const displayName = c.id.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
      return [[displayName, c.rarity]];
    })
  );

  const typeMap = new Map<string, string>(
    (cachedCards ?? []).flatMap((c) => {
      if (!c.color) return [];
      const displayName = c.id.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
      // color field actually holds card type in the codex data
      return [[displayName, c.color]];
    })
  );

  if (isLoading) return <div className="loading">Loading…</div>;
  if (!data) return null;

  const inRarity = (cardId: string) =>
    !selectedRarity || rarityMap.get(formatName(cardId)) === selectedRarity;

  const inType = (cardId: string) =>
    !selectedType || typeMap.get(formatName(cardId)) === selectedType;

  const meetsMinOffered = (offered: number) => offered >= minOffered;

  const filteredCards = data.cards.filter((c) =>
    inRarity(c.card_id) && inType(c.card_id) && meetsMinOffered(c.offered)
  );

  // Lookup so ELO (which has no offered count) can also respect the min-seen threshold
  const offeredByCard = new Map(data.cards.map((c) => [c.card_id, c.offered]));

  const topElo = data.elo
    .filter((c) => inRarity(c.card_id) && inType(c.card_id) && meetsMinOffered(offeredByCard.get(c.card_id) ?? 0))
    .slice(0, 20);
  const topQuality = [...filteredCards]
    .filter((c) => c.quality_score != null)
    .sort((a, b) => (b.quality_score ?? 0) - (a.quality_score ?? 0))
    .slice(0, 20);

  // Progression uses `times_offered` (not `offered`) — apply the same threshold
  const prog = (data.progression ?? []).filter((c) =>
    inRarity(c.card_id) && inType(c.card_id) && meetsMinOffered(c.times_offered)
  );
  const topOverrated = [...prog]
    .filter((c) => c.overrated_score > 0 && c.floor_delta != null)
    .sort((a, b) => (a.floor_delta ?? 0) - (b.floor_delta ?? 0)) // most negative first
    .slice(0, 15);
  const topUnderrated = [...prog]
    .filter((c) => c.underrated_score > 0 && c.floor_delta != null)
    .sort((a, b) => (b.floor_delta ?? 0) - (a.floor_delta ?? 0)) // most positive first
    .slice(0, 15);

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
      label: 'Overrated',
      render: (v) => <span className="num">{(v as number) > 0 ? (v as number).toFixed(2) : '—'}</span>,
    },
    {
      key: 'underrated_score',
      label: 'Underrated',
      render: (v) => <span className="num">{(v as number) > 0 ? (v as number).toFixed(2) : '—'}</span>,
    },
  ];

  const upgradeCols: Column<UpgradeImpact>[] = [
    {
      key: 'card_id', label: 'Card',
      render: (v) => (
        <EntityTooltip name={formatName(v as string)} entityType="card">
          <span>{formatName(v as string)}</span>
        </EntityTooltip>
      ),
    },
    { key: 'runs_with_upgraded', label: 'Upgraded Runs', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'runs_with_base', label: 'Base Runs', render: (v) => <span className="num">{num(v as number)}</span> },
    { key: 'win_rate_upgraded', label: 'Win% Upgraded', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
    { key: 'win_rate_base', label: 'Win% Base', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
    { key: 'avg_floor_upgraded', label: 'Avg Floor Upgraded', render: (v) => <span className="num">{fl(v as number | null)}</span> },
    { key: 'avg_floor_base', label: 'Avg Floor Base', render: (v) => <span className="num">{fl(v as number | null)}</span> },
    {
      key: 'win_rate_upgraded',
      label: 'Win% Δ',
      render: (_v, row) => {
        const r = row as UpgradeImpact;
        const d = r.win_rate_upgraded != null && r.win_rate_base != null
          ? r.win_rate_upgraded - r.win_rate_base
          : null;
        const color = d == null ? undefined : d > 0 ? '#40a070' : d < 0 ? '#c94040' : undefined;
        return <span className="pct" style={{ color }}>{delta(d != null ? d * 100 : null)}{d != null ? '%' : ''}</span>;
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
          <span className="ctrl-label">Rarity</span>
          <select value={selectedRarity} onChange={(e) => setSelectedRarity(e.target.value)}>
            <option value="">All</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Type</span>
          <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
            <option value="">All</option>
            {CARD_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Min Seen</span>
          <select value={minOffered} onChange={(e) => setMinOffered(Number(e.target.value))}>
            {MIN_OFFERED_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}+</option>
            ))}
          </select>
        </label>
        <button
          onClick={handleSeedCodex}
          style={{ marginLeft: 'auto', fontSize: '.8rem', padding: '4px 10px', cursor: 'pointer' }}
          title="Fetch all card metadata from spire-codex.com"
        >
          Seed Codex Data
        </button>
        {seedStatus && <span className="dim" style={{ fontSize: '.8rem' }}>{seedStatus}</span>}
      </div>

      <div style={{ margin: '0 0 1rem' }}>
        <button
          onClick={() => setLegendOpen((o) => !o)}
          style={{ background: 'none', border: '1px solid #444', borderRadius: 4, color: '#aaa', fontSize: '.8rem', padding: '3px 10px', cursor: 'pointer' }}
        >
          {legendOpen ? '▾' : '▸'} Score glossary
        </button>
        {legendOpen && (
          <div style={{ marginTop: '.5rem', padding: '.75rem 1rem', background: '#1a1a2e', borderRadius: 6, border: '1px solid #333', fontSize: '.82rem', lineHeight: 1.6, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '.25rem .75rem', color: '#ccc' }}>
            <strong style={{ color: '#e0c97f' }}>ELO</strong>
            <span>Rating updated after every run — cards in winning decks gain points, cards in losing decks lose them. Higher = more consistent presence in winning runs.</span>
            <strong style={{ color: '#e0c97f' }}>Quality Score</strong>
            <span>Wilson lower-bound on win rate. Balances win% with sample size, so a 70% win rate over 50 runs ranks higher than 100% over 2 runs.</span>
            <strong style={{ color: '#e0c97f' }}>Floor Δ</strong>
            <span>Avg floor reached in runs where you took this card minus avg floor in runs where you passed it. Positive = taking it tends to go deeper.</span>
            <strong style={{ color: '#e0c97f' }}>Overrated</strong>
            <span>Pick rate × floor penalty: high pick rate card that correlates with shorter runs. Higher score = stronger signal you're taking it too often.</span>
            <strong style={{ color: '#e0c97f' }}>Underrated</strong>
            <span>Skip rate × floor bonus: low pick rate card that correlates with deeper runs when taken. Higher score = stronger signal it&apos;s worth picking more.</span>
          </div>
        )}
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
            entityType="card"
          />
        </div>
        <div className="chart-card">
          <h3>Top 20 by Quality Score</h3>
          <HBarChart
            data={topQuality.map((c) => ({ label: formatName(c.card_id), value: +(c.quality_score ?? 0).toFixed(3) }))}
            color="#5b8dd9"
            height={Math.max(180, topQuality.length * 32)}
            entityType="card"
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
                  You pick these often, but runs end earlier when you do. Sorted by largest floor penalty — consider passing more.
                </p>
                <HBarChart
                  data={topOverrated.map((c) => ({
                    label: formatName(c.card_id),
                    value: +Math.abs(c.floor_delta ?? 0).toFixed(1),
                  }))}
                  color="#c94040"
                  height={Math.max(180, topOverrated.length * 32)}
                  valueFormatter={(v) => `-${v} fl`}
                  entityType="card"
                />
              </div>
            )}
            {topUnderrated.length > 0 && (
              <div className="chart-card">
                <h3>Worth Picking More</h3>
                <p className="dim" style={{ fontSize: '.75rem', margin: '0 0 .75rem' }}>
                  You rarely take these, but runs go deeper when you do. Sorted by largest floor gain — consider picking more.
                </p>
                <HBarChart
                  data={topUnderrated.map((c) => ({
                    label: formatName(c.card_id),
                    value: +(c.floor_delta ?? 0).toFixed(1),
                  }))}
                  color="#40a070"
                  height={Math.max(180, topUnderrated.length * 32)}
                  valueFormatter={(v) => `+${v} fl`}
                  entityType="card"
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

      {dimensionData && (
        <>
          <div className="tcard" style={{ marginBottom: '1rem' }}>
            <div className="tcard-head">
              <span className="tcard-title">Pick Rate &amp; Win Rate by Card Dimension</span>
              <span className="dim" style={{ fontSize: '.75rem' }}>Only cards with spire-codex metadata. Color = card&apos;s home class.</span>
            </div>
          </div>
          <div className="charts-row col2">
            {dimensionData.rarity.length > 0 && (
              <div className="chart-card">
                <h3>By Rarity</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
                  <thead>
                    <tr>{['Rarity', 'Cards', 'Pick%', 'Win%'].map((h) => (
                      <th key={h} style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #333', color: '#aaa' }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {dimensionData.rarity.map((r) => (
                      <tr key={r.group}>
                        <td style={{ padding: '4px 8px' }}>{r.group}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="num">{r.total_cards}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="pct">{pct(r.pick_rate)}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="pct">{pct(r.win_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {dimensionData.type.length > 0 && (
              <div className="chart-card">
                <h3>By Type</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
                  <thead>
                    <tr>{['Type', 'Cards', 'Pick%', 'Win%'].map((h) => (
                      <th key={h} style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #333', color: '#aaa' }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {dimensionData.type.map((r) => (
                      <tr key={r.group}>
                        <td style={{ padding: '4px 8px' }}>{r.group}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="num">{r.total_cards}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="pct">{pct(r.pick_rate)}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="pct">{pct(r.win_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="charts-row col2">
            {dimensionData.cost.length > 0 && (
              <div className="chart-card">
                <h3>By Cost</h3>
                <HBarChart
                  data={[...dimensionData.cost]
                    .sort((a, b) => Number(a.group) - Number(b.group))
                    .map((r) => ({ label: `${r.group} energy`, value: +(r.pick_rate * 100).toFixed(1) }))}
                  color="#5b8dd9"
                  height={Math.max(100, dimensionData.cost.length * 36)}
                  valueFormatter={(v) => `${v}%`}
                />
              </div>
            )}
            {dimensionData.color.length > 0 && (
              <div className="chart-card">
                <h3>By Class</h3>
                <p className="dim" style={{ fontSize: '.75rem', margin: '0 0 .75rem' }}>
                  Card&apos;s home class — cross-class picks included
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
                  <thead>
                    <tr>{['Class', 'Cards', 'Pick%', 'Win%'].map((h) => (
                      <th key={h} style={{ textAlign: 'right', padding: '4px 8px', borderBottom: '1px solid #333', color: '#aaa' }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {dimensionData.color.map((r) => (
                      <tr key={r.group}>
                        <td style={{ padding: '4px 8px', textTransform: 'capitalize' }}>{r.group}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="num">{r.total_cards}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="pct">{pct(r.pick_rate)}</td>
                        <td style={{ textAlign: 'right', padding: '4px 8px' }} className="pct">{pct(r.win_rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {upgradeData && upgradeData.upgrade_impact.length > 0 && (
        <div className="tcard" style={{ marginBottom: '1rem' }}>
          <div className="tcard-head">
            <span className="tcard-title">Upgrade Impact</span>
            <span className="dim" style={{ fontSize: '.75rem' }}>
              Win rate &amp; avg floor reached with vs. without upgrade (min 3 runs each). Sorted by largest win rate delta.
            </span>
          </div>
          <SortableTable
            columns={upgradeCols}
            rows={upgradeData.upgrade_impact}
            defaultSortKey="win_rate_upgraded"
          />
        </div>
      )}

      {enchantmentData && enchantmentData.enchantments.length > 0 && (
        <div className="tcard">
          <div className="tcard-head">
            <span className="tcard-title">Enchantments</span>
            <span className="dim" style={{ fontSize: '.75rem' }}>Win rate by enchantment type on final deck cards</span>
          </div>
          <SortableTable
            columns={[
              { key: 'enchantment_id', label: 'Enchantment', render: (v) => <span>{formatName(v as string)}</span> },
              { key: 'total_runs', label: 'Runs', render: (v) => <span className="num">{num(v as number)}</span> },
              { key: 'wins', label: 'Wins', render: (v) => <span className="num win">{num(v as number)}</span> },
              { key: 'win_rate', label: 'Win Rate', render: (v) => <span className="pct">{pct(v as number | null)}</span> },
            ]}
            rows={enchantmentData.enchantments}
            defaultSortKey="total_runs"
          />
        </div>
      )}
    </div>
  );
}
