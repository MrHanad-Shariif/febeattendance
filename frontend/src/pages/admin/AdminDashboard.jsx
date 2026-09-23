import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
} from "recharts";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, GraduationCap, Percent, UserX, Users } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import { Alert, PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import StatusBadge, { STATUS_LABELS } from "@/components/StatusBadge.jsx";
import { AXIS_PROPS, ChartEmpty, ChartTooltip, GRID_PROPS, STATUS_COLORS } from "@/components/chart-parts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime } from "@/lib/utils";

const SHORT_LABELS = { on_time: "On time", late: "Late", left_early: "Early", no_checkout: "No out", absent: "Absent" };
const PRESENT = ["on_time", "late", "left_early", "no_checkout"];
// Campus week runs Saturday to Thursday (Friday is the weekend). Values are JS getDay() numbers.
const WEEKDAYS = [
  { label: "Sat", day: 6 },
  { label: "Sun", day: 0 },
  { label: "Mon", day: 1 },
  { label: "Tue", day: 2 },
  { label: "Wed", day: 3 },
  { label: "Thu", day: 4 },
];

const isoDate = (d) => {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const shortDay = (iso) => new Date(iso + "T00:00:00").toLocaleDateString([], { month: "short", day: "numeric" });

function rate(records) {
  const present = records.filter((r) => PRESENT.includes(r.status)).length;
  const absent = records.filter((r) => r.status === "absent").length;
  return present + absent === 0 ? null : Math.round((present / (present + absent)) * 100);
}

function ChartCard({ title, description, action, children, className }) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="space-y-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent>
        <div className="h-[280px]">{children}</div>
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const [lecturers, setLecturers] = useState([]);
  const [studentCount, setStudentCount] = useState(0);
  const [today, setToday] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState("14");

  useEffect(() => {
    Promise.all([
      client.get("/admin/lecturers"),
      client.get("/admin/students"),
      client.get("/admin/attendance/today"),
      client.get("/admin/attendance", { params: { from: isoDate(daysAgo(60)), to: isoDate(new Date()) } }),
    ])
      .then(([l, s, t, h]) => {
        setLecturers(l.data);
        setStudentCount(s.data.length);
        setToday(t.data);
        setHistory(h.data);
      })
      .catch((err) => setError(apiErrorMessage(err, "Could not load dashboard data")))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const count = (s) => today.filter((r) => r.status === s).length;
    const cutoff = isoDate(daysAgo(30));
    const last30 = history.filter((r) => r.date >= cutoff);
    const prev30 = history.filter((r) => r.date < cutoff);
    const current = rate(last30);
    const previous = rate(prev30);
    return {
      activeLecturers: lecturers.filter((l) => l.status === "active").length,
      present: today.filter((r) => PRESENT.includes(r.status)).length,
      late: count("late"),
      absent: count("absent"),
      pending: count("not_yet"),
      rate: current,
      rateTrend: current !== null && previous !== null ? current - previous : null,
    };
  }, [lecturers, today, history]);

  const days = Number(range);
  const rangeRecords = useMemo(() => {
    const cutoff = isoDate(daysAgo(days - 1));
    return history.filter((r) => r.date >= cutoff);
  }, [history, days]);

  // Line chart: one point per calendar day in the range.
  const trendData = useMemo(() => {
    const byDay = {};
    for (let i = days - 1; i >= 0; i--) byDay[isoDate(daysAgo(i))] = { date: isoDate(daysAgo(i)), present: 0, late: 0, absent: 0 };
    rangeRecords.forEach((r) => {
      const d = byDay[r.date];
      if (!d) return;
      if (PRESENT.includes(r.status)) d.present += 1;
      if (r.status === "late") d.late += 1;
      if (r.status === "absent") d.absent += 1;
    });
    return Object.values(byDay);
  }, [rangeRecords, days]);

  // Bar chart: how many records landed in each status.
  const statusData = useMemo(
    () =>
      ["on_time", "late", "left_early", "no_checkout", "absent"].map((s) => ({
        key: s,
        name: STATUS_LABELS[s],
        short: SHORT_LABELS[s],
        count: rangeRecords.filter((r) => r.status === s).length,
      })),
    [rangeRecords]
  );

  // Stacked bar chart: weekday pattern.
  const weekdayData = useMemo(() => {
    const rows = WEEKDAYS.map((d) => ({ day: d.label, dow: d.day, on_time: 0, late: 0, absent: 0 }));
    rangeRecords.forEach((r) => {
      const row = rows.find((x) => x.dow === new Date(r.date + "T00:00:00").getDay());
      if (!row) return;
      if (r.status === "on_time") row.on_time += 1;
      else if (r.status === "late") row.late += 1;
      else if (r.status === "absent") row.absent += 1;
    });
    return rows;
  }, [rangeRecords]);

  // Lecturers with the most late/absent records in the range.
  const attention = useMemo(() => {
    const map = {};
    rangeRecords.forEach((r) => {
      if (r.status !== "late" && r.status !== "absent") return;
      const e = (map[r.lecturer_id] ||= { id: r.lecturer_id, name: r.lecturer_name, late: 0, absent: 0 });
      e[r.status] += 1;
    });
    return Object.values(map)
      .sort((a, b) => b.absent * 2 + b.late - (a.absent * 2 + a.late))
      .slice(0, 5);
  }, [rangeRecords]);

  const hasRangeData = rangeRecords.length > 0;
  const todayLive = today.filter((r) => r.status !== "not_yet").slice(0, 6);

  const rangeTabs = (
    <Tabs value={range} onValueChange={setRange}>
      <TabsList className="h-8">
        {["7", "14", "30"].map((d) => (
          <TabsTrigger key={d} value={d} className="px-2.5 text-xs">
            {d}d
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/overview">
              Today's attendance <ArrowRight />
            </Link>
          </Button>
        }
      />

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard index={0} loading={loading} title="Active lecturers" value={stats.activeLecturers} icon={Users} tone="primary" hint={`${lecturers.length} total accounts`} />
        <StatCard index={1} loading={loading} title="Students" value={studentCount} icon={GraduationCap} tone="info" hint="registered" />
        <StatCard index={2} loading={loading} title="Present today" value={stats.present} icon={CheckCircle2} tone="success" hint={`${stats.pending} not yet checked in`} />
        <StatCard index={3} loading={loading} title="Late today" value={stats.late} icon={Clock} tone="warning" hint="checked in after the grace period" />
        <StatCard index={4} loading={loading} title="Absent today" value={stats.absent} icon={UserX} tone="danger" hint="no check-in recorded" />
        <StatCard
          index={5}
          loading={loading}
          title="30-day attendance"
          value={stats.rate === null ? "—" : `${stats.rate}%`}
          icon={Percent}
          tone="purple"
          trend={stats.rateTrend}
          hint="vs previous 30 days"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Attendance trend"
          description={`Daily check-ins, late arrivals and absences over the last ${days} days`}
          action={rangeTabs}
        >
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : !hasRangeData ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="date" tickFormatter={shortDay} {...AXIS_PROPS} minTickGap={24} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <RTooltip content={<ChartTooltip labelFormatter={shortDay} />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="present" name="Present" stroke={STATUS_COLORS.on_time} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="late" name="Late" stroke={STATUS_COLORS.late} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="monotone" dataKey="absent" name="Absent" stroke={STATUS_COLORS.absent} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Status breakdown" description={`Records by status, last ${days} days`}>
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : !hasRangeData ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="short" {...AXIS_PROPS} interval={0} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <RTooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                  content={<ChartTooltip labelFormatter={(l) => statusData.find((d) => d.short === l)?.name || l} />}
                />
                <Bar dataKey="count" name="Records" radius={[6, 6, 0, 0]} maxBarSize={40}>
                  {statusData.map((d) => (
                    <Cell key={d.key} fill={STATUS_COLORS[d.key]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Weekday pattern" description={`On-time, late and absent by weekday, last ${days} days`}>
          {loading ? (
            <Skeleton className="h-full w-full" />
          ) : !hasRangeData ? (
            <ChartEmpty />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdayData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="day" {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <RTooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} content={<ChartTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="on_time" name="On time" stackId="a" fill={STATUS_COLORS.on_time} maxBarSize={32} />
                <Bar dataKey="late" name="Late" stackId="a" fill={STATUS_COLORS.late} maxBarSize={32} />
                <Bar dataKey="absent" name="Absent" stackId="a" fill={STATUS_COLORS.absent} radius={[6, 6, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-warning" /> Needs attention
            </CardTitle>
            <CardDescription>Most late / absent records, last {days} days</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : attention.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No late or absent records. 🎉</p>
            ) : (
              <ul className="divide-y">
                {attention.map((a, i) => (
                  <motion.li
                    key={a.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center justify-between gap-2 py-2.5"
                  >
                    <span className="truncate text-sm font-medium">{a.name}</span>
                    <span className="flex shrink-0 gap-1.5">
                      {a.absent > 0 && <StatusBadge status="absent" label={`${a.absent} absent`} />}
                      {a.late > 0 && <StatusBadge status="late" label={`${a.late} late`} />}
                    </span>
                  </motion.li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Live check-ins today</CardTitle>
            <CardDescription>Latest lecturers to check in</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : todayLive.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nobody has checked in yet today.</p>
            ) : (
              <ul className="divide-y">
                {todayLive.map((r) => (
                  <li key={r.lecturer_id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{r.lecturer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.checkin_at ? `In ${formatTime(r.checkin_at)}` : "No check-in"}
                        {r.checkout_at ? ` · Out ${formatTime(r.checkout_at)}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={r.status} label={r.status_label} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
