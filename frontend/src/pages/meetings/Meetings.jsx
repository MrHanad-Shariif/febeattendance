import { useState } from "react";
import { useApi } from "@/components/committees/shared";
import { MeetingTable } from "@/components/committees/tables";
import { Alert, PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Meetings of every committee the user can see (their own; all for the Dean/admins).
 * kind="administration" limits it to Administration Team meetings. */
export default function Meetings({ kind }) {
  const [when, setWhen] = useState("upcoming");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = new URLSearchParams();
  if (when !== "all") params.set("when", when);
  if (kind) params.set("kind", kind);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const { data, loading, error } = useApi(`/meetings?${params}`, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={kind === "administration" ? "Administration meetings" : "Meetings"}
        description="Meetings of your committees. Chairpersons schedule meetings from the committee page."
      />
      {error && <Alert>{error}</Alert>}
      <MeetingTable
        meetings={data}
        loading={loading}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={when} onValueChange={setWhen}>
              <TabsList>
                <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
                <TabsTrigger value="past">Past</TabsTrigger>
                <TabsTrigger value="all">All</TabsTrigger>
              </TabsList>
            </Tabs>
            <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[150px]" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[150px]" />
          </div>
        }
        emptyText={when === "upcoming" ? "No upcoming meetings." : "No meetings found."}
      />
    </div>
  );
}
