import { MonitorSmartphone } from "lucide-react";
import { useApi } from "@/components/committees/shared";
import { Card, CardContent } from "@/components/ui/card";

const fmt = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** Lecturer and student dashboards: current and upcoming online teaching,
 * and when classes return to campus. Hidden when there is none. */
export default function OnlineBanner() {
  const { data } = useApi("/online/mine", []);
  if (!data?.length) return null;
  return (
    <Card className="border-info/50 bg-info/5">
      <CardContent className="space-y-2 p-4 text-sm">
        {data.map((a) => (
          <div key={a.id} className="flex gap-3">
            <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            <div>
              <p className="font-medium">
                {a.status === "active" ? "Online now" : "Moving online"}: {a.classes.join(", ")}
              </p>
              <p className="text-muted-foreground">
                {a.start_date === (a.actual_end_date || a.end_date) ? fmt(a.start_date) : `${fmt(a.start_date)} – ${fmt(a.actual_end_date || a.end_date)}`}
                {" · "}back on campus {fmt(a.return_date)}
                {a.rooms.length > 0 && ` in ${a.rooms.join(", ")}`}
              </p>
              {a.instructions && <p>{a.instructions}</p>}
              {a.meeting_link && (
                <a href={a.meeting_link} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  Online class link
                </a>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
