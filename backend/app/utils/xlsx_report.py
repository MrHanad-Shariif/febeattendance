"""Print-ready Excel workbooks for the attendance reports.

Every sheet starts with the faculty heading, the report title, the period
and the generation time, then (optionally) a block of summary statistics,
then the table: bold green header row repeated on every printed page,
frozen below the header, filterable, zebra-free but with status cells
coloured by category. Pages print landscape, fitted to one page wide, with
page numbers in the footer.
"""
import io
from copy import copy
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BRAND = "15803D"
FACULTY = "Faculty of Engineering and Built Environment (FEBE)"
SYSTEM = "FEBEMS — Faculty of Engineering and Built Environment Management System"

CATEGORY_FILLS = {
    "present": "DCFCE7",
    "late": "FEF3C7",
    "absent": "FEE2E2",
    "justified": "DBEAFE",
    "left_early": "FFEDD5",
    "no_checkout": "EDE9FE",
    "exempted": "E5E7EB",
    "not_yet": "F3F4F6",
    "warning": "FEF3C7",
    "blocked": "FEE2E2",
}

_thin = Side(style="thin", color="D1D5DB")
BORDER = Border(left=_thin, right=_thin, top=_thin, bottom=_thin)
# Shared style objects: building new ones per cell makes a 25 000-row
# semester export several times slower.
ALIGN_TOP = Alignment(vertical="top")
ALIGN_WRAP = Alignment(vertical="top", wrap_text=True)
BOLD = Font(bold=True)
FILLS = {k: PatternFill("solid", fgColor=v) for k, v in CATEGORY_FILLS.items()}


def _heading(ws, title: str, period_label: str, ncols: int, generated: datetime, scope: str | None):
    lines = [
        (SYSTEM, Font(bold=True, size=11, color=BRAND)),
        (FACULTY, Font(size=10, color="374151")),
        (title, Font(bold=True, size=15)),
        (f"Reporting period: {period_label}", Font(size=11)),
    ]
    if scope:
        lines.append((scope, Font(size=10, color="374151")))
    lines.append((f"Generated: {generated:%d %B %Y, %H:%M} (campus time)", Font(italic=True, size=9, color="6B7280")))
    for i, (text, font) in enumerate(lines, 1):
        ws.cell(row=i, column=1, value=text).font = font
        ws.merge_cells(start_row=i, start_column=1, end_row=i, end_column=max(ncols, 1))
    return len(lines) + 2  # next free row, after a blank line


def _summary_block(ws, row: int, summary: list[tuple], ncols: int) -> int:
    """summary: [(label, value, category_or_None)] laid out as label/value pairs, 3 per line."""
    ws.cell(row=row, column=1, value="Summary").font = Font(bold=True, size=12, color=BRAND)
    row += 1
    per_line = 3 if ncols >= 6 else 1
    for i, (label, value, cat) in enumerate(summary):
        r = row + i // per_line
        c = 1 + (i % per_line) * 2
        lc = ws.cell(row=r, column=c, value=label)
        lc.font = Font(bold=True, size=10)
        lc.border = BORDER
        lc.fill = PatternFill("solid", fgColor=CATEGORY_FILLS.get(cat, "F9FAFB"))
        vc = ws.cell(row=r, column=c + 1, value=value)
        vc.border = BORDER
        vc.alignment = Alignment(horizontal="right")
        vc.font = Font(size=10)
    return row + (len(summary) + per_line - 1) // per_line + 1


def add_sheet(wb, name: str, title: str, period_label: str, columns: list[tuple], rows: list[dict],
              summary: list[tuple] | None = None, category_key: str | None = "category",
              status_col: str | None = None, scope: str | None = None, generated: datetime | None = None,
              note: str | None = None):
    """columns: [(key, header, width)]. Cells in `status_col` (default: the
    column named by category_key's label) are filled by row[category_key]."""
    generated = generated or datetime.now()
    ws = wb.create_sheet(title=name[:31])
    ncols = len(columns)
    row = _heading(ws, title, period_label, ncols, generated, scope)
    if summary:
        row = _summary_block(ws, row, summary, ncols)
    if note:
        ws.cell(row=row, column=1, value=note).font = Font(italic=True, size=9, color="6B7280")
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=max(ncols, 1))
        row += 2

    header_row = row
    for c, (_key, header, width) in enumerate(columns, 1):
        cell = ws.cell(row=header_row, column=c, value=header)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor=BRAND)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
        ws.column_dimensions[get_column_letter(c)].width = width
    ws.row_dimensions[header_row].height = 30

    status_index = None
    if status_col:
        status_index = next((i for i, (k, _h, _w) in enumerate(columns, 1) if k == status_col), None)

    # Style one scratch cell per look, then copy its style array to every
    # data cell: assigning openpyxl style objects cell by cell re-hashes them
    # each time and made a 25 000-row export take ~20 s.
    looks = {}
    scratch_ws = wb.create_sheet("_styles")

    def look(wrap: bool, fill_key):
        key = (wrap, fill_key)
        if key not in looks:
            scratch = scratch_ws.cell(row=len(looks) + 1, column=1)
            scratch.border = BORDER
            scratch.alignment = ALIGN_WRAP if wrap else ALIGN_TOP
            if fill_key is not None:
                scratch.fill = FILLS[fill_key]
                scratch.font = BOLD
            looks[key] = copy(scratch._style)
        return looks[key]

    for r in rows:
        row += 1
        fill_key = r.get(category_key) if category_key else None
        if fill_key not in FILLS:
            fill_key = None
        for c, (key, _header, _width) in enumerate(columns, 1):
            value = r.get(key)
            if isinstance(value, bool):
                value = "Yes" if value else "No"
            cell = ws.cell(row=row, column=c, value=value if value not in (None, "") else None)
            wrap = isinstance(value, str) and len(value) > 18
            cell._style = copy(look(wrap, fill_key if c == status_index else None))
    wb.remove(scratch_ws)

    if not rows:
        ws.cell(row=header_row + 1, column=1, value="No records for this period and filter.").font = Font(italic=True)

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    if rows:
        ws.auto_filter.ref = f"A{header_row}:{get_column_letter(ncols)}{row}"

    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{header_row}:{header_row}"
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.6
    ws.print_options.horizontalCentered = True
    ws.oddFooter.left.text = f"{title} — {period_label}"
    ws.oddFooter.left.size = 8
    ws.oddFooter.right.text = "Page &P of &N"
    ws.oddFooter.right.size = 8
    return ws


def new_workbook():
    wb = Workbook()
    wb.remove(wb.active)
    return wb


def to_bytes(wb) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
