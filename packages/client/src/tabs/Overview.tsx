import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client.js';
import KpiCard from '../components/shared/KpiCard.js';
import CharacterSelect, { charColor } from '../components/shared/CharacterSelect.js';
import SortableTable, { type Column } from '../components/shared/SortableTable.js';
import HBarChart from '../components/charts/HBarChart.js';
import LineChart, { type ReferenceLineSpec } from '../components/charts/LineChart.js';

interface OverviewData {
  kpis: { total_runs: number; total_wins: number; win_rate: number; avg_floor: number; avg_run_time: number };
  winByChar: { character: string; total: number; wins: number; win_rate: number }[];
  timeline: { id: number; character: string; victory: number; floor_reached: number; timestamp: string; ascension: number }[];
}
interface ActRoute { acts: string; total: number; wins: number; win_rate: number; avg_floor?: number; }
interface AscensionStat { ascension: number; total: number; wins: number; win_rate: number; }
interface PathCompositionRow { victory: number; act: string; node_type: string; node_count: number; run_count: number; }

const fmtTime = (s: number | null) => {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  return `${m}m`;
};

const pct = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

export default function Overview() {
  const [char, setChar] = useState('');

  const { data, isLoading } = useQuery<OverviewData>({
    queryKey: ['overview', char],
    queryFn: () => api.getOverview(char || undefined) as Promise<OverviewData>,
  });
  const { data: routes } = useQuery<ActRoute[]>({
    queryKey: ['act-routes', char],
    queryFn: async () => {
      const r = await api.getActRoutes() as { routes?: ActRoute[] } | ActRoute[];
      return Array.isArray(r) ? r : (r as { routes?: ActRoute[] }).routes ?? [];
    },
  });

  const { data: ascensionData } = useQuery<AscensionStat[]>({
    queryKey: ['ascension', char],
    queryFn: () => api.getAscensionStats(char || undefined) as Promise<AscensionStat[]>,
  });

  const { data: pathData } = useQuery<PathCompositionRow[]>({
    queryKey: ['path-composition', char],
    queryFn: () => api.getPathComposition(char || undefined) as Promise<PathCompositionRow[]>,
  });

  if (isLoading) return <div className="loading">Loading…</div>;
  if (!data) return null;

  const { kpis, winByChar, timeline } = data;

  const chars = [...new Set(timeline.map((r) => r.character))].sort();

  const charBarData = winByChar.map((c) => ({
    label: c.character.replace(/_/g, ' '),
    value: Math.round((c.win_rate ?? 0) * 100),
    color: charColor(c.character),
  }));

  const timelineData = timeline.map((r, i) => ({ x: i + 1, floor: r.floor_reached }));

  const ROLLING_WINDOW = 10;
  const rollingData = timeline.length >= ROLLING_WINDOW
    ? timeline.slice(ROLLING_WINDOW - 1).map((_, i) => {
        const idx = i + ROLLING_WINDOW - 1;
        const slice = timeline.slice(idx - ROLLING_WINDOW + 1, idx + 1);
        return { x: idx + 1, rate: Math.round(slice.filter((r) => r.victory).length / ROLLING_WINDOW * 100) };
      })
    : [];
  const overallWinRateLine: ReferenceLineSpec[] = kpis.win_rate != null
    ? [{ y: Math.round(kpis.win_rate * 100), label: `Overall ${pct(kpis.win_rate)}`, color: '#6a6880' }]
    : [];

  const ascBarData = (ascensionData ?? []).map((a) => ({
    label: `Asc ${a.ascension}`,
    value: Math.round((a.win_rate ?? 0) * 100),
  }));

  const ACT_ORDER: Record<string, number> = { 'Act 1': 0, 'Act 2': 1, 'Act 3+': 2 };
  const pathMap = new Map<string, { wins_avg: number | null; losses_avg: number | null }>();
  for (const row of (pathData ?? [])) {
    const key = `${row.act}||${row.node_type}`;
    if (!pathMap.has(key)) pathMap.set(key, { wins_avg: null, losses_avg: null });
    const entry = pathMap.get(key)!;
    const avg = row.run_count > 0 ? row.node_count / row.run_count : 0;
    if (row.victory === 1) entry.wins_avg = avg;
    else entry.losses_avg = avg;
  }
  const pathRows = [...pathMap.entries()]
    .map(([key, vals]) => {
      const [act, node_type] = key.split('||');
      return { act, node_type, wins_avg: vals.wins_avg, losses_avg: vals.losses_avg };
    })
    .sort((a, b) => (ACT_ORDER[a.act] ?? 3) - (ACT_ORDER[b.act] ?? 3) || a.node_type.localeCompare(b.node_type));

  const pathCols: Column<(typeof pathRows)[0]>[] = [
    { key: 'act', label: 'Act' },
    { key: 'node_type', label: 'Node Type', render: (v) => <span>{String(v).replace(/_/g, ' ')}</span> },
    { key: 'wins_avg', label: 'Avg/Run (Wins)', render: (v) => <span className="num win">{v != null ? (v as number).toFixed(2) : '—'}</span> },
    { key: 'losses_avg', label: 'Avg/Run (Losses)', render: (v) => <span className="num loss">{v != null ? (v as number).toFixed(2) : '—'}</span> },
  ];

  const recentCols: Column<(typeof timeline)[0]>[] = [
    { key: 'character', label: 'Character', render: (v) => <span>{String(v).replace(/_/g, ' ')}</span> },
    { key: 'victory', label: 'Result', render: (v) => v ? <span className="badge-win">Win</span> : <span className="badge-loss">Loss</span> },
    { key: 'ascension', label: 'Asc', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'floor_reached', label: 'Floor', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'timestamp', label: 'Date', render: (v) => <span className="dim">{v ? new Date(String(v)).toLocaleDateString() : '—'}</span> },
  ];

  const routeRows = (routes ?? []).map((r) => ({
    act1: r.acts ? JSON.parse(r.acts)[0] ?? '—' : '—',
    total: r.total,
    wins: r.wins,
    win_rate: r.win_rate,
  }));

  const routeCols: Column<(typeof routeRows)[0]>[] = [
    { key: 'act1', label: 'Act 1 Choice' },
    { key: 'total', label: 'Runs', render: (v) => <span className="num">{String(v)}</span> },
    { key: 'wins', label: 'Wins', render: (v) => <span className="num win">{String(v)}</span> },
    { key: 'win_rate', label: 'Win Rate', render: (v) => <span className="pct">{pct(v as number)}</span> },
  ];

  return (
    <div className="content">
      <div className="controls">
        <CharacterSelect value={char} onChange={setChar} characters={chars} />
      </div>

      <div className="kpi-row">
        <KpiCard value={kpis.total_runs} label="Total Runs" />
        <KpiCard value={pct(kpis.win_rate)} label="Win Rate" />
        <KpiCard value={Math.round(kpis.avg_floor ?? 0)} label="Avg Floor" />
        <KpiCard value={fmtTime(kpis.avg_run_time)} label="Avg Run Time" />
        <KpiCard value={kpis.total_wins} label="Wins" />
      </div>

      <div className="charts-row col2">
        <div className="chart-card">
          <h3>Win Rate by Character</h3>
          <HBarChart
            data={charBarData}
            valueFormatter={(v) => `${v}%`}
            height={Math.max(180, charBarData.length * 44)}
          />
        </div>
        <div className="chart-card">
          <h3>Floor Reached Over Time</h3>
          <LineChart
            data={timelineData}
            xKey="x"
            series={[{ dataKey: 'floor', label: 'Floor', color: '#5b8dd9' }]}
            xTickFormatter={(v) => `#${v}`}
          />
        </div>
      </div>

      <div className="charts-row col2">
        {rollingData.length > 0 && (
          <div className="chart-card">
            <h3>Rolling Win Rate ({ROLLING_WINDOW}-run window)</h3>
            <LineChart
              data={rollingData}
              xKey="x"
              series={[{ dataKey: 'rate', label: 'Win Rate', color: '#52b875' }]}
              xTickFormatter={(v) => `#${v}`}
              yTickFormatter={(v) => `${v}%`}
              referenceLines={overallWinRateLine}
            />
          </div>
        )}
        {ascBarData.length > 0 && (
          <div className="chart-card">
            <h3>Win Rate by Ascension</h3>
            <HBarChart
              data={ascBarData}
              color="#9b72cf"
              valueFormatter={(v) => `${v}%`}
              height={Math.max(180, ascBarData.length * 44)}
            />
          </div>
        )}
      </div>

      <div className="section-label">Recent Runs</div>
      <div className="tcard">
        <div className="tcard-head"><span className="tcard-title">Last {Math.min(20, timeline.length)} Runs</span></div>
        <SortableTable
          columns={recentCols}
          rows={[...timeline].reverse().slice(0, 20)}
          defaultSortKey="timestamp"
          defaultSortDir="desc"
        />
      </div>

      {routeRows.length > 0 && (
        <>
          <div className="section-label">Act Routes</div>
          <div className="tcard">
            <div className="tcard-head"><span className="tcard-title">Win Rate by Act 1 Choice</span></div>
            <SortableTable columns={routeCols} rows={routeRows} defaultSortKey="win_rate" />
          </div>
        </>
      )}

      {pathRows.length > 0 && (
        <>
          <div className="section-label">Path Composition</div>
          <div className="tcard">
            <div className="tcard-head"><span className="tcard-title">Avg Nodes per Run — Wins vs Losses</span></div>
            <SortableTable columns={pathCols} rows={pathRows} defaultSortKey="act" />
          </div>
        </>
      )}
    </div>
  );
}
