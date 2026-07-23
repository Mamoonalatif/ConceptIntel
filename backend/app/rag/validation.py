"""File-content validation for uploads.

The extension/size checks in upload/routes.py trust the filename - trivial to spoof
(rename anything to "notes.pdf"). This sniffs the actual file *content* (magic bytes)
via libmagic and rejects a mismatch, closing that gap. DOCX/PPTX are OOXML (ZIP
containers), so libmagic sometimes reports them as generic "application/zip" rather
than the specific OOXML MIME type - the allowlist below accounts for that rather
than producing false-positive rejections on legitimate files.
"""
import magic

_ALLOWED_MIME_SUBSTRINGS: dict[str, tuple[str, ...]] = {
    ".pdf": ("application/pdf",),
    ".docx": ("officedocument.wordprocessingml", "application/zip", "application/x-zip"),
    ".pptx": ("officedocument.presentationml", "application/zip", "application/x-zip"),
    ".ppt": ("application/vnd.ms-powerpoint", "application/x-ole-storage", "composite document"),
    ".txt": ("text/plain", "text/"),
}


def sniff_mime(content: bytes) -> str:
    return magic.from_buffer(content, mime=True)


def validate_file_content(content: bytes, extension: str) -> None:
    """Raises ValueError if the sniffed content type doesn't plausibly match the
    claimed extension. Unknown extensions are rejected upstream already (see
    SUPPORTED_EXTENSIONS in upload/routes.py) so this only needs to handle the
    supported set."""
    allowed = _ALLOWED_MIME_SUBSTRINGS.get(extension.lower())
    if allowed is None:
        return  # extension not in our known set - the caller already rejects this
    detected = sniff_mime(content[:4096])
    if not any(sub in detected for sub in allowed):
        raise ValueError(
            f"File content ({detected}) doesn't match its {extension} extension. "
            "The file may be corrupted or mislabeled."
        )
