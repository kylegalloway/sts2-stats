interface KpiCardProps {
  value: string | number;
  label: string;
  className?: string;
}

export default function KpiCard({ value, label, className }: KpiCardProps) {
  return (
    <div className={`kpi ${className ?? ''}`}>
      <div className="kpi-val">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  );
}
