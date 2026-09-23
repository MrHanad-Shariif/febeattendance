import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import client, { apiErrorMessage } from "@/api/client";
import StudentReportView from "@/components/StudentReportView.jsx";
import Logo from "@/components/Logo.jsx";
import { Alert } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function StudentReportPrint() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  // Printed reports are always light, whatever theme the app is using.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);

  useEffect(() => {
    client
      .get(`/admin/students/${id}/report`)
      .then((res) => setReport(res.data))
      .catch((err) => setError(apiErrorMessage(err)));
  }, [id]);

  return (
    <div className="mx-auto max-w-4xl bg-white px-6 py-8 text-slate-900">
      <div className="mb-6 flex items-center justify-between border-b pb-4 print:hidden">
        <Logo className="h-10 w-auto" />
        <Button onClick={() => window.print()}>
          <Printer /> Print / Save as PDF
        </Button>
      </div>

      <div className="mb-6 hidden items-center gap-3 print:flex">
        <Logo className="h-10 w-auto" />
        <p className="text-sm text-slate-500">Student Attendance Report</p>
      </div>

      {error && <Alert>{error}</Alert>}
      {report && <StudentReportView report={report} />}
    </div>
  );
}
