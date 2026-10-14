import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const PERIODS = [
  { value: "daily", label: "Day" },
  { value: "weekly", label: "Week" },
  { value: "monthly", label: "Month" },
  { value: "semester", label: "Semester" },
  { value: "academic_year", label: "Academic year" },
  { value: "range", label: "Custom dates" },
  { value: "all", label: "All history" },
];

export function periodLabel(value) {
  return PERIODS.find((p) => p.value === value)?.label || value;
}

/** The period query parameters for the report endpoints. */
export function periodParams(q) {
  const p = { period: q.period };
  if (q.period === "daily" || q.period === "weekly") p.date = q.date;
  if (q.period === "monthly") p.month = q.month;
  if (q.period === "academic_year" && q.year) p.year = q.year;
  if (q.period === "range" || q.period === "semester") {
    if (q.from) p.from = q.from;
    if (q.to) p.to = q.to;
  }
  return p;
}

export function periodReady(q) {
  return q.period !== "range" || Boolean(q.from && q.to);
}

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Period select plus the date inputs that period needs. `q` holds
 * period, date, month, year, from, to; `set(patch)` updates it. */
export default function PeriodFields({ q, set, periods = PERIODS }) {
  return (
    <>
      <Field label="Period">
        <Select value={q.period} onValueChange={(v) => set({ period: v })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {(q.period === "daily" || q.period === "weekly") && (
        <Field label={q.period === "weekly" ? "Any day in the week" : "Date"}>
          <Input type="date" value={q.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        </Field>
      )}
      {q.period === "monthly" && (
        <Field label="Month">
          <Input type="month" value={q.month} onChange={(e) => e.target.value && set({ month: e.target.value })} />
        </Field>
      )}
      {q.period === "academic_year" && (
        <Field label="Academic year starting (blank = current)">
          <Input type="number" min={2000} max={2100} placeholder="e.g. 2026" value={q.year || ""} onChange={(e) => set({ year: e.target.value })} />
        </Field>
      )}
      {(q.period === "range" || q.period === "semester") && (
        <>
          <Field label={`From${q.period === "semester" ? " (default: semester start)" : ""}`}>
            <Input type="date" value={q.from} onChange={(e) => set({ from: e.target.value })} />
          </Field>
          <Field label={`To${q.period === "semester" ? " (default: semester end)" : ""}`}>
            <Input type="date" value={q.to} onChange={(e) => set({ to: e.target.value })} />
          </Field>
        </>
      )}
    </>
  );
}
