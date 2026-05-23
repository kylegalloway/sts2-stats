import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import GlobalFilters from '../components/shared/GlobalFilters.js';
import EntityTooltip from '../components/shared/EntityTooltip.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import { useStore } from '../store.js';
import { formatName } from '../utils/format.js';

type Mode = 'win_rate' | 'floor_delta';

interface Synergy {
  character: string;
  card_id: string;
  relic_key: string;
  occurrences: number;
  win_rate: number;
  baseline_wr: number;
  lift: number;
  avg_floor: number;
  baseline_avg_floor: number;
  floor_delta: number;
}

interface Core {
  character: string;
  relics: string[];
  cards: string[];
  run_count: number;
  win_rate: number;
  baseline_wr: number;
  lift: number;
  avg_floor: number;
  baseline_avg_floor: number;
  floor_delta: number;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function liftClass(v: number) {
  if (v >= 1.3) return 'lift-high';
  if (v >= 1.1) return 'lift-med';
  if (v >= 0.9) return 'lift-low';
  return 'lift-neg';
}

function deltaClass(v: number) {
  if (v >= 5) return 'lift-high';
  if (v >= 2) return 'lift-med';
  if (v >= 0) return 'lift-low';
  return 'lift-neg';
}

function CoreCard({ core, mode }: { core: Core; mode: Mode }) {
  const isFloor = mode === 'floor_delta';
  return (
    <div className="core-card">
      <div className="core-header">
        <span className="core-char">{formatName(core.character)}</span>
        {isFloor ? (
          <span className={`core-lift ${deltaClass(core.floor_delta)}`}>
            {core.floor_delta >= 0 ? '+' : ''}{core.floor_delta.toFixed(1)} floors
          </span>
        ) : (
          <span className={`core-lift ${liftClass(core.lift)}`}>{core.lift.toFixed(2)}x</span>
        )}
        <span className="core-stats dim">
          {isFloor
            ? `avg floor ${core.avg_floor.toFixed(1)} · baseline ${core.baseline_avg_floor.toFixed(1)} · ${core.run_count} runs`
            : `${pct(core.win_rate)} win · ${core.run_count} runs · baseline ${pct(core.baseline_wr)}`}
        </span>
      </div>
      <div className="core-section">
        <span className="core-label">Relics</span>
        <div className="core-tags">
          {core.relics.map((r) => (
            <EntityTooltip key={r} name={r} entityType="relic">
              <span className="tag tag-relic">{formatName(r)}</span>
            </EntityTooltip>
          ))}
        </div>
      </div>
      <div className="core-section">
        <span className="core-label">Cards</span>
        <div className="core-tags">
          {core.cards.map((c) => (
            <EntityTooltip key={c} name={c} entityType="card">
              <span className="tag tag-card">{formatName(c)}</span>
            </EntityTooltip>
          ))}
        </div>
      </div>
    </div>
  );
}

const CARD_RARITIES = ['Common', 'Uncommon', 'Rare', 'Basic', 'Ancient', 'Curse', 'Status'];
const RELIC_RARITIES = ['Common', 'Ancient', 'Starter'];

export default function Synergies() {
  const { selectedCharacter, setSelectedCharacter, ascension, lastN } = useStore();
  const [minOcc, setMinOcc] = useState(3);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<Mode>('floor_delta');
  const [cardRarity, setCardRarity] = useState('');
  const [relicRarity, setRelicRarity] = useState('');

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<{ synergies: Synergy[] }>({
    queryKey: ['synergies', selectedCharacter, minOcc, ascension, lastN],
    queryFn: () => api.getSynergies(selectedCharacter || undefined, minOcc, ascension || undefined, lastN || undefined) as Promise<{ synergies: Synergy[] }>,
  });

  const { data: coresData, isLoading: coresLoading } = useQuery<{ cores: Core[] }>({
    queryKey: ['cores', selectedCharacter, minOcc, ascension, lastN],
    queryFn: () => api.getCores(selectedCharacter || undefined, minOcc, ascension || undefined, lastN || undefined) as Promise<{ cores: Core[] }>,
  });

  const { data: cachedCards } = useQuery<{ id: string; rarity: string | null; color: string | null }[]>({
    queryKey: ['codex-cached-cards'],
    queryFn: () => api.getCodexCachedCards(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: cachedRelics } = useQuery<{ id: string; rarity: string | null }[]>({
    queryKey: ['codex-cached-relics'],
    queryFn: () => api.getCodexCachedRelics(),
    staleTime: 5 * 60 * 1000,
  });

  const cardRarityMap = new Map<string, string>(
    (cachedCards ?? []).flatMap((c) => {
      if (!c.rarity) return [];
      return [[formatName(c.id), c.rarity]];
    })
  );

  const relicRarityMap = new Map<string, string>(
    (cachedRelics ?? []).flatMap((r) => {
      if (!r.rarity) return [];
      const tier = r.rarity.replace(/ Relic$/i, '');
      return [[formatName(r.id), tier]];
    })
  );

  const sharedCols: Column<Synergy>[] = [
    { key: 'character', label: 'Character', render: (v) => <span>{formatName(v as string)}</span> },
    { key: 'card_id', label: 'Card', render: (v) => <EntityTooltip name={v as string} entityType="card"><span>{formatName(v as string)}</span></EntityTooltip> },
    { key: 'relic_key', label: 'Relic', render: (v) => <EntityTooltip name={v as string} entityType="relic"><span>{formatName(v as string)}</span></EntityTooltip> },
    { key: 'occurrences', label: 'Runs', render: (v) => <span className="num">{String(v)}</span> },
  ];

  const cols: Column<Synergy>[] = mode === 'floor_delta'
    ? [
        ...sharedCols,
        { key: 'avg_floor', label: 'Avg Floor', render: (v) => <span className="num">{(v as number).toFixed(1)}</span> },
        { key: 'baseline_avg_floor', label: 'Baseline', render: (v) => <span className="num dim">{(v as number).toFixed(1)}</span> },
        {
          key: 'floor_delta', label: 'Floor Delta',
          render: (v) => {
            const n = v as number;
            return <span className={deltaClass(n)}>{n >= 0 ? '+' : ''}{n.toFixed(1)}</span>;
          },
        },
      ]
    : [
        ...sharedCols,
        { key: 'win_rate', label: 'Win Rate', render: (v) => <span className="pct">{pct(v as number)}</span> },
        { key: 'baseline_wr', label: 'Baseline', render: (v) => <span className="pct dim">{pct(v as number)}</span> },
        {
          key: 'lift', label: 'Lift',
          render: (v) => <span className={liftClass(v as number)}>{(v as number).toFixed(2)}x</span>,
        },
      ];

  if (isLoading) return <div className="loading">Loading…</div>;

  const filteredCores = (coresData?.cores ?? []).filter((core) => {
    if (cardRarity && !core.cards.some((c) => cardRarityMap.get(formatName(c)) === cardRarity)) return false;
    if (relicRarity && !core.relics.some((r) => relicRarityMap.get(formatName(r)) === relicRarity)) return false;
    return true;
  });

  const filteredSynergies = (data?.synergies ?? []).filter((s) => {
    if (cardRarity && cardRarityMap.get(formatName(s.card_id)) !== cardRarity) return false;
    if (relicRarity && relicRarityMap.get(formatName(s.relic_key)) !== relicRarity) return false;
    return true;
  });

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
          <span className="ctrl-label">Min Runs</span>
          <select value={minOcc} onChange={(e) => setMinOcc(Number(e.target.value))}>
            {[2, 3, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="seg-group">
          <button
            className={`seg-btn${mode === 'floor_delta' ? ' seg-active' : ''}`}
            onClick={() => setMode('floor_delta')}
          >Floor Delta</button>
          <button
            className={`seg-btn${mode === 'win_rate' ? ' seg-active' : ''}`}
            onClick={() => setMode('win_rate')}
          >Win Rate</button>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Card Rarity</span>
          <select value={cardRarity} onChange={(e) => setCardRarity(e.target.value)}>
            <option value="">All</option>
            {CARD_RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Relic Rarity</span>
          <select value={relicRarity} onChange={(e) => setRelicRarity(e.target.value)}>
            <option value="">All</option>
            {RELIC_RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
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
          <span className="tcard-title">Build Cores</span>
          <span className="dim" style={{ fontSize: '.75rem' }}>
            Relic pairs that anchor winning runs, with cards that appear in ≥60% of those runs.
          </span>
        </div>
        {coresLoading ? (
          <div className="loading">Loading…</div>
        ) : filteredCores.length === 0 ? (
          <div className="empty-state">No cores found — try lowering the minimum runs threshold.</div>
        ) : (
          <div className="core-grid">
            {filteredCores.map((core, i) => <CoreCard key={i} core={core} mode={mode} />)}
          </div>
        )}
      </div>

      <div className="tcard">
        <div className="tcard-head">
          <span className="tcard-title">Card + Relic Synergies</span>
          <span className="dim" style={{ fontSize: '.75rem' }}>
            {mode === 'floor_delta'
              ? 'Floor Delta = avg floor reached with this combo minus your baseline.'
              : 'Lift = win rate ÷ baseline. 1.3x = 30% more wins than average.'}
          </span>
        </div>
        <SortableTable
          key={mode}
          columns={cols}
          rows={filteredSynergies}
          defaultSortKey={mode === 'floor_delta' ? 'floor_delta' : 'lift'}
          filterText={search}
          filterKeys={['card_id', 'relic_key', 'character']}
        />
      </div>
    </div>
  );
}
