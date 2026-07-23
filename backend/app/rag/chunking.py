"""Token-aware recursive chunking for RAG.

Recursive splitter (paragraph -> sentence -> word, in that order of preference) with
a sliding token window and overlap, following standard RAG chunking practice: target
400-512 tokens per chunk, ~15% overlap, never below ~100 tokens, never above ~900.
Tables are kept intact as their own chunks rather than split across boundaries.
"""
import re
import hashlib
from dataclasses import dataclass, field
from typing import Optional
import tiktoken

_ENCODER = tiktoken.get_encoding("cl100k_base")

TARGET_TOKENS = 450
MIN_TOKENS = 100
MAX_TOKENS = 900
OVERLAP_RATIO = 0.15

_SENTENCE_SPLIT = re.compile(r'(?<=[.!?])\s+(?=[A-Z0-9"\'])')
_PARAGRAPH_SPLIT = re.compile(r"\n\s*\n")


@dataclass
class Chunk:
    text: str
    token_count: int
    section_heading: Optional[str] = None
    source_type: str = "text"  # "text" | "table" | "image_caption"
    page_number: Optional[int] = None
    chunk_hash: str = field(init=False)

    def __post_init__(self):
        # Hash the normalized text (not raw) so trivial whitespace differences don't
        # produce a different hash for otherwise-identical content.
        normalized = " ".join(self.text.split()).lower()
        self.chunk_hash = hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def count_tokens(text: str) -> int:
    return len(_ENCODER.encode(text))


def _split_sentences(paragraph: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(paragraph) if s.strip()]


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in _PARAGRAPH_SPLIT.split(text) if p.strip()]


def _split_words(text: str, max_tokens: int) -> list[str]:
    """Last-resort split for a single sentence/paragraph still over max_tokens
    (e.g. a huge run-on line with no punctuation) - splits on whitespace."""
    words = text.split()
    out, current = [], []
    for w in words:
        current.append(w)
        if count_tokens(" ".join(current)) >= max_tokens:
            out.append(" ".join(current))
            current = []
    if current:
        out.append(" ".join(current))
    return out


def _units_for(text: str) -> list[str]:
    """Recursively breaks text into paragraph-sized units, falling back to sentence
    and then word splitting only where a single paragraph/sentence is too large."""
    units = []
    for para in _split_paragraphs(text):
        if count_tokens(para) <= MAX_TOKENS:
            units.append(para)
            continue
        for sent in _split_sentences(para):
            if count_tokens(sent) <= MAX_TOKENS:
                units.append(sent)
            else:
                units.extend(_split_words(sent, MAX_TOKENS))
    return units


def chunk_document(
    text: str,
    section_heading: Optional[str] = None,
    page_number: Optional[int] = None,
    target_tokens: int = TARGET_TOKENS,
    min_tokens: int = MIN_TOKENS,
    overlap_ratio: float = OVERLAP_RATIO,
) -> list[Chunk]:
    """Sliding-window recursive chunker: packs units (paragraphs, falling back to
    sentences/words for oversized ones) up to target_tokens, then steps back by
    ~overlap_ratio worth of tokens so consecutive chunks share context instead of
    cutting off abruptly mid-thought."""
    units = _units_for(text)
    if not units:
        return []
    unit_tokens = [count_tokens(u) for u in units]

    chunks: list[Chunk] = []
    i = 0
    n = len(units)
    while i < n:
        cur, cur_tokens, j = [], 0, i
        while j < n and cur_tokens + unit_tokens[j] <= target_tokens:
            cur.append(units[j])
            cur_tokens += unit_tokens[j]
            j += 1
        if not cur:  # single unit alone exceeds target (but is <= MAX_TOKENS)
            cur = [units[j]]
            cur_tokens = unit_tokens[j]
            j += 1

        chunk_text = "\n\n".join(cur)
        chunks.append(Chunk(
            text=chunk_text,
            token_count=cur_tokens,
            section_heading=section_heading,
            page_number=page_number,
        ))

        if j >= n:
            break

        overlap_budget = target_tokens * overlap_ratio
        back, acc = j, 0
        while back > i and acc < overlap_budget:
            back -= 1
            acc += unit_tokens[back]
        i = back if back > i else j  # guarantee forward progress

    # Merge a too-small trailing chunk into its predecessor rather than keeping an
    # orphan chunk with too little context to be useful at retrieval time.
    if len(chunks) >= 2 and chunks[-1].token_count < min_tokens:
        merged_text = chunks[-2].text + "\n\n" + chunks[-1].text
        chunks[-2] = Chunk(
            text=merged_text,
            token_count=count_tokens(merged_text),
            section_heading=chunks[-2].section_heading,
            page_number=chunks[-2].page_number,
        )
        chunks.pop()

    return chunks


def chunk_table(markdown_table: str, section_heading: Optional[str] = None) -> Chunk:
    """Tables are never split across chunk boundaries - a fragmented table row is
    useless for retrieval. If a table is pathologically large, it's still kept whole
    (better to slightly exceed the token target than to break a row apart)."""
    return Chunk(
        text=markdown_table,
        token_count=count_tokens(markdown_table),
        section_heading=section_heading,
        source_type="table",
    )
