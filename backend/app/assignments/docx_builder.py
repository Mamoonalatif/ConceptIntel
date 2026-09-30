"""Builds the formal Word (.docx) handout for an AI-drafted assignment.

The document follows the layout used for Air University assignments: a university
header, a course/assignment information table, student identification fields,
objectives, numbered tasks with marks, submission guidelines and an academic-integrity
declaration, followed by the detailed grading rubric (criteria x performance levels).
It is generated from the AssignmentDraftOut-shaped dict stored on a GeneratedContent
row, so the same document can be downloaded while the draft is still being reviewed
and is attached to the assignment when the teacher posts it to students.
"""
import io
from datetime import datetime
from typing import Any, Dict, Optional

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

UNIVERSITY_NAME = "AIR UNIVERSITY"


def _shade(cell, hex_fill: str) -> None:
    """Fills a table cell with a solid background colour."""
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def _set_cell(cell, text: str, bold: bool = False, size: int = 10, fill: Optional[str] = None, center: bool = False) -> None:
    """Writes text into a table cell with the given weight/size/shading."""
    cell.text = ""
    para = cell.paragraphs[0]
    run = para.add_run(text or "")
    run.bold = bold
    run.font.size = Pt(size)
    if center:
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    if fill:
        _shade(cell, fill)


def _heading(doc: Document, text: str) -> None:
    """A bold, underlined-style section heading."""
    para = doc.add_paragraph()
    para.paragraph_format.space_before = Pt(10)
    para.paragraph_format.space_after = Pt(3)
    run = para.add_run(text.upper())
    run.bold = True
    run.font.size = Pt(11)
    run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)


def _fmt(n: Any) -> str:
    """Formats a mark value without a trailing .0."""
    try:
        f = float(n)
    except (TypeError, ValueError):
        return str(n)
    return str(int(f)) if f == int(f) else f"{f:g}"


def build_assignment_docx(
    draft: Dict[str, Any],
    course_name: str,
    course_code: Optional[str] = None,
    semester: Optional[str] = None,
    teacher_name: Optional[str] = None,
    due_date: Optional[datetime] = None,
    title: Optional[str] = None,
    total_marks: Optional[float] = None,
) -> bytes:
    """Renders the assignment + rubric as a .docx and returns the file bytes.

    `title`/`due_date`/`total_marks` let the teacher's edits at posting time override
    the AI draft's own values; everything else comes from the draft."""
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)

    marks = total_marks if total_marks is not None else draft.get("points")
    assignment_title = title or draft.get("title") or "Assignment"

    # ---- Letterhead -------------------------------------------------------
    head = doc.add_paragraph()
    head.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = head.add_run(UNIVERSITY_NAME)
    run.bold = True
    run.font.size = Pt(18)
    run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = sub.add_run("Assignment")
    r.bold = True
    r.font.size = Pt(13)

    # ---- Course / assignment information table ------------------------------
    info = [
        ("Course Title", course_name),
        ("Course Code", course_code or "-"),
        ("Semester", semester or "-"),
        ("Instructor", teacher_name or "-"),
        ("Assignment Title", assignment_title),
        ("Total Marks", _fmt(marks) if marks is not None else "-"),
        ("Due Date", due_date.strftime("%d %B %Y, %I:%M %p") if due_date else "As announced by the instructor"),
    ]
    table = doc.add_table(rows=len(info), cols=2)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (k, v) in enumerate(info):
        _set_cell(table.cell(i, 0), k, bold=True, fill="E8EEF5")
        _set_cell(table.cell(i, 1), v)
    for row in table.rows:
        row.cells[0].width = Pt(130)
        row.cells[1].width = Pt(330)

    # ---- Student identification ---------------------------------------------
    doc.add_paragraph()
    ident = doc.add_table(rows=1, cols=3)
    ident.style = "Table Grid"
    for i, label in enumerate(("Student Name:", "Registration No.:", "Section:")):
        _set_cell(ident.cell(0, i), label, bold=True, size=10)

    # ---- Objectives ---------------------------------------------------------
    objectives = draft.get("objectives") or []
    if objectives:
        _heading(doc, "Learning Objectives")
        for o in objectives:
            doc.add_paragraph(o, style="List Bullet")

    # ---- Overview / instructions -------------------------------------------
    _heading(doc, "Assignment Overview")
    doc.add_paragraph(draft.get("instructions") or "")

    # ---- Tasks --------------------------------------------------------------
    tasks = draft.get("tasks") or []
    if tasks:
        _heading(doc, "Tasks / Questions")
        for i, t in enumerate(tasks, 1):
            para = doc.add_paragraph()
            tr = para.add_run(f"Task {i}: {t.get('title', '')}")
            tr.bold = True
            if t.get("marks") is not None:
                mr = para.add_run(f"   [{_fmt(t['marks'])} marks]")
                mr.italic = True
            doc.add_paragraph(t.get("description") or "")

    # ---- Submission guidelines ---------------------------------------------
    guidelines = draft.get("submission_guidelines") or []
    _heading(doc, "Submission Guidelines")
    for g in guidelines or ["Submit your answers as a single Word (.docx) document."]:
        doc.add_paragraph(g, style="List Bullet")
    doc.add_paragraph("Late submissions are marked as late on the platform. Submit through ConceptIntel before the due date.", style="List Bullet")

    # ---- Academic integrity -------------------------------------------------
    _heading(doc, "Academic Integrity")
    doc.add_paragraph(
        "This is an individual assignment. Plagiarism and copying from other students or "
        "sources without acknowledgement are violations of the university's academic "
        "integrity policy. Submissions are automatically checked for similarity with "
        "other submissions, and any copied work will be reported to the instructor."
    )

    # ---- Rubric (new page) --------------------------------------------------
    doc.add_page_break()
    rp = doc.add_paragraph()
    rp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rr = rp.add_run("GRADING RUBRIC")
    rr.bold = True
    rr.font.size = Pt(14)
    rr.font.color.rgb = RGBColor(0x1F, 0x3A, 0x5F)
    sp = doc.add_paragraph()
    sp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sp.add_run(f"{assignment_title} - {course_name}").italic = True

    criteria = draft.get("criteria") or []
    # Level columns come from the first criterion that has levels (best -> worst).
    level_labels = []
    for c in criteria:
        if c.get("levels"):
            level_labels = [lv.get("label", "") for lv in sorted(c["levels"], key=lambda lv: -float(lv.get("points", 0)))]
            break

    cols = 3 + len(level_labels) if level_labels else 4
    rub = doc.add_table(rows=1, cols=cols)
    rub.style = "Table Grid"
    rub.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = rub.rows[0].cells
    _set_cell(hdr[0], "Criterion", bold=True, size=10, fill="1F3A5F")
    _set_cell(hdr[1], "CLO", bold=True, size=10, fill="1F3A5F", center=True)
    if level_labels:
        for i, lbl in enumerate(level_labels):
            _set_cell(hdr[2 + i], lbl, bold=True, size=10, fill="1F3A5F", center=True)
        _set_cell(hdr[2 + len(level_labels)], "Max", bold=True, size=10, fill="1F3A5F", center=True)
    else:
        _set_cell(hdr[2], "What earns full marks", bold=True, size=10, fill="1F3A5F")
        _set_cell(hdr[3], "Max", bold=True, size=10, fill="1F3A5F", center=True)
    for cell in hdr:
        for run in cell.paragraphs[0].runs:
            run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    total = 0.0
    for c in criteria:
        row = rub.add_row().cells
        name = c.get("title", "")
        desc = c.get("description")
        _set_cell(row[0], f"{name}\n{desc}" if desc else name, size=9)
        row[0].paragraphs[0].runs[0].bold = True
        _set_cell(row[1], c.get("clo_code") or "-", size=9, center=True)
        max_pts = float(c.get("max_points") or 0)
        total += max_pts
        if level_labels:
            by_label = {lv.get("label"): lv for lv in (c.get("levels") or [])}
            for i, lbl in enumerate(level_labels):
                lv = by_label.get(lbl)
                txt = f"({_fmt(lv.get('points'))}) {lv.get('description') or ''}" if lv else "-"
                _set_cell(row[2 + i], txt, size=8)
            _set_cell(row[2 + len(level_labels)], _fmt(max_pts), bold=True, size=10, center=True)
        else:
            _set_cell(row[2], desc or "", size=9)
            _set_cell(row[3], _fmt(max_pts), bold=True, size=10, center=True)

    tot = rub.add_row().cells
    _set_cell(tot[0], "Total", bold=True, size=10, fill="E8EEF5")
    for cell in tot[1:-1]:
        _set_cell(cell, "", fill="E8EEF5")
    _set_cell(tot[-1], _fmt(total), bold=True, size=10, fill="E8EEF5", center=True)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
