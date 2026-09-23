import { Badge } from "@/components/ui/badge";

const VARIANTS = {
  not_yet: "muted",
  on_time: "success",
  late: "warning",
  absent: "danger",
  left_early: "orange",
  no_checkout: "purple",
  // account / generic statuses
  active: "success",
  invited: "muted",
  disabled: "danger",
  present: "success",
};

export const STATUS_LABELS = {
  not_yet: "Not yet",
  on_time: "On time",
  late: "Late",
  absent: "Absent",
  left_early: "Left early",
  no_checkout: "No check-out",
};

export default function StatusBadge({ status, label, className }) {
  return (
    <Badge variant={VARIANTS[status] || "muted"} className={className}>
      {label || STATUS_LABELS[status] || status}
    </Badge>
  );
}
