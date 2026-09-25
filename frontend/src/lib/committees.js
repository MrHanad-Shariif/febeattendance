import client from "@/api/client";

export const FACULTY_NAME = "Faculty of Engineering and Built Environment (FEBE)";

export const TASK_STATUS = {
  pending: { label: "Pending", variant: "muted" },
  in_progress: { label: "In progress", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  overdue: { label: "Overdue", variant: "danger" },
};

export const PRIORITIES = [
  { value: "low", label: "Low", variant: "muted" },
  { value: "normal", label: "Normal", variant: "default" },
  { value: "high", label: "High", variant: "warning" },
  { value: "urgent", label: "Urgent", variant: "danger" },
];

export const MEETING_STATUS = {
  scheduled: { label: "Scheduled", variant: "info" },
  held: { label: "Held", variant: "success" },
  cancelled: { label: "Cancelled", variant: "muted" },
};

export const KIND_OPTIONS = [
  { value: "committee", label: "Committee" },
  { value: "administration", label: "Administration Team" },
];

export const NOTICE_CATEGORIES = [
  { value: "announcement", label: "Announcement" },
  { value: "circular", label: "Circular" },
  { value: "policy", label: "Policy" },
  { value: "event", label: "Event" },
  { value: "meeting_minutes", label: "Meeting minutes" },
  { value: "other", label: "Other" },
];

export const AUDIENCES = [
  { value: "all_staff", label: "All faculty staff" },
  { value: "lecturers", label: "Lecturers only" },
  { value: "committee", label: "One committee" },
];

export function labelOf(options, value) {
  return options.find((o) => o.value === value)?.label || value;
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2026-10-10T17:00" for <input type="datetime-local">. */
export function toLocalInput(iso) {
  return iso ? iso.slice(0, 16) : "";
}

/** Build a multipart body, skipping empty values. */
export function toFormData(fields) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
    else fd.append(k, v);
  });
  return fd;
}

async function fetchBlob(url, inline) {
  const path = url.replace(/^\/api/, "") + (inline ? (url.includes("?") ? "&" : "?") + "inline=1" : "");
  const res = await client.get(path, { responseType: "blob" });
  return res.data;
}

/** Protected documents need the auth header, so fetch them and open a blob URL. */
export async function viewDocument(url) {
  const win = window.open("", "_blank"); // open now, so popup blockers allow it
  try {
    const blob = await fetchBlob(url, true);
    const objectUrl = URL.createObjectURL(blob);
    if (win) win.location.href = objectUrl;
    else window.location.href = objectUrl;
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (err) {
    win?.close();
    throw err;
  }
}

export async function downloadDocument(url, fileName) {
  const blob = await fetchBlob(url, false);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName || "document";
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

export async function downloadFromApi(path, fileName) {
  const res = await client.get(path, { responseType: "blob" });
  const objectUrl = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
}

/** Capabilities from /auth/me (display only; the API enforces every rule). */
export function capsOf(user) {
  return user?.capabilities || {};
}

export function isChairAnywhere(user) {
  return (capsOf(user).chaired_committee_ids || []).length > 0;
}
