import { useEffect, useState } from "react";
import client, { apiErrorMessage } from "@/api/client";
import StudentReportView from "@/components/StudentReportView.jsx";
import { Alert, PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function StudentReport() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client
      .get("/student/report")
      .then((res) => setReport(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="My attendance report" description="Attendance per course, and whether any course is at risk of a retake." />
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
