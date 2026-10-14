import { CalendarCheck, CalendarX2 } from "lucide-react";
import { useApi } from "@/components/committees/shared.jsx";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function when(n) {
  const day = new Date(`${n.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${day}${n.start_time ? `, ${n.start_time}${n.end_time ? `–${n.end_time}` : ""}` : ""}`;
}

/** Student dashboard: officially cancelled classes (today's first and
 * highlighted), and cancellations that were withdrawn. Hidden when empty. */
export default function ClassNotices() {
  const { data } = useApi("/student/class-notices", []);
  if (!data?.length) return null;
  const today = data.filter((n) => n.is_today && n.status === "cancelled");
  return (
    <Card className={today.length ? "border-danger/60 bg-danger/5" : "border-warning/50"}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarX2 className="h-4 w-4 text-danger" /> Class notices
          {today.length > 0 && <Badge variant="danger">{today.length} cancelled today</Badge>}
        </CardTitle>
        <CardDescription>Classes cancelled because the lecturer is officially absent. You are not marked absent for them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.map((n) => (
          <div
            key={n.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm ${n.is_today && n.status === "cancelled" ? "border-danger/50 bg-background font-medium" : ""}`}
          >
            <div className="min-w-0">
              <p>
                {n.course_name} <span className="text-muted-foreground">({n.batch})</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {when(n)} · {n.lecturer_name}
                {n.room ? ` · ${n.room}` : ""} · announced {new Date(n.status === "cancelled" ? n.notified_at : n.reinstated_at).toLocaleString()}
              </p>
            </div>
            {n.status === "cancelled" ? (
              <Badge variant="danger">{n.is_today ? "Cancelled today" : "Cancelled"}</Badge>
            ) : (
              <Badge variant="success">
                <CalendarCheck className="mr-1 h-3 w-3" /> Will take place
              </Badge>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
