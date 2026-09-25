import { useEffect, useState } from "react";
import { Download, Eye, Paperclip } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MEETING_STATUS, PRIORITIES, TASK_STATUS, downloadDocument, viewDocument } from "@/lib/committees";

export function TaskStatusBadge({ status }) {
  const s = TASK_STATUS[status] || { label: status, variant: "muted" };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function PriorityBadge({ priority }) {
  const p = PRIORITIES.find((x) => x.value === priority) || { label: priority, variant: "muted" };
  return <Badge variant={p.variant}>{p.label}</Badge>;
}

export function MeetingStatusBadge({ status }) {
  const s = MEETING_STATUS[status] || { label: status, variant: "muted" };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function Field({ label, htmlFor, hint, children, className }) {
  return (
    <div className={className ? `space-y-1.5 ${className}` : "space-y-1.5"}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Controlled <Select> over [{value,label}] with an optional "any" entry. */
export function OptionSelect({ id, value, onChange, options, placeholder = "Choose...", anyLabel, className }) {
  return (
    <Select value={value ? String(value) : anyLabel ? "__any" : undefined} onValueChange={(v) => onChange(v === "__any" ? "" : v)}>
      <SelectTrigger id={id} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {anyLabel && <SelectItem value="__any">{anyLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FileInput({ id, onChange, multiple = false }) {
  return (
    <Input
      id={id}
      type="file"
      multiple={multiple}
      accept=".pdf,.doc,.docx,.xlsx,.pptx,.png,.jpg,.jpeg"
      onChange={(e) => onChange(multiple ? Array.from(e.target.files || []) : e.target.files?.[0] || null)}
      className="cursor-pointer file:mr-3 file:rounded file:border-0 file:bg-primary/10 file:px-2 file:py-1 file:text-primary"
    />
  );
}

/** View / download buttons for a protected document URL. */
export function DocumentActions({ url, fileName, size = "sm", showName = true }) {
  if (!url) return null;
  const run = (fn) => fn().catch((err) => toast.error(apiErrorMessage(err, "Could not open the document")));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showName && (
        <span className="flex min-w-0 items-center gap-1.5 text-sm">
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{fileName}</span>
        </span>
      )}
      <Button type="button" variant="outline" size={size} onClick={() => run(() => viewDocument(url))}>
        <Eye /> View
      </Button>
      <Button type="button" variant="outline" size={size} onClick={() => run(() => downloadDocument(url, fileName))}>
        <Download /> Download
      </Button>
    </div>
  );
}

/** Fetch helper: const { data, loading, error, reload } = useApi("/committees"). */
export function useApi(path, initial = null) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    setLoading(true);
    client
      .get(path)
      .then((res) => !cancelled && (setData(res.data), setError("")))
      .catch((err) => !cancelled && setError(apiErrorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [path, tick]);

  return { data, setData, loading, error, reload: () => setTick((t) => t + 1) };
}

export function InfoRow({ label, children }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words">{children || "—"}</dd>
    </div>
  );
}
