import { Link } from "react-router-dom";
import { ArrowRight, FileBarChart } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext.jsx";
import { reportLinks } from "@/components/layout/nav-config";

/** Reports > All reports: every report this account may open, in one place. */
export default function AllReports() {
  const { user } = useAuth();
  const reports = reportLinks(user);

  return (
    <div className="space-y-6">
      <PageHeader title="All reports" description="Every attendance and committee report you have access to." />
      {reports.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <FileBarChart className="h-10 w-10 opacity-60" />
            <p>You don't have access to any reports yet. Ask an administrator for a role with report access.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {reports.map((r) => (
            <Link key={r.to} to={r.to} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/60">
                <CardContent className="flex h-full items-start gap-4 p-5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <r.icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold">
                      {r.label}
                      <ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
