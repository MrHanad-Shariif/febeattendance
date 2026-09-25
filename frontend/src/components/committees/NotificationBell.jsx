import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, CalendarDays, CheckCheck, ClipboardList, FileText, Megaphone } from "lucide-react";
import client from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateTime } from "@/lib/committees";
import { cn } from "@/lib/utils";

export const NOTIFICATION_ICONS = { task: ClipboardList, meeting: CalendarDays, minutes: FileText, notice: Megaphone };

/** Top-bar bell: unread count, latest notifications, mark all read. */
export function NotificationBell() {
  const [summary, setSummary] = useState({ total: 0 });
  const [items, setItems] = useState([]);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const refresh = useCallback(() => {
    client.get("/notifications/summary").then((r) => setSummary(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh, pathname]);

  function loadItems(open) {
    if (!open) return;
    client.get("/notifications?limit=8").then((r) => setItems(r.data)).catch(() => {});
  }

  async function openItem(n) {
    if (!n.read) await client.post("/notifications/read", { ids: [n.id] }).catch(() => {});
    refresh();
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    await client.post("/notifications/read", { all: true }).catch(() => {});
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    refresh();
  }

  return (
    <DropdownMenu onOpenChange={loadItems}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${summary.total} unread)`}>
          <Bell />
          {summary.total > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {summary.total > 99 ? "99+" : summary.total}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notifications</span>
          {summary.total > 0 && (
            <button type="button" onClick={markAll} className="flex items-center gap-1 text-xs font-normal text-primary hover:underline">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">You're all caught up.</p>
        ) : (
          items.map((n) => {
            const Icon = NOTIFICATION_ICONS[n.type] || Bell;
            return (
              <DropdownMenuItem key={n.id} onSelect={() => openItem(n)} className="items-start gap-2 py-2">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", n.read ? "text-muted-foreground" : "text-primary")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("line-clamp-2 text-sm", !n.read && "font-semibold")}>{n.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
                </div>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-danger" />}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/notifications")} className="justify-center text-primary">
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Dashboard strip: "2 New Tasks · 1 Upcoming Meeting · 1 New Meeting Minute · 3 New Faculty Notices". */
export function NotificationSummaryCards() {
  const [summary, setSummary] = useState(null);
  const [upcoming, setUpcoming] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    client.get("/notifications/summary").then((r) => setSummary(r.data)).catch(() => {});
    client.get("/committees/summary").then((r) => setUpcoming(r.data.upcoming_meetings)).catch(() => {});
  }, []);

  if (!summary) return null;
  const cards = [
    { key: "task", label: "New Tasks", count: summary.task, to: "/tasks", icon: ClipboardList },
    { key: "meeting", label: "Upcoming Meetings", count: upcoming, to: "/meetings", icon: CalendarDays },
    { key: "minutes", label: "New Meeting Minutes", count: summary.minutes, to: "/meeting-minutes", icon: FileText },
    { key: "notice", label: "New Faculty Notices", count: summary.notice, to: "/information", icon: Megaphone },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ key, label, count, to, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => navigate(to)}
          className="flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-shadow hover:shadow-md"
        >
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
            {count > 0 && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-card bg-danger" />}
          </span>
          <span className="min-w-0">
            <span className="block text-2xl font-bold leading-none">{count || 0}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{label}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Adds the committees/notices strip under an existing dashboard without changing it. */
export function WithCommitteeSummary({ children }) {
  return (
    <div className="space-y-8">
      {children}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Committees &amp; faculty notices</h2>
        <NotificationSummaryCards />
      </section>
    </div>
  );
}
