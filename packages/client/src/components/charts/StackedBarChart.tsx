import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

export interface BarSeries {
  dataKey: string;
  label: string;
  color: string;
}

interface StackedBarChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: BarSeries[];
  height?: number;
  xTickFormatter?: (v: unknown) => string;
}

export default function StackedBarChart({
  data,
  xKey,
  series,
  height = 260,
  xTickFormatter,
}: StackedBarChartProps) {
  if (!data.length) return <div className="empty">No data</div>;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#252840" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fill: '#6a6880', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={xTickFormatter ? (v) => xTickFormatter(v) : undefined}
        />
        <YAxis
          tick={{ fill: '#6a6880', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{ background: '#1b1f35', border: '1px solid #2e3350', borderRadius: 6 }}
          labelStyle={{ color: '#e8b86d' }}
          itemStyle={{ color: '#ccc8c0' }}
        />
        <Legend wrapperStyle={{ color: '#ccc8c0', fontSize: 11 }} />
        {series.map((s, i) => (
          <Bar key={s.dataKey} dataKey={s.dataKey} name={s.label} stackId="a"
            fill={s.color} radius={i === series.length - 1 ? [3, 3, 0, 0] : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
