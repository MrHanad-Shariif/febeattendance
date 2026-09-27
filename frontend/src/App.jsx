import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import WrongQrCode from "./components/WrongQrCode.jsx";
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
import LecturerTimetable from "./pages/lecturer/Timetable.jsx";

// Class assignments (lecturers set them, students submit)
import LecturerAssignments from "./pages/assignments/LecturerAssignments.jsx";
import LecturerAssignmentDetail from "./pages/assignments/LecturerAssignmentDetail.jsx";
import { StudentAssignmentDetail, StudentAssignmentList } from "./pages/assignments/StudentAssignments.jsx";

// Committee archive: memos, meeting agendas and reports
import Archive from "./pages/archive/Archive.jsx";

import StudentDashboard from "./pages/student/Dashboard.jsx";
import StudentCheckIn from "./pages/student/CheckIn.jsx";
import EnrollFace from "./pages/student/EnrollFace.jsx";
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
import MinutesPrint from "./pages/reports/MinutesPrint.jsx";
import ReportPrint from "./pages/reports/ReportPrint.jsx";

// Committees & task management module
import CommitteeList from "./pages/committees/CommitteeList.jsx";
import CommitteeDetail from "./pages/committees/CommitteeDetail.jsx";
import MyTasks from "./pages/tasks/MyTasks.jsx";
import TaskDetail from "./pages/tasks/TaskDetail.jsx";
import Meetings from "./pages/meetings/Meetings.jsx";
import MeetingDetail from "./pages/meetings/MeetingDetail.jsx";
import MinutesArchive from "./pages/minutes/MinutesArchive.jsx";
import MinutesDetail from "./pages/minutes/MinutesDetail.jsx";
import PublishMinutes from "./pages/minutes/PublishMinutes.jsx";
import InformationSharing from "./pages/notices/InformationSharing.jsx";
import NoticeDetail from "./pages/notices/NoticeDetail.jsx";
import Notifications from "./pages/notices/Notifications.jsx";
import CommitteeReports from "./pages/reports/CommitteeReports.jsx";
import FacultyOverview from "./pages/faculty/FacultyOverview.jsx";
import AdminCommittees from "./pages/admin/Committees.jsx";
import FacultyRoles from "./pages/admin/FacultyRoles.jsx";

import { WithCommitteeSummary } from "./components/committees/NotificationBell.jsx";

// User management (fine-grained RBAC) and the reports hub
import Users from "./pages/access/Users.jsx";
import Roles from "./pages/access/Roles.jsx";
import Permissions from "./pages/access/Permissions.jsx";
import AllReports from "./pages/reports/AllReports.jsx";
import CheckinMethods from "./pages/reports/CheckinMethods.jsx";
import { homePath } from "./components/layout/nav-config";

const STAFF = ["admin", "lecturer"];

function Home() {
  const { user } = useAuth();
  if (user?.role === "admin") return <Navigate to={homePath(user)} replace />;
  if (user?.role === "student") return <StudentDashboard />;
  return (
    <WithCommitteeSummary>
      <Dashboard />
    </WithCommitteeSummary>
  );
}

// Same URL, a different page for lecturers and students.
function ByRole({ lecturer, student }) {
  const { user } = useAuth();
  return user?.role === "student" ? student : lecturer;
}

function guard(roles, element) {
  return <ProtectedRoute roles={roles}>{element}</ProtectedRoute>;
}

// Management pages: any staff account holding one of `perms` (RBAC).
function allow(perms, element) {
  return <ProtectedRoute roles={STAFF} perms={perms}>{element}</ProtectedRoute>;
}

// Target of a printed check-in QR code. Scanning the other group's code shows
// a warning instead of silently redirecting.
function QrLanding({ role, children }) {
  const { user } = useAuth();
  if (user && user.role !== role) return <WrongQrCode intendedFor={role} />;
  return children;
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
      <Route path="/print/student-report/:id" element={allow(["students:view", "reports:view"], <StudentReportPrint />)} />
      <Route path="/print/minutes/:id" element={guard(STAFF, <MinutesPrint />)} />
      <Route path="/print/report" element={guard(STAFF, <ReportPrint />)} />
      <Route path="/class-code" element={guard(["lecturer", "admin"], <ClassCode />)} />
      <Route
        path="/enroll-face"
        element={
          <ProtectedRoute roles={["student"]} requireFace={false}>
            <EnrollFace />
          </ProtectedRoute>
        }
      />

      {/* Everything else lives inside the sidebar layout */}
      <Route element={guard(undefined, <AppLayout />)}>
        <Route path="/" element={<Home />} />

        {/* Lecturer */}
        <Route path="/checkin" element={<QrLanding role="lecturer"><Dashboard /></QrLanding>} />
        <Route path="/history" element={guard(["lecturer"], <History />)} />
        <Route path="/my-students" element={guard(["lecturer"], <LecturerStudentAttendance />)} />
        <Route path="/my-timetable" element={guard(["lecturer"], <LecturerTimetable />)} />
        <Route
          path="/assignments"
          element={guard(["lecturer", "student"], <ByRole lecturer={<LecturerAssignments />} student={<StudentAssignmentList />} />)}
        />
        <Route
          path="/assignments/:id"
          element={guard(["lecturer", "student"], <ByRole lecturer={<LecturerAssignmentDetail />} student={<StudentAssignmentDetail />} />)}
        />

        {/* Student */}
        <Route path="/student-checkin" element={<QrLanding role="student"><StudentCheckIn /></QrLanding>} />
        <Route path="/student-timetable" element={guard(["student"], <StudentTimetable />)} />
        <Route path="/student-report" element={guard(["student"], <StudentReport />)} />

        {/* Management screens (each needs its RBAC permission; the API checks too) */}
        <Route path="/admin" element={allow(["dashboard:view"], <WithCommitteeSummary><AdminDashboard /></WithCommitteeSummary>)} />
        <Route path="/admin/overview" element={allow(["lecturer_attendance:view"], <Overview />)} />
        <Route path="/admin/lecturers" element={allow(["lecturers:view"], <Lecturers />)} />
        <Route path="/admin/timetable" element={allow(["timetable:view"], <Timetable />)} />
        <Route path="/admin/reports" element={allow(["reports:view"], <Reports />)} />
        <Route path="/admin/settings" element={allow(["settings:view"], <Settings />)} />
        <Route path="/admin/students" element={allow(["students:view"], <Students />)} />
        <Route path="/admin/students/:id/report" element={allow(["students:view", "reports:view"], <AdminStudentReport />)} />
        <Route path="/admin/student-overview" element={allow(["student_attendance:view"], <StudentOverview />)} />
        <Route path="/admin/student-reports" element={allow(["reports:view"], <StudentReports />)} />
        <Route path="/admin/checkin-methods" element={allow(["reports:view"], <CheckinMethods />)} />
        <Route path="/admin/committees" element={allow(["committees:add", "committees:edit", "committees:delete"], <AdminCommittees />)} />
        <Route path="/admin/faculty-roles" element={allow(["faculty_roles:view"], <FacultyRoles />)} />
        <Route path="/reports" element={guard(STAFF, <AllReports />)} />

        {/* Authentication: users, roles, permissions */}
        <Route path="/access/users" element={allow(["users:view"], <Users />)} />
        <Route path="/access/roles" element={allow(["roles:view"], <Roles />)} />
        <Route path="/access/permissions" element={allow(["roles:view", "users:view"], <Permissions />)} />

        {/* Committees & task management (lecturers and staff; the API checks each role) */}
        <Route path="/committees" element={guard(STAFF, <CommitteeList scope="mine" />)} />
        <Route path="/committees/all" element={guard(STAFF, <CommitteeList scope="all" />)} />
        <Route path="/committees/:id" element={guard(STAFF, <CommitteeDetail />)} />
        <Route path="/administration" element={guard(STAFF, <CommitteeList scope="administration" />)} />
        <Route path="/tasks" element={guard(STAFF, <MyTasks scope="mine" />)} />
        <Route path="/tasks/monitor" element={guard(STAFF, <MyTasks scope="managed" />)} />
        <Route path="/tasks/:id" element={guard(STAFF, <TaskDetail />)} />
        <Route path="/meetings" element={guard(STAFF, <Meetings />)} />
        <Route path="/meetings/:id" element={guard(STAFF, <MeetingDetail />)} />
        <Route path="/archive" element={guard(STAFF, <Archive />)} />
        <Route path="/meeting-minutes" element={guard(STAFF, <MinutesArchive />)} />
        <Route path="/meeting-minutes/publish" element={guard(STAFF, <PublishMinutes />)} />
        <Route path="/meeting-minutes/:id" element={guard(STAFF, <MinutesDetail />)} />
        <Route path="/information" element={guard(STAFF, <InformationSharing />)} />
        <Route path="/information/:id" element={guard(STAFF, <NoticeDetail />)} />
        <Route path="/notifications" element={guard(STAFF, <Notifications />)} />
        <Route path="/committee-reports" element={guard(STAFF, <CommitteeReports />)} />
        <Route path="/faculty" element={guard(STAFF, <FacultyOverview />)} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
