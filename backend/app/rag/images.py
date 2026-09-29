"""Image handling for multi-modal RAG: extract embedded images from slides/PDFs,
caption them with a vision model, and embed the *caption text* rather than the image
itself.

Why caption-then-embed instead of true image embeddings (e.g. CLIP)? Two reasons:
1. It keeps everything in ONE embedding space - a text query ("explain the circuit
   diagram on slide 4") retrieves both text passages and image captions through the
   exact same similarity search, no separate image index or cross-modal matching logic.
2. It's dramatically cheaper/simpler for a prototype at this scale - one small vision
   API call per image at ingestion time, versus running and maintaining a second
   embedding model plus a separate retrieval path that then needs to be merged with
   text results.

Kimi K2 is text-only, so captioning cannot ride on settings.KIMI_MODEL - but it can
and does ride on the same OpenRouter account and the same shared client factory
(`app.content_processing.kimi_service._get_client`), just with a vision-capable
model id (settings.VISION_MODEL, default "openai/gpt-4o-mini"). The rejected
alternative was a second, dedicated `OpenAI(api_key=settings.OPENAI_API_KEY)`
client, which is what this module used to do: it meant captioning depended on a
completely separate credential from every other AI call in the project, and when
that key turned out to hold a Google "AIza..." value every single captioning call
401'd. One provider, one factory, one place to change.

Configuration is checked against OPENROUTER_API_KEY using the same
`bool(key) and not key.startswith("your_")` convention as the rest of the codebase.
That check is load-bearing rather than cosmetic: `is_captioning_configured()` is the
gate the ingestion pipeline consults before entering the captioning branch, so a
truthy-but-unusable key made it fire up to MAX_IMAGES_PER_FILE doomed API calls per
uploaded file and swallow each failure individually.

Best-effort throughout: if OpenRouter isn't configured or a captioning call fails,
the image is skipped rather than failing the whole upload.
"""
import base64
import logging
from pathlib import Path
from typing import Optional

from app.config import settings
from app.observability import trace_ai_call

logger = logging.getLogger("conceptintel")

MAX_IMAGES_PER_FILE = 30  # cap - also a basic zip-bomb / cost guard
MIN_IMAGE_BYTES = 3000  # skip tiny images (bullets, icons, logos) - not worth captioning

# Default when the magic bytes match nothing we know. PNG is the safest guess for
# slide/PDF-embedded artwork, and it's also what this module used to hardcode.
_DEFAULT_IMAGE_MIME = "image/png"


def is_captioning_configured() -> bool:
    """True only when OpenRouter is genuinely usable. Deliberately not just
    `bool(key)`: a placeholder value would let the ingestion pipeline enter the
    captioning branch and burn one failed API call per extracted image."""
    key = settings.OPENROUTER_API_KEY
    return bool(key) and not key.startswith("your_")


def _detect_image_mime(image_bytes: bytes) -> str:
    """Sniff the container format from the leading magic bytes.

    PyMuPDF and python-pptx hand back whatever bytes were embedded in the source
    document - overwhelmingly JPEG for photographs and PNG for diagrams - so the
    previous hardcoded "data:image/png;base64," mislabelled a large share of them.
    Some vision providers decode by content and forgive that; others trust the
    declared mime type and reject the payload. Sniffing costs nothing and removes
    the question. Preferred over Pillow/imghdr: no decode, no extra dependency, and
    `imghdr` is deprecated and removed in Python 3.13.
    """
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if image_bytes.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if image_bytes.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if image_bytes[:4] == b"RIFF" and image_bytes[8:12] == b"WEBP":
        return "image/webp"
    return _DEFAULT_IMAGE_MIME


def extract_images_from_pptx(filepath: Path) -> list[bytes]:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    prs = Presentation(filepath)
    images = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                try:
                    blob = shape.image.blob
                    if len(blob) >= MIN_IMAGE_BYTES:
                        images.append(blob)
                except Exception:
                    continue
            if len(images) >= MAX_IMAGES_PER_FILE:
                return images
    return images


def extract_images_from_pdf(filepath: Path) -> list[bytes]:
    import fitz  # PyMuPDF

    images = []
    doc = fitz.open(filepath)
    try:
        for page in doc:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    base_image = doc.extract_image(xref)
                    blob = base_image["image"]
                    if len(blob) >= MIN_IMAGE_BYTES:
                        images.append(blob)
                except Exception:
                    continue
                if len(images) >= MAX_IMAGES_PER_FILE:
                    return images
    finally:
        doc.close()
    return images


def extract_images_from_docx(filepath: Path) -> list[bytes]:
    """DOCX has no per-page/per-slide structure to walk shape-by-shape like pptx/pdf
    above - every embedded picture (inline or floating) is a relationship on the
    document part regardless of where it sits in the text, so that's what this
    walks instead. `rel.reltype` ending in "/image" is the same test python-docx
    itself uses internally to tell an image relationship apart from a hyperlink,
    style, or footer relationship."""
    import docx

    doc = docx.Document(filepath)
    images = []
    for rel in doc.part.rels.values():
        if "image" not in rel.reltype:
            continue
        try:
            blob = rel.target_part.blob
            if len(blob) >= MIN_IMAGE_BYTES:
                images.append(blob)
        except Exception:
            continue
        if len(images) >= MAX_IMAGES_PER_FILE:
            break
    return images


def extract_images(filepath: Path, file_type: str) -> list[bytes]:
    if file_type == "pptx":
        return extract_images_from_pptx(filepath)
    if file_type == "pdf":
        return extract_images_from_pdf(filepath)
    if file_type == "docx":
        return extract_images_from_docx(filepath)
    return []


CAPTION_PROMPT_TEMPLATE = """This image is from a {course_name} lecture slide/document. \
Describe it in 1-3 sentences, focused on the academic concept it illustrates \
(e.g. a diagram, formula, or chart). If it's purely decorative (logo, background), \
say so briefly."""


@trace_ai_call("image-captioning")
def caption_image(image_bytes: bytes, course_name: str) -> Optional[str]:
    """One vision-model call per image. Returns None (not an exception) on any
    failure or missing config - captioning is a nice-to-have, not required for the
    rest of the pipeline to function.

    No retry loop here, unlike kimi_service: a caption is optional enrichment and a
    single upload can produce MAX_IMAGES_PER_FILE of these, so retrying each one
    would triple the worst-case ingestion cost and latency to recover something the
    pipeline is already designed to do without.
    """
    if not is_captioning_configured():
        return None
    try:
        from app.content_processing.kimi_service import _get_client, _reasoning_extra_body
        client = _get_client()
        if client is None:
            # Belt-and-braces: is_captioning_configured() applies the same test, so
            # reaching here means config changed underneath us.
            return None

        b64 = base64.b64encode(image_bytes).decode("utf-8")
        mime = _detect_image_mime(image_bytes)
        response = client.chat.completions.create(
            model=settings.VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": CAPTION_PROMPT_TEMPLATE.format(course_name=course_name)},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                ],
            }],
            temperature=0.2,
            max_tokens=150,
            timeout=60.0,
            extra_body=_reasoning_extra_body(),
        )
        caption = (response.choices[0].message.content or "").strip()
        if not caption:
            logger.warning(
                "Vision model returned empty caption (finish_reason=%s), skipping this image.",
                response.choices[0].finish_reason,
            )
            return None
        return caption
    except Exception as e:
        logger.warning("Image captioning failed, skipping this image: %s", e)
        return None
