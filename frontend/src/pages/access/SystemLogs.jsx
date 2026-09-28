import { useEffect, useMemo, useState } from "react";
import { Activity, LogIn, MapPin, Monitor, RefreshCw, ShieldAlert, Smartphone, Tablet, Users } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { DataTable, DataTableColumnHeader, exactFilter } from "@/components/data-table";
import { Alert, PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-28T13:04:56" (campus time, as stored) -> "28 Sep 2026, 13:04:56". */
function fmt(iso, { date = true } = {}) {
  if (!iso) return "—";
  const [d, t = ""] = iso.split("T");
  const [y, m, day] = d.split("-");
  const time = t.slice(0, 8);
  return date ? `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}, ${time}` : time;
}

function isoDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EVENT_BADGES = {
  login: { label: "Signed in", variant: "success" },
  login_failed: { label: "Failed sign-in", variant: "danger" },
  logout: { label: "Signed out", variant: "muted" },
  action: { label: "Action", variant: "info" },
};
const EVENT_OPTIONS = Object.entries(EVENT_BADGES).map(([value, { label }]) => ({ value, label }));
const ROLE_LABELS = { admin: "Staff", lecturer: "Lecturer", student: "Student" };

function DeviceIcon({ device }) {
  const Icon = device?.includes("Phone") ? Smartphone : device?.includes("Tablet") ? Tablet : Monitor;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

function UserCell({ row }) {
  if (row.user_name) {
    return (
      <div className="min-w-0">
        <p className="truncate font-medium">{row.user_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {row.user_email}
          {row.user_role && ` · ${ROLE_LABELS[row.user_role] || row.user_role}`}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <p className="truncate font-medium text-muted-foreground">{row.user_email || "Unknown user"}</p>
      <p className="truncate text-xs text-muted-foreground">
        {row.source === "imported" ? "From web-server log" : row.user_email ? "No such account" : ""}
      </p>
    </div>
  );
}

function WhereCell({ row }) {
  return (
    <div className="min-w-0 space-y-0.5 text-sm">
      <p className="font-mono text-xs">{row.ip_address || "—"}</p>
      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        {row.location || "Unknown location"}
      </p>
    </div>
  );
}

function DeviceCell({ row }) {
  return (
    <div className="flex max-w-[16rem] items-center gap-2" title={row.user_agent || ""}>
      <DeviceIcon device={row.device} />
      <span className="truncate text-sm">{row.device || "—"}</span>
    </div>
  );
}

const userText = (r) => [r.user_name, r.user_email].filter(Boolean).join(" ") || "Unknown user";

/** Right-hand panel: everything one sign-in did, oldest first. */
function SessionTrail({ session, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session?.session_id) return;
    setRows(null);
    setError("");
    client
      .get("/access/logs", { params: { session_id: session.session_id } })
      .then((res) => setRows([...res.data.rows].reverse()))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [session?.session_id]);

  return (
    <Sheet open={!!session} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full max-w-lg flex-col gap-4 overflow-y-auto p-6">
        {session && (
          <>
            <div className="pr-6">
              <SheetTitle>{session.user_name || session.user_email || "Unknown user"}</SheetTitle>
              <SheetDescription>Signed in {fmt(session.created_at)}</SheetDescription>
            </div>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 rounded-lg border p-4 text-sm">
              <dt className="text-muted-foreground">IP address</dt>
              <dd className="font-mono text-xs leading-5">{session.ip_address || "—"}</dd>
              <dt className="text-muted-foreground">Location</dt>
              <dd>{session.location || "Unknown"}</dd>
              <dt className="text-muted-foreground">Device</dt>
              <dd>{session.device || "—"}</dd>
              <dt className="text-muted-foreground">Last active</dt>
              <dd>{fmt(session.last_seen_at)}</dd>
              <dt className="text-muted-foreground">Signed out</dt>
              <dd>{session.logged_out_at ? fmt(session.logged_out_at) : "Not signed out (or session expired)"}</dd>
            </dl>
            {session.source === "imported" && (
              <p className="text-xs text-muted-foreground">
                Rebuilt from the web-server log from before system logs existed. Those logs don't record who signed in, so actions are
                matched to this sign-in by IP address and browser.
              </p>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Activity</h3>
              {error && <Alert>{error}</Alert>}
              {!rows && !error && <Skeleton className="h-24 w-full" />}
              {rows && (
                <ol className="relative space-y-3 border-l pl-4">
                  {rows.map((r) => {
                    const failed = r.status_code >= 400;
                    return (
                      <li key={r.id} className="text-sm">
                        <span
                          className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${
                            failed ? "bg-danger" : r.event === "action" ? "bg-info" : "bg-muted-foreground"
                          }`}
                        />
                        <p className="font-medium">
                          {r.action}
                          {failed && <Badge variant="danger" className="ml-2">Failed ({r.status_code})</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmt(r.created_at, { date: false })}
                          {r.area && ` · ${r.area}`}
                          {r.detail && ` · ${r.detail}`}
                        </p>
                      </li>
                    );
                  })}
                  {rows.length <= 1 && <li className="text-sm text-muted-foreground">No actions recorded for this sign-in.</li>}
                </ol>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Authentication > System logs: every sign-in with its IP address, location
 * and device, failed sign-in attempts, and what each user did while signed in.
 */
export default function SystemLogs() {
  const [range, setRange] = useState({ from: isoDay(-6), to: isoDay(0) });
  const [sessions, setSessions] = useState([]);
  const [events, setEvents] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openSession, setOpenSession] = useState(null);

  function load() {
    setLoading(true);
    const params = { from: range.from, to: range.to };
    Promise.all([client.get("/access/logs/sessions", { params }), client.get("/access/logs", { params })])
      .then(([s, e]) => {
        setSessions(s.data.rows);
        setEvents(e.data.rows);
        setTruncated(s.data.truncated || e.data.truncated);
        setError("");
      })
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [range.from, range.to]);

  const stats = useMemo(() => {
    const logins = sessions.filter((s) => s.event === "login");
    return {
      logins: logins.length,
      failed: sessions.filter((s) => s.event === "login_failed").length,
      users: new Set(logins.map((s) => s.user_id).filter(Boolean)).size,
      actions: events.filter((e) => e.event === "action").length,
    };
  }, [sessions, events]);

  const sessionColumns = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        meta: { label: "Date" },
        cell: ({ row }) => <span className="whitespace-nowrap text-sm">{fmt(row.original.created_at)}</span>,
      },
      {
        id: "user",
        accessorFn: userText,
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        meta: { label: "User" },
        cell: ({ row }) => <UserCell row={row.original} />,
      },
      {
        accessorKey: "event",
        header: "Result",
        meta: { label: "Result", exportValue: (r) => (r.event === "login" ? "Signed in" : `Failed: ${r.detail}`) },
        filterFn: exactFilter,
        cell: ({ row }) =>
          row.original.event === "login" ? (
            <Badge variant="success">Signed in</Badge>
          ) : (
            <div className="space-y-1">
              <Badge variant="danger">Failed</Badge>
              <p className="text-xs text-muted-foreground">{row.original.detail}</p>
            </div>
          ),
      },
      {
        accessorKey: "ip_address",
        header: "IP address · Location",
        meta: { label: "IP address", exportValue: (r) => `${r.ip_address || ""} (${r.location || "unknown"})` },
        cell: ({ row }) => <WhereCell row={row.original} />,
      },
      {
        accessorKey: "device",
        header: "Device",
        meta: { label: "Device" },
        cell: ({ row }) => <DeviceCell row={row.original} />,
      },
      {
        accessorKey: "action_count",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Actions" />,
        meta: { label: "Actions" },
        cell: ({ row }) =>
          row.original.event === "login" ? (
            <span className="text-sm font-medium tabular-nums">{row.original.action_count}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "logged_out_at",
        header: "Signed out",
        meta: { label: "Signed out" },
        cell: ({ row }) =>
          row.original.event !== "login" ? (
            <span className="text-muted-foreground">—</span>
          ) : row.original.logged_out_at ? (
            <span className="whitespace-nowrap text-sm">{fmt(row.original.logged_out_at, { date: false })}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    []
  );

  const eventColumns = useMemo(
    () => [
      {
        accessorKey: "created_at",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Date" />,
        meta: { label: "Date" },
        cell: ({ row }) => <span className="whitespace-nowrap text-sm">{fmt(row.original.created_at)}</span>,
      },
      {
        id: "user",
        accessorFn: userText,
        header: ({ column }) => <DataTableColumnHeader column={column} title="User" />,
        meta: { label: "User" },
        cell: ({ row }) => <UserCell row={row.original} />,
      },
      {
        accessorKey: "event",
        header: "Type",
        meta: { label: "Type", exportValue: (r) => EVENT_BADGES[r.event]?.label || r.event },
        filterFn: exactFilter,
        cell: ({ row }) => {
          const b = EVENT_BADGES[row.original.event] || { label: row.original.event, variant: "muted" };
          return <Badge variant={b.variant}>{b.label}</Badge>;
        },
      },
      {
        accessorKey: "action",
        header: "Action",
        meta: { label: "Action", exportValue: (r) => [r.action, r.detail].filter(Boolean).join(" — ") },
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="min-w-0 max-w-[20rem]">
              <p className="text-sm">
                {r.action}
                {r.status_code >= 400 && r.event === "action" && (
                  <Badge variant="danger" className="ml-2">Failed ({r.status_code})</Badge>
                )}
              </p>
              {(r.area || r.detail) && (
                <p className="truncate text-xs text-muted-foreground">{[r.area, r.detail].filter(Boolean).join(" · ")}</p>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "area",
        header: "Area",
        meta: { label: "Area" },
        filterFn: exactFilter,
      },
      {
        accessorKey: "ip_address",
        header: "IP address · Location",
        meta: { label: "IP address", exportValue: (r) => `${r.ip_address || ""} (${r.location || "unknown"})` },
        cell: ({ row }) => <WhereCell row={row.original} />,
      },
      {
        accessorKey: "device",
        header: "Device",
        meta: { label: "Device" },
        cell: ({ row }) => <DeviceCell row={row.original} />,
      },
    ],
    []
  );

  const areaOptions = useMemo(
    () => [...new Set(events.map((e) => e.area).filter(Boolean))].sort().map((a) => ({ value: a, label: a })),
    [events]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="System logs"
        description="Who signed in, from which IP address, location and device, and what they did while signed in."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="log-from" className="text-xs">From</Label>
              <Input
                id="log-from"
                type="date"
                className="h-9 w-40"
                value={range.from}
                max={range.to}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="log-to" className="text-xs">To</Label>
              <Input
                id="log-to"
                type="date"
                className="h-9 w-40"
                value={range.to}
                min={range.from}
                onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </div>
            <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {error && <Alert>{error}</Alert>}
      {truncated && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Showing the newest 5,000 entries only. Choose a shorter date range to see the rest.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Sign-ins" value={stats.logins} icon={LogIn} tone="success" loading={loading} index={0} />
        <StatCard title="Different users" value={stats.users} icon={Users} tone="primary" loading={loading} index={1} />
        <StatCard title="Failed sign-ins" value={stats.failed} icon={ShieldAlert} tone="danger" loading={loading} index={2} />
        <StatCard title="Actions" value={stats.actions} icon={Activity} tone="info" loading={loading} index={3} />
      </div>

      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Sign-ins</TabsTrigger>
          <TabsTrigger value="activity">All activity</TabsTrigger>
        </TabsList>

        <TabsContent value="sessions" className="mt-4">
          <DataTable
            columns={sessionColumns}
            data={sessions}
            loading={loading}
            searchPlaceholder="Search user, IP, location, device…"
            filters={[{ columnId: "event", label: "Result", options: EVENT_OPTIONS.slice(0, 2) }]}
            exportName="sign-ins"
            pageSize={20}
            getRowId={(r) => String(r.id)}
            onRowClick={(r) => r.event === "login" && r.session_id && setOpenSession(r)}
            emptyText="No sign-ins in this period."
          />
          <p className="mt-2 text-xs text-muted-foreground">Click a sign-in to see everything done during it.</p>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <DataTable
            columns={eventColumns}
            data={events}
            loading={loading}
            searchPlaceholder="Search user, action, IP, location…"
            filters={[
              { columnId: "event", label: "Type", options: EVENT_OPTIONS },
              { columnId: "area", label: "Area", options: areaOptions },
            ]}
            exportName="system-activity"
            pageSize={20}
            getRowId={(r) => String(r.id)}
            initialVisibility={{ area: false }}
            emptyText="No activity in this period."
          />
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">
        Locations are estimated from the IP address and are often only accurate to the country or city of the internet provider.{" "}
        <a href="https://db-ip.com" target="_blank" rel="noreferrer" className="underline">IP Geolocation by DB-IP</a>
      </p>

      <SessionTrail session={openSession} onClose={() => setOpenSession(null)} />
    </div>
  );
}
