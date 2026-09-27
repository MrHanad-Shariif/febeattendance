"""The one FEBEMS document template: letterhead, title band, details table,
text sections, signature lines and a numbered footer.

Memos, meeting agendas and task completion reports are all rendered with
`FebeDocument`, so every official document the system produces looks the
same. Output is PDF bytes; callers store them with utils.uploads.
"""
import os
from datetime import datetime

from fpdf import FPDF

SYSTEM_NAME = "FEBEMS"
SYSTEM_FULL_NAME = "Faculty of Engineering and Built Environment Management System"
FACULTY_NAME = "Faculty of Engineering and Built Environment"

LOGO_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "logo.png")

GREEN = (21, 128, 61)
DARK_GREEN = (6, 78, 59)
INK = (15, 23, 42)
MUTED = (100, 116, 139)
RULE = (203, 213, 225)
SHADE = (240, 253, 244)

# The built-in PDF fonts only cover Latin-1, so common typographic
# characters are mapped and anything else is replaced.
_REPLACEMENTS = {
    "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"',
    "•": "-", "…": "...", " ": " ", "→": "->", "≤": "<=", "≥": ">=",
}


def pdf_text(value) -> str:
    text = "" if value is None else str(value)
    for bad, good in _REPLACEMENTS.items():
        text = text.replace(bad, good)
    return text.encode("latin-1", "replace").decode("latin-1")


def fmt_date(value) -> str:
    return value.strftime("%d %B %Y") if value else "-"


def fmt_datetime(value) -> str:
    return value.strftime("%d %B %Y, %H:%M") if value else "-"


class FebeDocument(FPDF):
    def __init__(self, doc_type: str, reference_no: str | None, unit: str | None = None):
        super().__init__(format="A4")
        self.doc_type = doc_type
        self.reference_no = reference_no
        self.unit = unit
        self.generated_at = datetime.now()
        self.set_margins(18, 16, 18)
        self.set_auto_page_break(auto=True, margin=22)
        self.alias_nb_pages()
        self.set_title(pdf_text(f"{doc_type} {reference_no or ''}".strip()))
        self.set_author(SYSTEM_NAME)
        self.set_creator(f"{SYSTEM_NAME} - {SYSTEM_FULL_NAME}")
        self.add_page()

    # ---------- page furniture ----------

    def header(self):
        top = self.get_y()
        if os.path.exists(LOGO_PATH):
            self.image(LOGO_PATH, x=self.l_margin, y=top, h=17)
        self.set_xy(self.l_margin + 50, top + 1)
        self.set_font("Helvetica", "B", 12)
        self.set_text_color(*DARK_GREEN)
        self.cell(0, 6, pdf_text(FACULTY_NAME.upper()), align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_x(self.l_margin + 50)
        self.set_font("Helvetica", "", 8.5)
        self.set_text_color(*MUTED)
        self.cell(0, 4.5, pdf_text(f"{SYSTEM_NAME} - {SYSTEM_FULL_NAME}"), align="R", new_x="LMARGIN", new_y="NEXT")
        if self.unit:
            self.set_x(self.l_margin + 50)
            self.set_font("Helvetica", "B", 9)
            self.set_text_color(*INK)
            self.cell(0, 5, pdf_text(self.unit), align="R", new_x="LMARGIN", new_y="NEXT")
        y = max(self.get_y(), top + 18) + 2
        self.set_draw_color(*GREEN)
        self.set_line_width(0.8)
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.set_line_width(0.2)
        self.set_y(y + 5)

    def footer(self):
        self.set_y(-15)
        self.set_draw_color(*RULE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(1.5)
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(*MUTED)
        left = f"{SYSTEM_NAME} - Official record" + (f" - Ref. {self.reference_no}" if self.reference_no else "")
        self.cell(0, 4, pdf_text(left), align="L")
        self.set_x(self.l_margin)
        self.cell(0, 4, pdf_text(f"Generated {fmt_datetime(self.generated_at)} - Page {self.page_no()} of {{nb}}"), align="R")

    # ---------- content blocks ----------

    def title_band(self, title: str, date_value=None):
        """Document type in a shaded band, with the reference and date."""
        self.set_fill_color(*SHADE)
        self.set_draw_color(*GREEN)
        y = self.get_y()
        self.rect(self.l_margin, y, self.epw, 16, style="DF")
        self.set_xy(self.l_margin + 4, y + 2.5)
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(*DARK_GREEN)
        self.cell(self.epw * 0.6, 6, pdf_text(self.doc_type.upper()))
        self.set_font("Helvetica", "", 8.5)
        self.set_text_color(*INK)
        self.set_xy(self.l_margin, y + 2.5)
        self.cell(self.epw - 4, 5, pdf_text(f"Ref: {self.reference_no or '-'}"), align="R")
        self.set_xy(self.l_margin, y + 7.5)
        self.cell(self.epw - 4, 5, pdf_text(f"Date: {fmt_date(date_value or self.generated_at)}"), align="R")
        self.set_xy(self.l_margin + 4, y + 9)
        self.set_font("Helvetica", "B", 10)
        self.cell(self.epw * 0.62, 5, pdf_text(title)[:95])
        self.set_y(y + 21)

    def details(self, rows: list[tuple[str, str]], label_width: float = 45):
        """Two-column label/value table."""
        self.set_draw_color(*RULE)
        for label, value in rows:
            self.set_font("Helvetica", "B", 9)
            self.set_text_color(*MUTED)
            y = self.get_y()
            if y > self.page_break_trigger - 12:
                self.add_page()
                y = self.get_y()
            self.set_fill_color(248, 250, 252)
            self.multi_cell(label_width, 6.5, pdf_text(label.upper()), border="LTB", fill=True,
                            new_x="RIGHT", new_y="TOP", max_line_height=6.5)
            self.set_font("Helvetica", "", 9.5)
            self.set_text_color(*INK)
            self.multi_cell(self.epw - label_width, 6.5, pdf_text(value if value not in (None, "") else "-"),
                            border="RTB", new_x="LMARGIN", new_y="NEXT")
            # Keep the label cell as tall as a wrapped value.
            bottom = self.get_y()
            if bottom - y > 6.6:
                self.rect(self.l_margin, y, label_width, bottom - y)
        self.ln(5)

    def section(self, heading: str, text: str | None, placeholder: str = "Not provided."):
        if self.get_y() > self.page_break_trigger - 20:
            self.add_page()
        self.set_font("Helvetica", "B", 10.5)
        self.set_text_color(*GREEN)
        self.cell(0, 6, pdf_text(heading.upper()), new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*RULE)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(2)
        self.set_font("Helvetica", "" if text else "I", 10)
        self.set_text_color(*(INK if text else MUTED))
        self.multi_cell(0, 5.5, pdf_text(text or placeholder), new_x="LMARGIN", new_y="NEXT")
        self.ln(4)

    def bullet_list(self, heading: str, items: list[str], placeholder: str = "None."):
        self.section(heading, "\n".join(f"-  {i}" for i in items) if items else None, placeholder)

    def paragraph(self, text: str | None, size: float = 10.5, line: float = 6):
        self.set_font("Helvetica", "", size)
        self.set_text_color(*INK)
        self.multi_cell(0, line, pdf_text(text or ""), new_x="LMARGIN", new_y="NEXT")
        self.ln(3)

    def signatures(self, parties: list[tuple[str, str | None]]):
        """Signature lines: [(role, name)]."""
        if self.get_y() + 36 > self.h - 17:  # the block is ~35 mm tall; keep it clear of the footer
            self.add_page()
        self.ln(8)
        width = self.epw / max(3, len(parties))
        y = self.get_y()
        self.set_auto_page_break(False)
        for i, (role, name) in enumerate(parties):
            x = self.l_margin + i * width
            self.set_draw_color(*INK)
            self.line(x + 2, y + 12, x + width - 8, y + 12)
            self.set_xy(x + 2, y + 13)
            self.set_font("Helvetica", "B", 9)
            self.set_text_color(*INK)
            self.cell(width - 10, 5, pdf_text(name or ""), new_x="LEFT", new_y="NEXT")
            self.set_font("Helvetica", "", 8.5)
            self.set_text_color(*MUTED)
            self.cell(width - 10, 4.5, pdf_text(role), new_x="LEFT", new_y="NEXT")
            self.cell(width - 10, 4.5, "Signature & date")
        self.set_auto_page_break(True, margin=22)
        self.set_y(y + 30)

    def output_bytes(self) -> bytes:
        return bytes(self.output())
