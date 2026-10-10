import client from "@/api/client";

/** Report categories (see backend utils/attendance_report.py) and their badge colours. */
export const CATEGORIES = {
  present: { label: "Present", variant: "success" },
  late: { label: "Late", variant: "warning" },
  absent: { label: "Absent (unjustified)", variant: "danger" },
  justified: { label: "Justified absence", variant: "info" },
  left_early: { label: "Left early", variant: "orange" },
  no_checkout: { label: "No check-out", variant: "purple" },
  exempted: { label: "Exempted", variant: "muted" },
  not_yet: { label: "Not yet", variant: "muted" },
};

export const ABSENCE_STATUS = {
  scheduled: { label: "Scheduled", variant: "info" },
  active: { label: "Active", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

export const WEEKDAYS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function currentMonth() {
  return todayIso().slice(0, 7);
}

export function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" });
}

export function pct(v) {
  return v === null || v === undefined ? "—" : `${v}%`;
}

/** GET a file from the API and save it with the name the server gives (or `fallback`). */
export async function downloadFile(url, params, fallback) {
  const res = await client.get(url, { params, responseType: "blob" });
  const disposition = res.headers?.["content-disposition"] || "";
  const match = disposition.match(/filename=([^;]+)/);
  const name = match ? match[1].replace(/"/g, "") : fallback;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
  URL.revokeObjectURL(href);
}
