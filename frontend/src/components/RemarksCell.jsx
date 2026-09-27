import { useState } from "react";
import { Pencil } from "lucide-react";
import client, { apiErrorMessage } from "../api/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/AuthContext.jsx";

export default function RemarksCell({ record, onSaved }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(record.remarks || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!record.id) {
    return (
      <span className="text-xs text-muted-foreground" title="Not finalized yet">
        —
      </span>
    );
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const res = await client.put(`/admin/attendance/${record.id}/remarks`, { remarks: value });
      onSaved(res.data);
      setEditing(false);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="min-w-[220px] space-y-2">
        <Textarea
          autoFocus
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Approved sick leave"
          className="min-h-0 text-xs"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setValue(record.remarks || "");
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const justified = record.remarks && record.remarks.trim();
  if (!can("lecturer_attendance:edit")) {
    return justified ? <span className="text-xs">{record.remarks}</span> : <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <button onClick={() => setEditing(true)} className="group inline-flex items-center gap-1.5 text-left text-xs">
      {justified ? (
        <span>{record.remarks}</span>
      ) : (
        <span className="italic text-muted-foreground group-hover:text-foreground">Add remark…</span>
      )}
      <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}
