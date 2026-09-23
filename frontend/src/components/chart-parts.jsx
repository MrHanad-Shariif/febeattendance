/** Shared pieces for Recharts so every chart matches the theme (light/dark). */

export const STATUS_COLORS = {
  on_time: "hsl(var(--success))",
  late: "hsl(var(--warning))",
  absent: "hsl(var(--danger))",
  left_early: "hsl(24 95% 53%)",
  no_checkout: "hsl(271 70% 55%)",
  not_yet: "hsl(var(--muted-foreground))",
};

export const AXIS_PROPS = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
};

export const GRID_PROPS = {
  stroke: "hsl(var(--border))",
  strokeDasharray: "3 3",
  vertical: false,
};

export function ChartTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-semibold text-popover-foreground">{labelFormatter ? labelFormatter(label) : label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill || p.stroke }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-medium text-popover-foreground">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ChartEmpty({ children = "No data for this period yet." }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>;
}
