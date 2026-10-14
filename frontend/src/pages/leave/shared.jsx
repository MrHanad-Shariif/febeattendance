import { Badge } from "@/components/ui/badge";

export const REQUEST_VARIANTS = { pending: "warning", more_info: "info", approved: "success", rejected: "danger", withdrawn: "secondary" };
export const PHASE_VARIANTS = { upcoming: "info", active: "warning", completed: "secondary", cancelled: "secondary" };

export function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function dateRange(start, end) {
  if (!end) return `${fmtDate(start)} – (end not yet known)`;
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

export function RequestBadge({ row }) {
  return <Badge variant={REQUEST_VARIANTS[row.status] || "secondary"}>{row.status_label}</Badge>;
}

/** "3 days remaining", "Starts in 2 days", ... from a countdown payload. */
export function countdownText(c) {
  if (!c) return "";
  const days = (n) => `${n} day${n === 1 ? "" : "s"}`;
  if (c.phase === "upcoming") return c.starts_in_days === 0 ? "Starts today" : `Starts in ${days(c.starts_in_days)}`;
  if (c.phase === "active") return c.ongoing ? "Ongoing (no end date yet)" : `${days(c.days_remaining)} remaining`;
  if (c.phase === "completed") return "Completed";
  return "Cancelled";
}

export const EVENT_LABELS = {
  submitted: "Submitted",
  resubmitted: "Changed and sent again",
  more_info: "More information requested",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export function RequestHistory({ events }) {
  if (!events?.length) return null;
  return (
    <ol className="space-y-2 border-l pl-4 text-sm">
      {events.map((e) => (
        <li key={e.id}>
          <p className="font-medium">
            {EVENT_LABELS[e.action] || e.action}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {e.actor_name} · {new Date(e.created_at).toLocaleString()}
            </span>
          </p>
          {e.note && <p className="text-muted-foreground">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}
