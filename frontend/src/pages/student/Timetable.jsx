import { useEffect, useState } from "react";
import client, { apiErrorMessage } from "@/api/client";
import { Alert, PageHeader } from "@/components/page-header";
import { SemesterBadge, WeeklyTimetable, useSemester } from "@/components/timetable/WeeklyTimetable.jsx";

export default function StudentTimetable() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const semester = useSemester();

  useEffect(() => {
    client
      .get("/student/timetable")
      .then((res) => setEntries(res.data))
      .catch((err) => setError(apiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My timetable"
        description="Your full semester schedule, day by day."
        actions={<SemesterBadge name={semester?.semester_name} />}
      />
      {error && <Alert>{error}</Alert>}
      <WeeklyTimetable entries={entries} loading={loading} emptyText="No timetable set for your batch yet." />
    </div>
  );
}
