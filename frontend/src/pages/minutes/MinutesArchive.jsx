import { useState } from "react";
import { Link } from "react-router-dom";
import { Search, Upload, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext.jsx";
import { Field, OptionSelect, useApi } from "@/components/committees/shared";
import { MinutesTable } from "@/components/committees/tables";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KIND_OPTIONS } from "@/lib/committees";

const EMPTY = { committee_id: "", kind: "", from: "", to: "", released_from: "", released_to: "", year: "", q: "" };

/** Permanent archive of published minutes, searchable by committee,
 * administrative unit, meeting date, release date, year and keyword. */
export default function MinutesArchive({ kind }) {
  const { user } = useAuth();
  const [filters, setFilters] = useState({ ...EMPTY, kind: kind || "" });
  const [applied, setApplied] = useState({ ...EMPTY, kind: kind || "" });
  const committees = useApi("/committees/options", []);
  const params = new URLSearchParams(Object.entries(applied).filter(([, v]) => v));
  const { data, loading, error } = useApi(`/minutes?${params}`, []);
  const canPublish = user?.role === "admin" || user?.capabilities?.is_admin_team;
  const set = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meeting minutes"
        description="The permanent record of officially published minutes."
        actions={
          canPublish && (
            <Button asChild>
              <Link to="/meeting-minutes/publish">
                <Upload /> Publish minutes
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(filters);
            }}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field label="Keyword" htmlFor="mm-q">
              <Input id="mm-q" placeholder="Title, summary, committee..." value={filters.q} onChange={(e) => set("q")(e.target.value)} />
            </Field>
            <Field label="Committee" htmlFor="mm-committee">
              <OptionSelect
                id="mm-committee"
                value={filters.committee_id}
                onChange={set("committee_id")}
                anyLabel="All committees"
                options={(committees.data || []).map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
            <Field label="Administrative unit" htmlFor="mm-kind">
              <OptionSelect id="mm-kind" value={filters.kind} onChange={set("kind")} anyLabel="All units" options={KIND_OPTIONS} />
            </Field>
            <Field label="Year" htmlFor="mm-year">
              <OptionSelect id="mm-year" value={filters.year} onChange={set("year")} anyLabel="Any year" options={years.map((y) => ({ value: y, label: String(y) }))} />
            </Field>
            <Field label="Meeting date from / to" htmlFor="mm-from">
              <div className="flex gap-2">
                <Input id="mm-from" type="date" value={filters.from} onChange={(e) => set("from")(e.target.value)} />
                <Input type="date" aria-label="Meeting date to" value={filters.to} onChange={(e) => set("to")(e.target.value)} />
              </div>
            </Field>
            <Field label="Release date from / to" htmlFor="mm-rfrom">
              <div className="flex gap-2">
                <Input id="mm-rfrom" type="date" value={filters.released_from} onChange={(e) => set("released_from")(e.target.value)} />
                <Input type="date" aria-label="Release date to" value={filters.released_to} onChange={(e) => set("released_to")(e.target.value)} />
              </div>
            </Field>
            <div className="flex items-end gap-2 lg:col-span-2">
              <Button type="submit">
                <Search /> Search
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setFilters({ ...EMPTY, kind: kind || "" });
                  setApplied({ ...EMPTY, kind: kind || "" });
                }}
              >
                <X /> Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {error && <Alert>{error}</Alert>}
      <MinutesTable minutes={data} loading={loading} />
    </div>
  );
}
