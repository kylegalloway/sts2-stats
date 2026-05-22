import {
  LineChart as ReLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

export interface LineSeries {
  dataKey: string;
  label: string;
  color: string;
  dot?: boolean;
}

export interface ReferenceLineSpec {
  x?: number;
  y?: number;
  label: string;
  color?: string;
}

interface LineChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: LineSeries[];
  yTickFormatter?: (v: number) => string;
  xTickFormatter?: (v: unknown) => string;
  height?: number;
  referenceLines?: ReferenceLineSpec[];
}

export default function LineChart({
  data,
  xKey,
  series,
  yTickFormatter,
  xTickFormatter,
  height = 280,
  referenceLines,
}: LineChartProps) {
  if (!data.length) return <div className="empty">No data</div>;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReLineChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#252840" />
        <XAxis
          dataKey={xKey}
          tick={{ fill: '#6a6880', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={xTickFormatter ? (v) => xTickFormatter(v) : undefined}
        />
        <YAxis
          tick={{ fill: '#6a6880', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={yTickFormatter}
        />
        <Tooltip
          contentStyle={{ background: '#1b1f35', border: '1px solid #2e3350', borderRadius: 6 }}
          labelStyle={{ color: '#e8b86d' }}
          itemStyle={{ color: '#ccc8c0' }}
        />
        {series.length > 1 && (
          <Legend wrapperStyle={{ color: '#ccc8c0', fontSize: 11 }} />
        )}
        {referenceLines?.map((rl, i) => (
          <ReferenceLine
            key={i}
            x={rl.x}
            y={rl.y}
            stroke={rl.color ?? '#4a4860'}
            strokeDasharray="4 3"
            strokeWidth={1.5}
            label={{ value: rl.label, fill: rl.color ?? '#6a6880', fontSize: 10, fontFamily: 'JetBrains Mono', position: rl.y != null ? 'insideTopLeft' : 'insideTopRight', dy: -4 }}
          />
        ))}
        {series.map((s) => (
          <Line
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.label}
            stroke={s.color}
            dot={s.dot ?? false}
            strokeWidth={2}
            connectNulls
          />
        ))}
      </ReLineChart>
    </ResponsiveContainer>
  );
}
