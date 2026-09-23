# data/

Drop the source spreadsheets here. **Everything in this folder except this file is git-ignored** because
the files contain personal data about students and staff (names, phone numbers, dates of birth).

Expected files (names can differ; pass the path to the import command):

| File | Loaded with | Contents |
| --- | --- | --- |
| `Latest Lecturer Attendance.xlsx` | `flask import-excel` | Lecturer roster |
| `Time_Table_… .xlsx` | `flask import-confirmed-timetable` | Per-batch timetable: courses, rooms, days, times |
| `stdsRegistered….xls` | `flask import-students` | Official student roster export |

See [docs/DATA_IMPORT.md](../docs/DATA_IMPORT.md).
