# Importing the faculty data

Three commands load everything the system needs from the faculty's spreadsheets. Run them **in this order, once, on a fresh database** (before anyone has checked in).

| # | Command | Source file | Creates |
|---|---|---|---|
| 1 | `flask import-excel <xlsx>` | `Latest Lecturer Attendance.xlsx` | Lecturers (status *invited*, placeholder email) |
| 2 | `flask import-confirmed-timetable <xlsx>` | `Time_Table_OCTOBER 2026 - FEB 2027 (1).xlsx` | Courses, rooms, days, times, batches, per-batch timetable |
| 3 | `flask import-students <xls>` | `stdsRegistered…064554.xls` | Students (status *invited*) with ID, name, batch, department |

## Running them

**Docker (production):** see [DEPLOYMENT.md](DEPLOYMENT.md#4-load-the-faculty-data); files are mounted at `/data`.

**Local development:**

```bash
cd backend
flask import-excel "../data/Latest Lecturer Attendance.xlsx"
flask import-confirmed-timetable "../data/Time_Table_OCTOBER 2026 - FEB 2027 (1).xlsx"
flask import-students "../data/stdsRegistered23092026_064554.xls"
```

## What each step does

1. **Lecturers.** Reads the *Lecturers* and *Timetable* tabs. Existing lecturers (same name) are skipped, so it is safe to re-run. Real emails are missing from the sheet, so each lecturer gets `pending+…@example.invalid` until an admin sets the real email in **Admin → Lecturers**, which sends the activation invite.
2. **Confirmed timetable.** Reads one sheet per batch (`BCE08`, `BARE05`, …; the `ROOM MNGT` sheet is skipped). Only rows highlighted green (confirmed) are imported; back-to-back slots are merged into one class with a session count, and identical classes on several days become one row with a day list. Instructor names are matched to step 1's lecturers (with the typo corrections in the importer); unknown names create new lecturers.
   > ⚠️ **This step deletes every existing timetable row first.** Run it only before attendance data exists, otherwise use the Admin → Timetable screen for changes.
3. **Students.** The roster export is an HTML table saved as `.xls`. Each student is created as a skeleton record. Students *claim* their record by registering at `/register` with their student ID number, choosing their own email and password (see [SECURITY.md](../SECURITY.md#open-risks-and-limitations-please-read), item 1). Existing IDs are skipped, so re-running is safe.

The smaller `stdsRegistered…060313.xls` file is a subset of the larger one and does not need to be imported.

## What you get (from the current files)

| Data | Count |
|---|---|
| Lecturers | 39 (18 with classes in the confirmed timetable) |
| Students | 243 |
| Timetable rows | 54 across 13 batches |
| Distinct courses | 35 |
| Rooms | 301, 302, 304, 305, D Hall |

## Known gaps after import

- **Combined batches.** Sheets `BTE13&BEE11` and `BTE14&BEE12` cover two batches each and are stored as one combined batch code. Students are matched to classes by exact batch code, so students in `BTE13` or `BEE11` do not yet see those classes. Splitting the rows per batch fixes this, at the cost of showing the class twice to its lecturer.
- **Batches without a timetable sheet** (`BARE02`, `BCE07`, `BTE10`) have students but no classes; they also do not appear in the sign-up batch dropdown, which is built from the timetable.
- **About a third of classes (19 of 54) have no room** in the source workbook. Fill them in under **Admin → Timetable**.
- **Lecturers without classes** (21 of 39) have no confirmed sessions yet.

## Removing personal data afterwards

The spreadsheets contain phone numbers and dates of birth. After importing on the server, delete them: `rm data/*.xls*`. They are git-ignored, so they cannot be committed by accident.
