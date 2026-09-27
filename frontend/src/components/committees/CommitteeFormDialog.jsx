import { useEffect, useMemo, useState } from "react";
import { Network, Search } from "lucide-react";
import { toast } from "sonner";
import client, { apiErrorMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KIND_OPTIONS } from "@/lib/committees";
import { Field, OptionSelect } from "./shared";

/** Existing lecturer/staff accounts, loaded once for the admin pickers. */
export function useStaff(enabled = true) {
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    client.get("/staff").then((r) => setStaff(r.data)).catch(() => setStaff([]));
  }, [enabled]);
  return staff;
}

export function staffOptions(staff) {
  return staff.map((u) => ({ value: u.id, label: `${u.name}${u.role === "admin" ? " (admin)" : ""}` }));
}

/** Admin: create a committee (with chair + members) or edit its details. */
export function CommitteeFormDialog({ open, onOpenChange, committee, onSaved }) {
  const editing = !!committee;
  const staff = useStaff(open);
  const [form, setForm] = useState({});
  const [memberIds, setMemberIds] = useState(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setMemberIds(new Set());
    setForm({
      name: committee?.name || "",
      description: committee?.description || "",
      scope_of_work: committee?.scope_of_work || "",
      kind: committee?.kind || "committee",
      chairperson_id: committee?.chairperson_id ? String(committee.chairperson_id) : "",
      secretary_id: committee?.secretary_id ? String(committee.secretary_id) : "",
      status: committee?.status || "active",
    });
  }, [open, committee]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? staff.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q)) : staff;
  }, [staff, query]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  function toggle(id) {
    setMemberIds((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: form.name,
      description: form.description,
      scope_of_work: form.scope_of_work,
      kind: form.kind,
      chairperson_id: form.chairperson_id ? Number(form.chairperson_id) : null,
      secretary_id: form.secretary_id ? Number(form.secretary_id) : null,
    };
    try {
      let res;
      if (editing) {
        res = await client.put(`/committees/${committee.id}`, { ...body, status: form.status });
      } else {
        res = await client.post("/committees", { ...body, member_ids: [...memberIds] });
      }
      toast.success(editing ? "Committee updated" : "Committee created");
      onOpenChange(false);
      onSaved?.(res.data);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" /> {editing ? "Edit committee" : "New committee"}
            </DialogTitle>
            <DialogDescription>
              Members are chosen from existing staff accounts. No new accounts are created.
            </DialogDescription>
          </DialogHeader>
          <Field label="Name" htmlFor="c-name">
            <Input id="c-name" required maxLength={200} value={form.name || ""} onChange={(e) => set("name")(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="c-desc">
            <Textarea id="c-desc" rows={2} value={form.description || ""} onChange={(e) => set("description")(e.target.value)} />
          </Field>
          <Field
            label="Scope of work (SOW)"
            htmlFor="c-sow"
            hint="What this committee is responsible for: its mandate, main duties and expected deliverables. One item per line reads best."
          >
            <Textarea
              id="c-sow"
              rows={5}
              maxLength={20000}
              value={form.scope_of_work || ""}
              onChange={(e) => set("scope_of_work")(e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="c-kind" hint="Administration Team = the Dean's administrative unit.">
              <OptionSelect id="c-kind" value={form.kind} onChange={set("kind")} options={KIND_OPTIONS} />
            </Field>
            <Field label="Chairperson" htmlFor="c-chair" hint="The chairperson and secretary run the committee's tasks and meetings.">
              <OptionSelect
                id="c-chair"
                value={form.chairperson_id}
                onChange={set("chairperson_id")}
                options={staffOptions(staff)}
                placeholder="Choose a chairperson"
                anyLabel="No chairperson yet"
              />
            </Field>
            <Field label="Secretary" htmlFor="c-secretary" hint="Has the same permissions as the chairperson.">
              <OptionSelect
                id="c-secretary"
                value={form.secretary_id}
                onChange={set("secretary_id")}
                options={staffOptions(staff.filter((u) => String(u.id) !== String(form.chairperson_id)))}
                placeholder="Choose a secretary"
                anyLabel="No secretary yet"
              />
            </Field>
          </div>
          {editing && (
            <Field label="Status" htmlFor="c-status" hint="Archived committees stay on record but take no new tasks or meetings.">
              <OptionSelect
                id="c-status"
                value={form.status}
                onChange={set("status")}
                options={[
                  { value: "active", label: "Active" },
                  { value: "archived", label: "Archived" },
                ]}
              />
            </Field>
          )}
          {!editing && (
            <Field label={`Members (${memberIds.size} selected)`} htmlFor="c-search">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input id="c-search" placeholder="Search staff..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {filtered.map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <Checkbox checked={memberIds.has(u.id)} onCheckedChange={() => toggle(u.id)} />
                    <span className="flex-1 truncate">{u.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                  </label>
                ))}
                {filtered.length === 0 && <p className="p-2 text-sm text-muted-foreground">No matching staff.</p>}
              </div>
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : editing ? "Save changes" : "Create committee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
