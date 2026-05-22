import { useState, useMemo } from 'react';

export interface Column<T> {
  key: keyof T | string;
  label: string;
  render?: (value: unknown, row: T) => React.ReactNode;
  sortValue?: (row: T) => number | string | null | undefined;
}

interface SortableTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  filterText?: string;
  filterKeys?: (keyof T | string)[];
  maxHeight?: string;
}

export default function SortableTable<T extends object>({
  columns,
  rows,
  defaultSortKey,
  defaultSortDir = 'desc',
  filterText = '',
  filterKeys,
  maxHeight = '520px',
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState<string>(defaultSortKey ?? (columns[0]?.key as string));
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir);

  const filtered = useMemo(() => {
    if (!filterText) return rows;
    const q = filterText.toLowerCase();
    const keys = filterKeys ?? columns.map((c) => c.key as keyof T);
    return rows.filter((row) => {
      const r = row as Record<string, unknown>;
      return keys.some((k) => String(r[k as string] ?? '').toLowerCase().includes(q));
    });
  }, [rows, filterText, filterKeys, columns]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    return [...filtered].sort((a, b) => {
      const ra = a as Record<string, unknown>;
      const rb = b as Record<string, unknown>;
      const av = col?.sortValue ? col.sortValue(a) : ra[sortKey];
      const bv = col?.sortValue ? col.sortValue(b) : rb[sortKey];
      const an = typeof av === 'number' ? av : parseFloat(String(av ?? ''));
      const bn = typeof bv === 'number' ? bv : parseFloat(String(bv ?? ''));
      const cmp = isNaN(an) || isNaN(bn)
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : an - bn;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, columns]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  if (rows.length === 0) return <div className="empty">No data yet. Play more runs!</div>;

  return (
    <div className="tcard-wrap" style={{ maxHeight }}>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key as string}
                data-dir={sortKey === col.key ? sortDir : undefined}
                onClick={() => toggleSort(col.key as string)}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}>
              {columns.map((col) => {
                const val = (row as Record<string, unknown>)[col.key as string];
                return (
                  <td key={col.key as string}>
                    {col.render ? col.render(val, row) : (val == null ? <span className="dim">—</span> : String(val))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
