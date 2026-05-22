import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import EntityTooltip from '../shared/EntityTooltip.js';

type EntityType = 'card' | 'relic' | 'monster' | 'event';

interface HBarChartProps {
  data: { label: string; value: number }[];
  color?: string;
  colorFn?: (label: string, index: number) => string;
  valueFormatter?: (v: number) => string;
  height?: number;
  entityType?: EntityType;
}

function CustomTick({ x, y, payload, entityType, width }: {
  x: number;
  y: number;
  payload: { value: string };
  entityType: EntityType;
  width: number;
}) {
  return (
    <foreignObject x={x - width} y={y - 10} width={width} height={20}>
      <EntityTooltip name={payload.value} entityType={entityType}>
        <span style={{ fontSize: 11, color: '#ccc8c0', whiteSpace: 'nowrap', cursor: 'default', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {payload.value}
        </span>
      </EntityTooltip>
    </foreignObject>
  );
}

export default function HBarChart({
  data,
  color = '#c9903c',
  colorFn,
  valueFormatter,
  height = 260,
  entityType,
}: HBarChartProps) {
  if (!data.length) return <div className="empty">No data</div>;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#252840" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: '#6a6880', fontSize: 11, fontFamily: 'JetBrains Mono' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={valueFormatter}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={entityType
            ? (props: { x: number; y: number; payload: { value: string } }) =>
                <CustomTick {...props} entityType={entityType} width={110} />
            : { fill: '#ccc8c0', fontSize: 11 }
          }
          axisLine={false}
          tickLine={false}
          width={110}
        />
        <Tooltip
          contentStyle={{ background: '#1b1f35', border: '1px solid #2e3350', borderRadius: 6 }}
          labelStyle={{ color: '#e8b86d' }}
          itemStyle={{ color: '#ccc8c0' }}
          formatter={valueFormatter ? (v: number) => [valueFormatter(v)] : undefined}
        />
        <Bar dataKey="value" radius={[0, 3, 3, 0]}>
          {data.map((entry, i) => {
            const c = colorFn ? colorFn(entry.label, i) : color;
            return <Cell key={i} fill={`${c}bb`} stroke={c} strokeWidth={1} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
