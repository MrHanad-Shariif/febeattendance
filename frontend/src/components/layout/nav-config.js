import {
  Archive,
  Bell,
  NotebookPen,
  BookOpen,
  Building2,
  ClipboardList,
  FileText,
  Gauge,
  ListChecks,
  Megaphone,
  Network,
  ShieldCheck,
  UsersRound,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  FileBarChart,
  GraduationCap,
  History,
  KeyRound,
  KeySquare,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  ScanLine,
  ScrollText,
  Settings,
  UserCheck,
  UserCog,
  Users,
} from "lucide-react";

/**
 * Sidebar menus. An item with `children` is a collapsible group; groups can
 * nest to any depth. Leaf items have `to`. Management items carry `perms`
 * (any-of RBAC permissions) and are dropped for accounts without them.
 */
export const NAV_BY_ROLE = {
  lecturer: [
    {
      label: "Attendance",
      icon: ClipboardCheck,
      children: [
        { label: "Today", icon: ScanLine, to: "/", end: true },
        { label: "History", icon: History, to: "/history" },
      ],
    },
    {
      label: "Classes",
      icon: BookOpen,
      children: [
        { label: "My timetable", icon: CalendarDays, to: "/my-timetable" },
        { label: "Assignments", icon: NotebookPen, to: "/assignments" },
        { label: "My students", icon: GraduationCap, to: "/my-students" },
        { label: "Class check-in (QR & board)", icon: KeyRound, to: "/class-code" },
      ],
    },
  ],
  student: [
    { label: "Today", icon: ScanLine, to: "/", end: true },
    { label: "Timetable", icon: CalendarDays, to: "/student-timetable" },
    { label: "Assignments", icon: NotebookPen, to: "/assignments" },
    { label: "My report", icon: FileBarChart, to: "/student-report" },
  ],
};

// Management screens, shown to any staff account (admin or lecturer) that
// holds the permissions.
const MANAGEMENT = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/admin", end: true, perms: ["dashboard:view"] },
  {
    label: "Lecturers",
    icon: Users,
    children: [
      { label: "Today's attendance", icon: ClipboardCheck, to: "/admin/overview", perms: ["lecturer_attendance:view"] },
      { label: "Manage lecturers", icon: UserCheck, to: "/admin/lecturers", perms: ["lecturers:view"] },
      { label: "Timetable", icon: CalendarClock, to: "/admin/timetable", perms: ["timetable:view"] },
    ],
  },
  {
    label: "Students",
    icon: GraduationCap,
    children: [
      { label: "Overview", icon: ClipboardCheck, to: "/admin/student-overview", perms: ["student_attendance:view"] },
      { label: "Manage students", icon: Users, to: "/admin/students", perms: ["students:view"] },
      { label: "Class check-in (any class)", icon: KeyRound, to: "/class-code", perms: ["class_checkin:view"] },
    ],
  },
];

/** Every report in the app, for the Reports menu and the "All reports" page. */
export function reportLinks(user) {
  const caps = user?.capabilities || {};
  const can = (...codes) => codes.some((c) => (caps.permissions || []).includes(c));
  const committeeReports = (caps.chaired_committee_ids || []).length > 0 || caps.can_view_all_committees;
  return [
    can("reports:view") && {
      label: "Lecturer attendance", icon: Users, to: "/admin/reports",
      description: "Monthly on-time, late, absent and left-early counts per lecturer, with CSV export.",
    },
    can("reports:view") && {
      label: "Student attendance", icon: GraduationCap, to: "/admin/student-reports",
      description: "Class, course and department reports with absence percentages and retake flags.",
    },
    can("reports:view") && {
      label: "Check-in methods", icon: ScanLine, to: "/admin/checkin-methods",
      description: "QR versus board-code check-ins per class session, to spot suspicious board-code attendance.",
    },
    committeeReports && {
      label: "Committee reports", icon: Network, to: "/committee-reports",
      description: "Task completion, overdue work and meetings per committee.",
    },
  ].filter(Boolean);
}

function filterByPerms(items, perms) {
  return items
    .map((item) => {
      if (item.children) {
        const children = filterByPerms(item.children, perms);
        return children.length ? { ...item, children } : null;
      }
      return !item.perms || item.perms.some((p) => perms.includes(p)) ? item : null;
    })
    .filter(Boolean);
}

/**
 * The menu for one account: its own attendance menu, the management screens
 * its RBAC roles allow, the committees groups for every committee role it
 * holds, then Reports, Authentication and Settings. This only decides what is
 * shown -- the API checks permission on every request.
 */
export function buildNav(user) {
  if (user?.role === "student") return NAV_BY_ROLE.student;
  const own = user?.role === "lecturer" ? NAV_BY_ROLE.lecturer : [];
  if (!user) return own;

  const caps = user.capabilities || {};
  const perms = caps.permissions || [];
  const can = (...codes) => codes.some((c) => perms.includes(c));
  const chairs = (caps.chaired_committee_ids || []).length > 0;
  const oversees = caps.can_view_all_committees;

  const committees = [
    { label: "My committees", icon: UsersRound, to: "/committees", end: true },
    { label: "My tasks", icon: ClipboardList, to: "/tasks", end: true },
    { label: "Meetings", icon: CalendarDays, to: "/meetings" },
  ];
  if (chairs) {
    committees.push({ label: "Task monitoring", icon: ListChecks, to: "/tasks/monitor" });
  }
  if (caps.can_view_archive) {
    committees.push({ label: "Committee archive", icon: Archive, to: "/archive" });
  }

  const groups = [{ label: "Committees", icon: Network, children: committees }];
  if (caps.is_admin_team || caps.is_dean) {
    groups.push({
      label: "Administration Team",
      icon: Building2,
      children: [
        { label: "Administration Team", icon: Building2, to: "/administration" },
        ...(caps.is_admin_team ? [{ label: "Publish minutes", icon: FileText, to: "/meeting-minutes/publish" }] : []),
      ],
    });
  }
  const facultyAdmin = [
    can("committees:add", "committees:edit", "committees:delete") && { label: "Manage committees", icon: Settings, to: "/admin/committees" },
    can("faculty_roles:view") && { label: "Faculty roles", icon: ShieldCheck, to: "/admin/faculty-roles" },
  ].filter(Boolean);
  if (oversees || facultyAdmin.length) {
    groups.push({
      label: "Faculty",
      icon: Gauge,
      children: [
        ...(oversees
          ? [
              { label: "Faculty overview", icon: Gauge, to: "/faculty" },
              { label: "Committee monitoring", icon: Network, to: "/committees/all" },
            ]
          : []),
        ...facultyAdmin,
      ],
    });
  }
  groups.push({
    label: "Information",
    icon: Megaphone,
    children: [
      { label: "Information sharing", icon: Megaphone, to: "/information" },
      { label: "Meeting minutes", icon: FileText, to: "/meeting-minutes" },
      { label: "Notifications", icon: Bell, to: "/notifications" },
    ],
  });

  const reports = reportLinks(user);
  if (reports.length) {
    groups.push({
      label: "Reports",
      icon: FileBarChart,
      children: [
        { label: "All reports", icon: LayoutGrid, to: "/reports", end: true },
        ...reports.map(({ label, icon, to }) => ({ label, icon, to })),
      ],
    });
  }

  const tail = filterByPerms(
    [
      {
        label: "Authentication",
        icon: Lock,
        children: [
          { label: "Users", icon: UserCog, to: "/access/users", perms: ["users:view"] },
          { label: "Roles", icon: ShieldCheck, to: "/access/roles", perms: ["roles:view"] },
          { label: "Permissions", icon: KeySquare, to: "/access/permissions", perms: ["roles:view", "users:view"] },
          { label: "System logs", icon: ScrollText, to: "/access/logs", perms: ["system_logs:view"] },
        ],
      },
      { label: "Settings", icon: Settings, to: "/admin/settings", perms: ["settings:view"] },
    ],
    perms
  );

  return [...own, ...filterByPerms(MANAGEMENT, perms), ...groups, ...tail];
}

/** Where a staff account lands after signing in: the admin dashboard if it
 * may see it, otherwise its first menu entry. */
export function homePath(user) {
  if (hasDashboard(user)) return "/admin";
  const first = flattenNav(buildNav(user))[0];
  return first?.to || "/notifications";
}

function hasDashboard(user) {
  return (user?.capabilities?.permissions || []).includes("dashboard:view");
}

/** Flatten a menu into [{ label, to, trail: [group labels...] }] for breadcrumbs. */
export function flattenNav(items, trail = []) {
  return items.flatMap((item) =>
    item.children
      ? flattenNav(item.children, [...trail, item.label])
      : [{ label: item.label, to: item.to, trail }]
  );
}

export function isItemActive(item, pathname) {
  if (item.children) return item.children.some((c) => isItemActive(c, pathname));
  if (item.end) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(item.to + "/");
}
