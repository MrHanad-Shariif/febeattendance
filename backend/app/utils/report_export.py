"""One report definition, two downloads: a branded PDF and an editable Excel
workbook built from exactly the same rows.

A report endpoint builds a `Report` (title, period, the filters applied and
one or more `Table`s) from the data it already shows on screen, then calls
`send(report, fmt)`. Nothing here recalculates anything, so the PDF, the
Excel file and the page always agree.

Branding (university and faculty names, footer text) comes from Settings;
the logo is the official asset in app/static/logo.png (utils.pdf.LOGO_PATH).
"""
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime

from flask import Response, request
from fpdf import FPDF
from fpdf.fonts import FontFace

from app.utils import xlsx_report as xl
from app.utils.pdf import DARK_GREEN, GREEN, INK, LOGO_PATH, MUTED, RULE, SYSTEM_FULL_NAME, SYSTEM_NAME, pdf_text
from app.utils.settings import get_all_settings
from app.utils.validation import ValidationError

FORMATS = ("pdf", "xlsx")
# A PDF of tens of thousands of rows is unreadable and slow to build; past
# this the PDF says so and points to the Excel file, which has every row.
PDF_ROW_LIMIT = 3000

PDF_FILLS = {k: tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) for k, v in xl.CATEGORY_FILLS.items()}
ZEBRA = (247, 250, 248)


@dataclass
class Column:
    key: str
    header: str
    width: float = 12  # Excel character widths; the PDF uses them as proportions
    kind: str | None = None  # int | num | pct | date | None (text)

    def as_tuple(self):
        return (self.key, self.header, self.width, self.kind)


@dataclass
class Table:
    name: str  # worksheet name
    title: str
    columns: list
    rows: list
    summary: list | None = None  # [(label, value, category_or_None)]
    note: str | None = None
    status_col: str | None = None  # column whose cell is coloured by row["category"]
    category_key: str | None = "category"


@dataclass
class Report:
    title: str
    slug: str  # file name part, e.g. "Lecturer_Attendance"
    period_label: str
    tables: list
    filters: list = field(default_factory=list)  # ["Class: BCE08", ...]
    generated: datetime = field(default_factory=datetime.now)
    orientation: str | None = None  # "portrait" | "landscape"; chosen from the columns if None


def brand() -> dict:
    s = get_all_settings()
    return {
        "university": s.get("report_university_name") or "SIMAD University",
        "faculty": s.get("report_faculty_name") or xl.FACULTY,
        "footer": s.get("report_footer") or "SIMAD University - Faculty of Engineering and Built Environment",
        "system": f"{SYSTEM_NAME} - {SYSTEM_FULL_NAME}",
    }


def export_format(default: str | None = "xlsx") -> str:
    fmt = (request.args.get("format") or default or "").lower()
    if fmt not in FORMATS:
        raise ValidationError("format must be pdf or xlsx")
    return fmt


def filename(slug: str, fmt: str, day: date | None = None) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "_", slug).strip("_") or "Report"
    return f"FEBE_{slug}_{(day or date.today()).isoformat()}.{fmt}"


def send(report: Report, fmt: str) -> Response:
    if fmt == "pdf":
        body, mimetype = to_pdf(report), "application/pdf"
    else:
        body, mimetype = to_xlsx(report), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return Response(body, mimetype=mimetype,
                    headers={"Content-Disposition": f"attachment; filename={filename(report.slug, fmt)}"})


# ---------- Excel ----------

def to_xlsx(report: Report) -> bytes:
    b = brand()
    wb = xl.new_workbook()
    scope = " · ".join(report.filters) or None
    for t in report.tables:
        xl.add_sheet(wb, t.name, t.title, report.period_label, [c.as_tuple() for c in t.columns], t.rows,
                     summary=t.summary, category_key=t.category_key if t.status_col else None,
                     status_col=t.status_col, scope=scope, generated=report.generated, note=t.note, brand=b)
    return xl.to_bytes(wb)


# ---------- PDF ----------

def _fmt(value, kind):
    if value is None or value == "":
        return "-"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if kind == "pct" and isinstance(value, (int, float)):
        return f"{value:.1f}%"
    if kind == "num" and isinstance(value, float):
        return f"{value:.1f}"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


class ReportPDF(FPDF):
    def __init__(self, report: Report, orientation: str):
        super().__init__(orientation="L" if orientation == "landscape" else "P", format="A4")
        self.report = report
        self.brand = brand()
        self.set_margins(12, 12, 12)
        self.set_auto_page_break(auto=True, margin=16)
        self.alias_nb_pages()
        self.set_title(pdf_text(report.title))
        self.set_author(pdf_text(self.brand["university"]))
        self.set_creator(SYSTEM_NAME)

    def header(self):
        top = self.get_y()
        if self.page_no() == 1:
            if os.path.exists(LOGO_PATH):
                self.image(LOGO_PATH, x=self.l_margin, y=top, h=16)
            x = self.l_margin + 52
            self.set_xy(x, top)
            self.set_font("Helvetica", "B", 13)
            self.set_text_color(*DARK_GREEN)
            self.cell(0, 6, pdf_text(self.brand["university"]), align="R", new_x="LMARGIN", new_y="NEXT")
            self.set_x(x)
            self.set_font("Helvetica", "", 9)
            self.set_text_color(*INK)
            self.cell(0, 4.5, pdf_text(self.brand["faculty"]), align="R", new_x="LMARGIN", new_y="NEXT")
            self.set_x(x)
            self.set_font("Helvetica", "", 7.5)
            self.set_text_color(*MUTED)
            self.cell(0, 4, pdf_text(self.brand["system"]), align="R", new_x="LMARGIN", new_y="NEXT")
            y = max(self.get_y(), top + 17) + 1.5
        else:
            self.set_font("Helvetica", "B", 8.5)
            self.set_text_color(*DARK_GREEN)
            self.cell(0, 5, pdf_text(f"{self.brand['university']} - {self.brand['faculty']}"), new_x="LMARGIN", new_y="TOP")
            self.set_font("Helvetica", "", 8)
            self.set_text_color(*MUTED)
            self.cell(0, 5, pdf_text(f"{self.report.title} - {self.report.period_label}"), align="R",
                      new_x="LMARGIN", new_y="NEXT")
            y = self.get_y() + 1
        self.set_draw_color(*GREEN)
        self.set_line_width(0.6 if self.page_no() == 1 else 0.3)
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.set_line_width(0.2)
        self.set_y(y + 3)

    def footer(self):
        self.set_y(-11)
        self.set_draw_color(*RULE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(1)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*MUTED)
        self.cell(0, 4, pdf_text(f"{self.brand['footer']} - {self.report.title}"), align="L")
        self.set_x(self.l_margin)
        self.cell(0, 4, pdf_text(f"Generated {self.report.generated:%d %b %Y %H:%M} - Page {self.page_no()} of {{nb}}"),
                  align="R")

    def title_block(self):
        r = self.report
        self.set_font("Helvetica", "B", 15)
        self.set_text_color(*INK)
        self.multi_cell(0, 7, pdf_text(r.title), new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*INK)
        self.cell(0, 5, pdf_text(f"Reporting period: {r.period_label}"), new_x="LMARGIN", new_y="NEXT")
        if r.filters:
            self.set_text_color(*MUTED)
            self.multi_cell(0, 4.5, pdf_text("Filters: " + " · ".join(r.filters)), new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 4.5, pdf_text(f"Generated {r.generated:%d %B %Y, %H:%M} (campus time)"), new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def summary_block(self, items):
        per_row = 4 if self.cur_orientation == "L" else 3
        w = self.epw / per_row
        h = 11
        for i, (label, value, cat) in enumerate(items):
            col = i % per_row
            if col == 0:
                if self.get_y() + h > self.page_break_trigger:
                    self.add_page()
                y = self.get_y()
            x = self.l_margin + col * w
            self.set_fill_color(*PDF_FILLS.get(cat, (249, 250, 251)))
            self.set_draw_color(*RULE)
            self.rect(x + 0.5, y, w - 1, h - 1, style="DF")
            self.set_xy(x + 2, y + 1)
            self.set_font("Helvetica", "", 7)
            self.set_text_color(*MUTED)
            self.cell(w - 4, 3.5, pdf_text(label.upper())[:48])
            self.set_xy(x + 2, y + 4.6)
            self.set_font("Helvetica", "B", 10.5)
            self.set_text_color(*INK)
            self.cell(w - 4, 5, pdf_text(_fmt(value, None))[:40])
            if col == per_row - 1 or i == len(items) - 1:
                self.set_xy(self.l_margin, y + h)
        self.ln(2)

    def section_title(self, text):
        if self.get_y() > self.page_break_trigger - 25:
            self.add_page()
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*GREEN)
        self.cell(0, 6, pdf_text(text), new_x="LMARGIN", new_y="NEXT")

    def note(self, text):
        self.set_font("Helvetica", "I", 7.5)
        self.set_text_color(*MUTED)
        self.multi_cell(0, 3.8, pdf_text(text), new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def data_table(self, t: Table):
        rows = t.rows[:PDF_ROW_LIMIT]
        if not rows:
            self.set_font("Helvetica", "I", 9)
            self.set_text_color(*MUTED)
            self.cell(0, 8, "No records for this period and filter.", new_x="LMARGIN", new_y="NEXT")
            return
        ncols = len(t.columns)
        size = 8 if ncols <= 8 else 7.5 if ncols <= 11 else 7
        self.set_font("Helvetica", "", size)
        self.set_text_color(*INK)
        self.set_draw_color(*RULE)
        aligns = tuple("R" if c.kind in ("int", "num", "pct") else "L" for c in t.columns)
        status_i = next((i for i, c in enumerate(t.columns) if c.key == t.status_col), None)
        with self.table(
            col_widths=tuple(c.width for c in t.columns), text_align=aligns, line_height=size * 0.48,
            headings_style=FontFace(emphasis="BOLD", color=(255, 255, 255), fill_color=GREEN, size_pt=size),
            repeat_headings=1,
            padding=(1, 1.2), width=self.epw, v_align="TOP", borders_layout="HORIZONTAL_LINES",
        ) as table:
            head = table.row()
            for c in t.columns:
                head.cell(pdf_text(c.header), align="C")
            plain = (FontFace(emphasis="", fill_color=(255, 255, 255)), FontFace(emphasis="", fill_color=ZEBRA))
            for n, r in enumerate(rows):
                row = table.row()
                for i, c in enumerate(t.columns):
                    style = plain[n % 2]
                    if i == status_i and r.get(t.category_key) in PDF_FILLS:
                        style = FontFace(emphasis="BOLD", fill_color=PDF_FILLS[r[t.category_key]])
                    row.cell(pdf_text(_fmt(r.get(c.key), c.kind)), style=style)
        if len(t.rows) > PDF_ROW_LIMIT:
            self.ln(2)
            self.note(f"This PDF shows the first {PDF_ROW_LIMIT:,} of {len(t.rows):,} rows. "
                      "Download the Excel file for every row.")
        self.ln(3)


def _orientation(report: Report) -> str:
    if report.orientation:
        return report.orientation
    widest = max((sum(c.width for c in t.columns) for t in report.tables), default=0)
    most = max((len(t.columns) for t in report.tables), default=0)
    return "landscape" if widest > 110 or most > 7 else "portrait"


def to_pdf(report: Report) -> bytes:
    pdf = ReportPDF(report, _orientation(report))
    pdf.add_page()
    pdf.title_block()
    for n, t in enumerate(report.tables):
        if n and len(report.tables) > 1:
            pdf.ln(2)
        if len(report.tables) > 1 or t.title != report.title:
            pdf.section_title(t.title)
        if t.summary:
            pdf.summary_block(t.summary)
        if t.note:
            pdf.note(t.note)
        pdf.data_table(t)
    return bytes(pdf.output())
