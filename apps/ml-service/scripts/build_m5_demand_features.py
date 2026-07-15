"""Build the leakage-safe M5 demand feature dataset and its audit report."""

import argparse
import gzip
import io
import json
import os
import sys
from pathlib import Path

import pandas as pd

SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.demand_features import (
    SPLIT_ORDER,
    build_demand_features,
    build_feature_audit,
    count_duplicate_keys,
    filter_model_ready_rows,
    validate_split_chronology,
)


DEFAULT_INPUT = Path("data/processed/m5_ca1_foods1.csv.gz")
DEFAULT_OUTPUT = Path("data/processed/m5_ca1_foods1_features.csv.gz")
AUDIT_PATH = SERVICE_ROOT / "reports" / "m5_feature_audit.json"


def service_path(path: Path) -> Path:
    return path if path.is_absolute() else SERVICE_ROOT / path


def write_deterministic_gzip_csv(data: pd.DataFrame, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_suffix(output_path.suffix + ".tmp")
    try:
        with temporary_path.open("wb") as raw_file:
            with gzip.GzipFile(
                filename="", mode="wb", fileobj=raw_file, mtime=0
            ) as gzip_file:
                with io.TextIOWrapper(gzip_file, encoding="utf-8", newline="") as text_file:
                    data.to_csv(
                        text_file,
                        index=False,
                        date_format="%Y-%m-%d",
                        lineterminator="\n",
                    )
        os.replace(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def write_audit(audit: dict[str, object]) -> None:
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = AUDIT_PATH.with_suffix(".json.tmp")
    try:
        temporary_path.write_text(
            json.dumps(audit, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        os.replace(temporary_path, AUDIT_PATH)
    finally:
        temporary_path.unlink(missing_ok=True)


def build_feature_dataset(input_path: Path, output_path: Path) -> dict[str, object]:
    if not input_path.is_file():
        raise FileNotFoundError(f"Day 11 input is missing: {input_path}")
    source = pd.read_csv(input_path, parse_dates=["date"], low_memory=False)
    featured = build_demand_features(source)
    final_data = filter_model_ready_rows(featured)
    if count_duplicate_keys(final_data):
        raise ValueError("final feature data contains duplicate item/store/date keys")
    validate_split_chronology(final_data)

    audit = build_feature_audit(
        featured,
        final_data,
        input_path.name,
        output_path.name,
    )
    if audit["final_row_count"] != len(final_data):
        raise ValueError("feature audit row count does not match final data")

    write_deterministic_gzip_csv(final_data, output_path)
    write_audit(audit)

    removed = audit["removed_rows"]
    print(f"Input: {input_path.name} ({len(source)} rows)")
    print(
        f"Final: {len(final_data)} rows; removed "
        f"{removed['total_unique_rows_removed']} unique rows"
    )
    print(
        "Splits: "
        + ", ".join(
            f"{split_name}={audit['chronological_splits'][split_name]['row_count']}"
            for split_name in SPLIT_ORDER
        )
    )
    print(f"Output: {output_path.relative_to(SERVICE_ROOT)}")
    print(f"Audit: {AUDIT_PATH.relative_to(SERVICE_ROOT)}")
    return audit


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = service_path(args.input)
    output_path = service_path(args.output)
    try:
        build_feature_dataset(input_path, output_path)
    except (OSError, ValueError, pd.errors.ParserError) as exc:
        print(f"M5 demand feature build failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
