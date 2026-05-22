import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../api/client.js';

interface Status {
  total_runs: number;
  last_ingested: string | null;
}

export default function Header() {
  const { data } = useQuery<Status>({
    queryKey: ['status'],
    queryFn: () => api.getStatus() as Promise<Status>,
    refetchInterval: 10_000,
  });

  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as { type: string };
      if (ev.type === 'connected') setConnected(true);
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const fmt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <header className="header">
      <div className="header-brand">
        <span className="header-skull">☠</span>
        <div>
          <div className="header-title">Spire Codex</div>
          <div className="header-sub">Slay the Spire 2 — Run Analytics</div>
        </div>
      </div>
      <div className="header-meta">
        <span className={`sse-dot ${connected ? 'connected' : ''}`} title={connected ? 'Live' : 'Connecting…'} />
        {data && (
          <>
            <span>{data.total_runs} runs</span>
            {data.last_ingested && <span>last: {fmt(data.last_ingested)}</span>}
          </>
        )}
      </div>
    </header>
  );
}
