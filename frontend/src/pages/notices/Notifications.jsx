import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import client from "@/api/client";
import { NOTIFICATION_ICONS } from "@/components/committees/NotificationBell.jsx";
import { useApi } from "@/components/committees/shared";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/committees";
import { cn } from "@/lib/utils";

export default function Notifications() {
  const [type, setType] = useState("all");
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi(`/notifications?limit=200${type === "all" ? "" : `&type=${type}`}`, []);

  async function open(n) {
    if (!n.read) await client.post("/notifications/read", { ids: [n.id] }).catch(() => {});
    if (n.link) navigate(n.link);
    else reload();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Notifications"
        description="Only items you are authorised to see are shown."
        actions={
          <Button variant="outline" onClick={() => client.post("/notifications/read", { all: true }).then(reload)}>
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <Tabs value={type} onValueChange={setType}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="task">Tasks</TabsTrigger>
          <TabsTrigger value="meeting">Meetings</TabsTrigger>
          <TabsTrigger value="minutes">Minutes</TabsTrigger>
          <TabsTrigger value="notice">Notices</TabsTrigger>
        </TabsList>
      </Tabs>
      {error && <Alert>{error}</Alert>}
      <Card className="divide-y">
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No notifications.</p>
        ) : (
          data.map((n) => {
            const Icon = NOTIFICATION_ICONS[n.type] || Bell;
            return (
              <button key={n.id} type="button" onClick={() => open(n)} className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/50">
                <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", n.read ? "text-muted-foreground" : "text-primary")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !n.read && "font-semibold")}>{n.title}</p>
                  {n.message && <p className="text-sm text-muted-foreground">{n.message}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
                </div>
                {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-danger" />}
              </button>
            );
          })
        )}
      </Card>
    </div>
  );
}
