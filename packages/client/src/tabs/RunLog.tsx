import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import CharacterSelect from '../components/shared/CharacterSelect.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import { useStore } from '../store.js';

interface Run {
  id: number;
  character: string;
  victory: number;
  ascension: number;
  floor_reached: number;
  final_gold: number | null;
  run_time: number | null;
  killed_by: string | null;
  timestamp: string | null;
  acts: string | null;
}
interface RunsResponse { runs: Run[]; total: number; page: number; limit: number; }

const fmtTime = (s: number | null) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
};

export default function RunLog() {
  const { selectedCharacter, setSelectedCharacter } = useStore();
  const [result, setResult] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  const chars = useQuery<string[]>({
    queryKey: ['characters'],
    queryFn: async () => {
      const r = await api.getOverview() as { winByChar: { character: string }[] };
      return r.winByChar.map((c) => c.character).sort();
    },
  });

  const { data, isLoading } = useQuery<RunsResponse>({
    queryKey: ['runs', selectedCharacter, result, search, page],
    queryFn: () => api.getRuns({
      ...(selectedCharacter ? { character: selectedCharacter } : {}),
      ...(result ? { result } : {}),
      ...(search ? { search } : {}),
      page: String(page),
      limit: String(limit),
    }) as Promise<RunsResponse>,
  });

  const cols: Column<Run>[] = [
    {
      key: 'character', label: 'Character',
      render: (v) => <span>{String(v).replace(/_/g, ' ')}</span>,
    },
    {
      key: 'victory', label: 'Result',
      render: (v) => v ? <span className="badge-win">Win</span> : <span className="badge-loss">Loss</span>,
    },
    { key: 'ascension', label: 'Asc', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'floor_reached', label: 'Floor', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'final_gold', label: 'Gold', render: (v) => <span className="num">{v == null ? '—' : String(v)}</span> },
    { key: 'run_time', label: 'Time', render: (v) => <span className="num">{fmtTime(v as number | null)}</span> },
    { key: 'killed_by', label: 'Killed By', render: (v) => <span className="dim">{String(v ?? '—')}</span> },
    {
      key: 'acts', label: 'Route',
      render: (v) => {
        if (!v) return <span className="dim">—</span>;
        const acts = JSON.parse(String(v)) as string[];
        return <span>{acts.join(' → ')}</span>;
      },
    },
    {
      key: 'timestamp', label: 'Date',
      render: (v) => <span className="dim">{v ? new Date(String(v)).toLocaleDateString() : '—'}</span>,
    },
  ];

  const totalPages = data ? Math.ceil(data.total / limit) : 1;

  return (
    <div className="content">
      <div className="controls">
        <CharacterSelect
          value={selectedCharacter}
          onChange={(c) => { setSelectedCharacter(c); setPage(1); }}
          characters={chars.data ?? []}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Result</span>
          <select value={result} onChange={(e) => { setResult(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="win">Wins</option>
            <option value="loss">Losses</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span className="ctrl-label">Search</span>
          <input
            className="search-input"
            placeholder="Character, killer…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </label>
      </div>

      {isLoading && <div className="loading">Loading…</div>}

      {data && (
        <>
          <div className="tcard">
            <div className="tcard-head">
              <span className="tcard-title">Run Log</span>
              <span className="dim" style={{ fontSize: '.75rem' }}>{data.total} runs</span>
            </div>
            <SortableTable columns={cols} rows={data.runs} defaultSortKey="timestamp" />
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ background: 'var(--s3)', border: '1px solid var(--border2)', color: 'var(--text)', padding: '.35rem .75rem', borderRadius: 5, cursor: 'pointer' }}
              >
                ← Prev
              </button>
              <span className="dim">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{ background: 'var(--s3)', border: '1px solid var(--border2)', color: 'var(--text)', padding: '.35rem .75rem', borderRadius: 5, cursor: 'pointer' }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
