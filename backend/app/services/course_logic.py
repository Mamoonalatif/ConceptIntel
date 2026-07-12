import calendar
import random
import string
from datetime import date
from typing import Optional


def add_months(start: date, months: int) -> date:
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def compute_status(
    enrollment_start_date: date, enrollment_end_date: date, today: Optional[date] = None
) -> str:
    today = today or date.today()
    if today < enrollment_start_date:
        return "draft"
    if today <= enrollment_end_date:
        return "open"
    return "closed"


def generate_enrollment_code(course_code: str, semester: str) -> str:
    code = (course_code or "GEN").upper()
    sem_digits = "".join(ch for ch in semester if ch.isdigit())[-2:] or "26"
    rand = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
    return f"{code}-{sem_digits}{rand[:2]}-{rand[2:]}"


def generate_invite_link(enrollment_code: str) -> str:
    slug = enrollment_code.lower().replace("_", "-")
    return f"https://conceptintel.edu/join/{slug}"
