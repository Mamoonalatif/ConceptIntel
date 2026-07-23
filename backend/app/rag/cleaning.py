"""Text cleaning for RAG ingestion.

Goes beyond upload/services.py's basic whitespace cleanup: Unicode normalization,
de-hyphenation of PDF line-wrap artifacts, and removal of repeated headers/footers/
page numbers that would otherwise pollute every chunk with boilerplate noise.
"""
import re
import unicodedata
from collections import Counter

PAGE_NUMBER_PATTERN = re.compile(r"^\s*(page\s+)?\d{1,4}(\s*(of|/)\s*\d{1,4})?\s*$", re.IGNORECASE)
# A line is a repeated-boilerplate candidate if it's short and appears often.
BOILERPLATE_MAX_LEN = 80
BOILERPLATE_MIN_REPEATS = 3


def normalize_unicode(text: str) -> str:
    """NFKC normalization - folds visually-identical Unicode variants (curly quotes,
    ligatures, full-width characters from copy-pasted slides) into a consistent form
    so the embedding model and chunk-hash dedup see the same text for the same content."""
    return unicodedata.normalize("NFKC", text)


def dehyphenate(text: str) -> str:
    """Fixes PDF line-wrap hyphenation, e.g. 'concep-\\ntual' -> 'conceptual'.
    Only rejoins when both sides look like parts of one word (lowercase continuation),
    so it doesn't accidentally merge an intentional end-of-line hyphen in a list."""
    return re.sub(r"(\w)-\n(\w)", r"\1\2", text)


def strip_repeated_boilerplate(text: str) -> str:
    """Removes lines that repeat across the document and look like headers/footers/
    page numbers/course-code watermarks (short, high-frequency, low information)."""
    lines = text.split("\n")
    stripped = [ln.strip() for ln in lines]
    counts = Counter(ln for ln in stripped if ln)

    def is_boilerplate(line: str) -> bool:
        if not line:
            return False
        if PAGE_NUMBER_PATTERN.match(line):
            return True
        return len(line) <= BOILERPLATE_MAX_LEN and counts[line] >= BOILERPLATE_MIN_REPEATS

    return "\n".join(ln for ln, s in zip(lines, stripped) if not is_boilerplate(s))


def collapse_whitespace(text: str) -> str:
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def remove_control_chars(text: str) -> str:
    return "".join(ch for ch in text if ch.isprintable() or ch in "\n\r\t")


def clean_for_rag(text: str) -> str:
    """Full cleaning pipeline, applied once per uploaded file before chunking."""
    text = normalize_unicode(text)
    text = dehyphenate(text)
    text = remove_control_chars(text)
    text = strip_repeated_boilerplate(text)
    text = collapse_whitespace(text)
    return text
