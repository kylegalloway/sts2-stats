import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client.js';
import { parseCodexDescription } from '../../utils/format.js';

type EntityType = 'card' | 'relic' | 'monster' | 'event';

interface CodexData {
  id: string;
  name: string;
  description?: string;
  image_url?: string;
  rarity?: string;
  type?: string;
  cost?: string | number;
  color?: string;
}

interface Props {
  name: string;
  entityType: EntityType;
  children: React.ReactNode;
  disabled?: boolean;
}

const TOOLTIP_W = 280;
const TOOLTIP_H = 380;
const OFFSET = 14;

function clampPos(x: number, y: number) {
  const left = x + TOOLTIP_W + OFFSET > window.innerWidth ? x - TOOLTIP_W - OFFSET : x + OFFSET;
  const top = y + TOOLTIP_H + OFFSET > window.innerHeight ? y - TOOLTIP_H - OFFSET : y + OFFSET;
  return { left: Math.max(8, left), top: Math.max(8, top) };
}

export default function EntityTooltip({ name, entityType, children, disabled = false }: Props) {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const { data, isLoading } = useQuery({
    queryKey: ['codex', entityType, name],
    queryFn: () => api.getCodexEntity(entityType, name) as Promise<CodexData>,
    enabled: hovered && !disabled && !!name && name !== '—',
    staleTime: 24 * 60 * 60 * 1000,
    retry: false,
  });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mousePos.current = { x: e.clientX, y: e.clientY };
    if (hovered) setPos(clampPos(e.clientX, e.clientY));
  }, [hovered]);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    if (disabled || !name || name === '—') return;
    mousePos.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      setPos(clampPos(mousePos.current.x, mousePos.current.y));
      setHovered(true);
    }, 300);
  }, [disabled, name]);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setHovered(false);
    setPos(null);
  }, []);

  const imageUrl = useMemo(() => {
    if (!data?.image_url) return null;
    return data.image_url.startsWith('/')
      ? `https://spire-codex.com${data.image_url}`
      : data.image_url;
  }, [data?.image_url]);

  if (disabled || !name || name === '—') return <>{children}</>;

  return (
    <span
      className="entity-tooltip-anchor"
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {hovered && pos && createPortal(
        <div
          className="entity-tooltip-panel"
          style={{ top: pos.top, left: pos.left }}
        >
          {isLoading && <span className="dim" style={{ fontSize: '.8rem' }}>Loading…</span>}
          {!isLoading && !data && <span className="dim" style={{ fontSize: '.8rem' }}>No data found</span>}
          {data && (
            <>
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt={data.name}
                  className="entity-tooltip-img"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="entity-tooltip-name">{data.name}</div>
              {(data.rarity || data.type || data.cost != null) && (
                <div className="entity-tooltip-meta">
                  {data.rarity && (
                    <span className={`rarity-badge rarity-${data.rarity.toLowerCase()}`}>
                      {data.rarity}
                    </span>
                  )}
                  {data.type && <span>{data.type}</span>}
                  {data.cost != null && <span>Cost {data.cost}</span>}
                </div>
              )}
              {data.description && (
                <div className="entity-tooltip-desc">
                  {parseCodexDescription(data.description).map((seg, i) => {
                    if (seg.tag === 'br') return <br key={i} />;
                    if (seg.tag === 'energy') return <span key={i} className="codex-energy">{seg.text}⚡</span>;
                    if (seg.tag === 'star') return <span key={i} className="codex-star">{'★'.repeat(Number(seg.text))}</span>;
                    if (seg.tag !== 'plain') return <span key={i} className={`codex-${seg.tag}`}>{seg.text}</span>;
                    return <span key={i}>{seg.text}</span>;
                  })}
                </div>
              )}
            </>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}
