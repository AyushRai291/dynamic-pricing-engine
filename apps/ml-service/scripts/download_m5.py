"""Download and safely extract the required files from the open M5 mirror."""

import argparse
import hashlib
import os
import shutil
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


SOURCE_URL = (
    "https://zenodo.org/records/12636070/files/"
    "m5-forecasting-accuracy.zip?download=1"
)
EXPECTED_MD5 = "86f57416a314197f40a17cc6fc60cbb4"
ARCHIVE_NAME = "m5-forecasting-accuracy.zip"
REQUIRED_FILES = (
    "calendar.csv",
    "sell_prices.csv",
    "sales_train_evaluation.csv",
)
SERVICE_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = SERVICE_ROOT / "data" / "raw"
ARCHIVE_PATH = RAW_DIR / ARCHIVE_NAME


def calculate_md5(path: Path) -> str:
    """Return an MD5 used only to verify download integrity."""
    digest = hashlib.md5()
    with path.open("rb") as file_handle:
        for block in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download_archive(force: bool = False) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Source: {SOURCE_URL}")

    if ARCHIVE_PATH.exists() and not force:
        actual_md5 = calculate_md5(ARCHIVE_PATH)
        if actual_md5 != EXPECTED_MD5:
            raise RuntimeError(
                f"existing archive checksum is {actual_md5}, expected {EXPECTED_MD5}; "
                "rerun with --force to replace it"
            )
        print(f"Archive: reusing {ARCHIVE_PATH.relative_to(SERVICE_ROOT)}")
        print(f"Checksum: {actual_md5} (verified)")
        return ARCHIVE_PATH

    temporary_path = ARCHIVE_PATH.with_suffix(ARCHIVE_PATH.suffix + ".part")
    request = urllib.request.Request(
        SOURCE_URL,
        headers={"User-Agent": "dynamic-pricing-engine-m5-ingestion/1.0"},
    )
    print("Archive: downloading")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            with temporary_path.open("wb") as destination:
                shutil.copyfileobj(response, destination, length=1024 * 1024)

        actual_md5 = calculate_md5(temporary_path)
        if actual_md5 != EXPECTED_MD5:
            raise RuntimeError(
                f"downloaded archive checksum is {actual_md5}, expected {EXPECTED_MD5}"
            )
        os.replace(temporary_path, ARCHIVE_PATH)
    finally:
        temporary_path.unlink(missing_ok=True)

    print(f"Checksum: {actual_md5} (verified)")
    return ARCHIVE_PATH


def _safe_member_path(member_name: str) -> PurePosixPath:
    normalized_name = member_name.replace("\\", "/")
    member_path = PurePosixPath(normalized_name)
    if (
        member_path.is_absolute()
        or ".." in member_path.parts
        or any(":" in part for part in member_path.parts)
    ):
        raise RuntimeError(f"unsafe ZIP member path: {member_name}")
    return member_path


def extract_required_files(archive_path: Path) -> dict[str, int]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    temporary_paths: dict[str, Path] = {}

    try:
        with zipfile.ZipFile(archive_path) as archive:
            selected_members: dict[str, zipfile.ZipInfo] = {}
            for member in archive.infolist():
                member_path = _safe_member_path(member.filename)
                if member.is_dir() or not member_path.parts:
                    continue
                basename = member_path.name
                if basename not in REQUIRED_FILES:
                    continue
                if basename in selected_members:
                    raise RuntimeError(f"archive contains multiple files named {basename}")
                selected_members[basename] = member

            missing_files = sorted(set(REQUIRED_FILES) - set(selected_members))
            if missing_files:
                raise RuntimeError(
                    "archive is missing required files: " + ", ".join(missing_files)
                )

            for filename in REQUIRED_FILES:
                temporary_path = RAW_DIR / f".{filename}.part"
                temporary_paths[filename] = temporary_path
                with archive.open(selected_members[filename]) as source:
                    with temporary_path.open("wb") as destination:
                        shutil.copyfileobj(source, destination, length=1024 * 1024)

        extracted_sizes: dict[str, int] = {}
        for filename in REQUIRED_FILES:
            destination_path = RAW_DIR / filename
            os.replace(temporary_paths[filename], destination_path)
            extracted_sizes[filename] = destination_path.stat().st_size
            print(
                f"Extracted: {destination_path.relative_to(SERVICE_ROOT)} "
                f"({extracted_sizes[filename]} bytes)"
            )
        return extracted_sizes
    finally:
        for temporary_path in temporary_paths.values():
            temporary_path.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace an existing archive by downloading and verifying it again",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        archive_path = download_archive(force=args.force)
        extract_required_files(archive_path)
    except (OSError, RuntimeError, urllib.error.URLError, zipfile.BadZipFile) as exc:
        print(f"M5 download failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
