import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import StudentReportView from "@/components/StudentReportView.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminStudentReport() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get(`/admin/students/${id}/report`)
      .then((res) => setReport(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student report"
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/students">
                <ArrowLeft /> Students
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={`/print/student-report/${id}`} target="_blank" rel="noopener noreferrer">
                <Printer /> Printable version
              </Link>
            </Button>
          </>
        }
      />

      {error && <Alert>{error}</Alert>}
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : report ? (
        <StudentReportView report={report} />
      ) : null}
    </div>
  );
}
