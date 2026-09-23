import {
  BookOpen,
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
