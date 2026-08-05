"""
One-off fix for: avatar upload failing with
    Supabase storage upload failed with status 400:
    {"statusCode":"415","error":"invalid_mime_type","message":"mime type image/jpeg is not supported"}

The Supabase Storage bucket (SUPABASE_BUCKET) was created with an
`allowed_mime_types` allow-list that only covers course-material document
types (pdf/docx/pptx/txt) - image types used by avatar uploads were never
added. This patches the existing bucket's allow-list via the Storage Admin
API (PUT /storage/v1/bucket/{id}) using the service-role key already
configured in .env, instead of recreating the bucket.

Usage (from backend/):
    python scripts/fix_bucket_mime_types.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
from app.config import settings

# Union of every file type this app ever uploads to Supabase Storage: course
# materials/assignments (existing) + avatar/profile images (newly needed).
ALLOWED_MIME_TYPES = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "text/plain",
    "application/zip",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
]


def main():
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        print("SUPABASE_URL / SUPABASE_KEY are not configured in backend/.env — nothing to do.")
        return

    bucket = settings.SUPABASE_BUCKET
    url = f"{settings.SUPABASE_URL}/storage/v1/bucket/{bucket}"
    headers = {
        "Authorization": f"Bearer {settings.SUPABASE_KEY}",
        "apikey": settings.SUPABASE_KEY,
        "Content-Type": "application/json",
    }

    with httpx.Client() as client:
        get_resp = client.get(url, headers=headers, timeout=30.0)
        if get_resp.status_code != 200:
            print(f"Could not read bucket '{bucket}': {get_resp.status_code} {get_resp.text}")
            return
        current = get_resp.json()
        print(f"Bucket '{bucket}' current allowed_mime_types: {current.get('allowed_mime_types')}")

        patch_resp = client.put(
            url,
            headers=headers,
            json={"id": bucket, "allowed_mime_types": ALLOWED_MIME_TYPES},
            timeout=30.0,
        )

    if patch_resp.status_code not in (200, 201):
        print(f"Failed to update bucket: {patch_resp.status_code} {patch_resp.text}")
        return

    print(f"Bucket '{bucket}' updated. allowed_mime_types now: {ALLOWED_MIME_TYPES}")


if __name__ == "__main__":
    main()
