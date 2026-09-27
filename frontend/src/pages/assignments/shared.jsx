import { useEffect, useState } from "react";
import { Download, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { apiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { downloadDocument } from "@/lib/committees";

export function formatBytes(n) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "2 days 3 h left" style countdown that ticks every 30 s. */
export function useCountdown(iso) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return { open: false, text: "" };
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { open: false, text: "Closed" };
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const text = days > 0 ? `${days}d ${hours}h left` : hours > 0 ? `${hours}h ${m}m left` : `${m}m left`;
  return { open: true, text, urgent: ms < 24 * 3600 * 1000 };
}

export function DeadlineBadge({ iso }) {
  const { open, text, urgent } = useCountdown(iso);
  if (!open) return <Badge variant="muted">Closed</Badge>;
  return <Badge variant={urgent ? "warning" : "success"}>{text}</Badge>;
}

/** A downloadable file row (files are always downloaded, never opened inline). */
export function FileRow({ file, action }) {
  const download = () => downloadDocument(file.url, file.file_name).catch((err) => toast.error(apiErrorMessage(err, "Could not download the file")));
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm">{file.file_name}</span>
      {file.size_bytes != null && <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(file.size_bytes)}</span>}
      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Download ${file.file_name}`} onClick={download}>
        <Download />
      </Button>
      {action}
    </div>
  );
}

/** "2026-10-10T23:59" in local time, `days` after `from` (default now), for new deadlines. */
export function defaultDeadline(days = 7, from = null) {
  const base = from ? new Date(from).getTime() : Date.now();
  const d = new Date(Math.max(base, Date.now()) + days * 86400000);
  d.setHours(23, 59, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
