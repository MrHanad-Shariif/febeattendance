import {
  Bell,
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
  LayoutDashboard,
  ScanLine,
  Settings,
  UserCheck,
  Users,
} from "lucide-react";

/**
 * Sidebar menus per role. An item with `children` is a collapsible group;
 * groups can nest to any depth. Leaf items have `to`.
 */
export const NAV_BY_ROLE = {
  admin: [
    { label: "Dashboard", icon: LayoutDashboard, to: "/admin", end: true },
    {
      label: "Lecturers",
      icon: Users,
      children: [
        { label: "Today's attendance", icon: ClipboardCheck, to: "/admin/overview" },
        { label: "Manage lecturers", icon: UserCheck, to: "/admin/lecturers" },
        { label: "Timetable", icon: CalendarClock, to: "/admin/timetable" },
        { label: "Reports", icon: FileBarChart, to: "/admin/reports" },
      ],
    },
    {
      label: "Students",
      icon: GraduationCap,
      children: [
        { label: "Overview", icon: ClipboardCheck, to: "/admin/student-overview" },
        { label: "Manage students", icon: Users, to: "/admin/students" },
        { label: "Reports", icon: FileBarChart, to: "/admin/student-reports" },
      ],
    },
    { label: "Settings", icon: Settings, to: "/admin/settings" },
  ],
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
        { label: "My students", icon: GraduationCap, to: "/my-students" },
        { label: "Show class code", icon: KeyRound, to: "/class-code" },
      ],
    },
  ],
  student: [
    { label: "Today", icon: ScanLine, to: "/", end: true },
    { label: "Timetable", icon: CalendarDays, to: "/student-timetable" },
    { label: "My report", icon: FileBarChart, to: "/student-report" },
  ],
};

/**
 * The menu for one account. The attendance menu comes from NAV_BY_ROLE; the
 * committees module adds groups according to every role the person holds
 * (committee member, chairperson, Administration Team, Dean), so one account
 * sees all its functions at once. This only decides what is shown -- the API
 * checks permission on every request.
 */
export function buildNav(user) {
  const base = NAV_BY_ROLE[user?.role] || NAV_BY_ROLE.lecturer;
  if (!user || user.role === "student") return base;

  const caps = user.capabilities || {};
  const isAdmin = user.role === "admin";
  const chairs = (caps.chaired_committee_ids || []).length > 0;
  const oversees = isAdmin || caps.is_dean;

  const committees = [
    { label: "My committees", icon: UsersRound, to: "/committees", end: true },
    { label: "My tasks", icon: ClipboardList, to: "/tasks", end: true },
    { label: "Meetings", icon: CalendarDays, to: "/meetings" },
  ];
  if (chairs) {
    committees.push({ label: "Task monitoring", icon: ListChecks, to: "/tasks/monitor" });
  }
  if (chairs || oversees) {
    committees.push({ label: "Reports", icon: FileBarChart, to: "/committee-reports" });
  }

  const information = [
    { label: "Information sharing", icon: Megaphone, to: "/information" },
    { label: "Meeting minutes", icon: FileText, to: "/meeting-minutes" },
    { label: "Notifications", icon: Bell, to: "/notifications" },
  ];

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
  if (oversees) {
    groups.push({
      label: "Faculty",
      icon: Gauge,
      children: [
        { label: "Faculty overview", icon: Gauge, to: "/faculty" },
        { label: "Committee monitoring", icon: Network, to: "/committees/all" },
        ...(isAdmin
          ? [
              { label: "Manage committees", icon: Settings, to: "/admin/committees" },
              { label: "Faculty roles", icon: ShieldCheck, to: "/admin/faculty-roles" },
            ]
          : []),
      ],
    });
  }
  groups.push({ label: "Information", icon: Megaphone, children: information });

  // Keep admin Settings last.
  const settingsIndex = base.findIndex((i) => i.to === "/admin/settings");
  if (settingsIndex >= 0) {
    return [...base.slice(0, settingsIndex), ...groups, ...base.slice(settingsIndex)];
  }
  return [...base, ...groups];
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
