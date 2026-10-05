import { Badge } from "@/components/ui/badge";

export const PERIOD_STATUS = {
  open: { label: "Open", variant: "success" },
  upcoming: { label: "Not open yet", variant: "info" },
  closed: { label: "Closed", variant: "muted" },
};

export function PeriodStatusBadge({ status }) {
  const meta = PERIOD_STATUS[status] || PERIOD_STATUS.closed;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** 0-100 coverage bar with the percentage, or a dash when not submitted. */
export function CompletionBar({ value }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  const tone = value >= 80 ? "bg-success" : value >= 50 ? "bg-warning" : "bg-danger";
  return (
    <div className="flex min-w-[7rem] items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="w-12 text-right text-sm tabular-nums">{value.toFixed(1)}%</span>
    </div>
  );
}

export function percentOf(covered, planned) {
  const c = Number(covered);
  const p = Number(planned);
  if (!p || covered === "" || Number.isNaN(c) || Number.isNaN(p) || c < 0 || c > p) return null;
  return Math.round((c * 1000) / p) / 10;
}

export function localInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/** `days` after `from` (a datetime-local string or now), at 23:59. */
export function endOfDayAfter(days, from) {
  const start = from ? new Date(from) : new Date();
  const end = new Date(start.getTime() + days * 86400000);
  end.setHours(23, 59, 0, 0);
  return localInput(end);
}
