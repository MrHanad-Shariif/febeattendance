import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Crown, Network, Users } from "lucide-react";
import { useAuth } from "@/context/AuthContext.jsx";
import { useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const COPY = {
  mine: {
    title: "My committees",
    description: "Committees and teams you belong to. Open one to see your tasks, meetings and minutes.",
    empty: "You are not a member of any committee yet.",
  },
  all: {
    title: "Committee monitoring",
    description: "Every faculty committee and its current activity.",
    empty: "No committees have been created yet.",
  },
  administration: {
    title: "Administration Team",
    description: "The Dean's Administration Team: tasks, meetings and minutes.",
    empty: "No Administration Team has been set up yet. An administrator can create one under Manage committees.",
  },
};

function Stat({ icon: Icon, value, label, tone }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title={label}>
      <Icon className={`h-3.5 w-3.5 ${tone || ""}`} />
      <span className="font-semibold text-foreground">{value}</span> {label}
    </div>
  );
}

export function CommitteeCards({ committees }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {committees.map((c, i) => (
        <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
          <Link to={`/committees/${c.id}`} className="block h-full">
            <Card className="flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Chair: {c.chairperson_name || <em>not assigned</em>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {c.kind === "administration" && <Badge variant="purple">Administration</Badge>}
                  {c.my_role === "chairperson" && (
                    <Badge variant="warning" className="gap-1">
                      <Crown className="h-3 w-3" /> Chairperson
                    </Badge>
                  )}
                  {c.my_role === "member" && <Badge variant="muted">Member</Badge>}
                  {c.status === "archived" && <Badge variant="muted">Archived</Badge>}
                </div>
              </div>
              {c.description && <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
              <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t pt-3">
                <Stat icon={Users} value={c.member_count} label="members" />
                <Stat icon={ClipboardList} value={c.task_pending} label="open tasks" />
                <Stat icon={CheckCircle2} value={c.task_completed} label="done" tone="text-success" />
                {c.task_overdue > 0 && <Stat icon={AlertTriangle} value={c.task_overdue} label="overdue" tone="text-danger" />}
                <Stat icon={CalendarDays} value={c.upcoming_meetings} label="upcoming meetings" />
              </div>
            </Card>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

export default function CommitteeList({ scope = "mine" }) {
  const { user } = useAuth();
  const copy = COPY[scope];
  const canSeeAll = user?.role === "admin" || user?.capabilities?.is_dean;
  const path =
    scope === "administration"
      ? `/committees?kind=administration${canSeeAll ? "&scope=all" : ""}`
      : scope === "all"
      ? "/committees?scope=all"
      : "/committees";
  const { data, loading, error } = useApi(path, []);

  return (
    <div className="space-y-6">
      <PageHeader title={copy.title} description={copy.description} />
      {error && <Alert>{error}</Alert>}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
          <Network className="h-8 w-8 opacity-50" />
          <p className="text-sm">{copy.empty}</p>
        </Card>
      ) : (
        <CommitteeCards committees={data} />
      )}
    </div>
  );
}
