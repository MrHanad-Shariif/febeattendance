import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AppLayout from "./components/layout/AppLayout.jsx";

import Login from "./pages/auth/Login.jsx";
import ForgotPassword from "./pages/auth/ForgotPassword.jsx";
import ResetPassword from "./pages/auth/ResetPassword.jsx";
import ActivateAccount from "./pages/auth/ActivateAccount.jsx";
import RegisterStudent from "./pages/auth/RegisterStudent.jsx";
import VerifyEmail from "./pages/auth/VerifyEmail.jsx";
import Kiosk from "./pages/kiosk/Kiosk.jsx";

import Dashboard from "./pages/lecturer/Dashboard.jsx";
import History from "./pages/lecturer/History.jsx";
import ClassCode from "./pages/lecturer/ClassCode.jsx";
import LecturerStudentAttendance from "./pages/lecturer/StudentAttendance.jsx";

import StudentDashboard from "./pages/student/Dashboard.jsx";
import StudentTimetable from "./pages/student/Timetable.jsx";
import StudentReport from "./pages/student/Report.jsx";

import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import Overview from "./pages/admin/Overview.jsx";
import Lecturers from "./pages/admin/Lecturers.jsx";
import Timetable from "./pages/admin/Timetable.jsx";
import Reports from "./pages/admin/Reports.jsx";
import Settings from "./pages/admin/Settings.jsx";
import Students from "./pages/admin/Students.jsx";
import AdminStudentReport from "./pages/admin/StudentReport.jsx";
import StudentReports from "./pages/admin/StudentReports.jsx";
import StudentOverview from "./pages/admin/StudentOverview.jsx";

import StudentReportPrint from "./pages/reports/StudentReportPrint.jsx";

function Home() {
  const { user } = useAuth();
  if (user?.role === "admin") return <Navigate to="/admin" replace />;
  if (user?.role === "student") return <StudentDashboard />;
  return <Dashboard />;
}

function guard(roles, element) {
  return <ProtectedRoute roles={roles}>{element}</ProtectedRoute>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<RegisterStudent />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/activate" element={<ActivateAccount />} />
      <Route path="/kiosk" element={<Kiosk />} />

      {/* Standalone (no app chrome) */}
      <Route path="/print/student-report/:id" element={guard(["admin"], <StudentReportPrint />)} />
      <Route path="/class-code" element={guard(["lecturer", "admin"], <ClassCode />)} />

      {/* Everything else lives inside the sidebar layout */}
      <Route element={guard(undefined, <AppLayout />)}>
        <Route path="/" element={<Home />} />

        {/* Lecturer */}
        <Route path="/checkin" element={guard(["lecturer"], <Dashboard />)} />
        <Route path="/history" element={guard(["lecturer"], <History />)} />
        <Route path="/my-students" element={guard(["lecturer"], <LecturerStudentAttendance />)} />

        {/* Student */}
        <Route path="/student-checkin" element={guard(["student"], <StudentDashboard />)} />
        <Route path="/student-timetable" element={guard(["student"], <StudentTimetable />)} />
        <Route path="/student-report" element={guard(["student"], <StudentReport />)} />

        {/* Admin */}
        <Route path="/admin" element={guard(["admin"], <AdminDashboard />)} />
        <Route path="/admin/overview" element={guard(["admin"], <Overview />)} />
        <Route path="/admin/lecturers" element={guard(["admin"], <Lecturers />)} />
        <Route path="/admin/timetable" element={guard(["admin"], <Timetable />)} />
        <Route path="/admin/reports" element={guard(["admin"], <Reports />)} />
        <Route path="/admin/settings" element={guard(["admin"], <Settings />)} />
        <Route path="/admin/students" element={guard(["admin"], <Students />)} />
        <Route path="/admin/students/:id/report" element={guard(["admin"], <AdminStudentReport />)} />
        <Route path="/admin/student-overview" element={guard(["admin"], <StudentOverview />)} />
        <Route path="/admin/student-reports" element={guard(["admin"], <StudentReports />)} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
