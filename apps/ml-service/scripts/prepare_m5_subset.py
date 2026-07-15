"""Prepare and audit a chronological, memory-safe M5 pilot subset."""

import argparse
import gzip
import hashlib
import io
import json
import math
import os
import re
import sys
from pathlib import Path
from typing import Any, Iterable

import pandas as pd


SOURCE_URL = (
    "https://zenodo.org/records/12636070/files/"
    "m5-forecasting-accuracy.zip?download=1"
)
DOI = "10.5281/zenodo.12636070"
LICENSE = "CC BY 4.0"
EXPECTED_MD5 = "86f57416a314197f40a17cc6fc60cbb4"
ARCHIVE_NAME = "m5-forecasting-accuracy.zip"
REQUIRED_FILES = (
    "calendar.csv",
    "sell_prices.csv",
    "sales_train_evaluation.csv",
)
SALES_ID_COLUMNS = ("item_id", "store_id", "dept_id", "cat_id", "state_id")
CALENDAR_COLUMNS = (
    "d",
    "date",
    "wm_yr_wk",
    "weekday",
    "event_name_1",
    "event_type_1",
    "event_name_2",
    "event_type_2",
    "snap_CA",
)
OUTPUT_COLUMNS = (
    "item_id",
    "store_id",
    "dept_id",
    "cat_id",
    "state_id",
    "d",
    "date",
    "wm_yr_wk",
    "units_sold",
    "sell_price",
    "weekday",
    "event_name_1",
    "event_type_1",
    "event_name_2",
    "event_type_2",
    "snap_CA",
    "split",
)
DAY_COLUMN_PATTERN = re.compile(r"^d_(\d+)$")
SERVICE_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = SERVICE_ROOT / "data" / "raw"
PROCESSED_DIR = SERVICE_ROOT / "data" / "processed"
REPORTS_DIR = SERVICE_ROOT / "reports"


def _require_columns(
    frame: pd.DataFrame,
    required_columns: Iterable[str],
    source_name: str,
) -> None:
    missing_columns = sorted(set(required_columns) - set(frame.columns))
    if missing_columns:
        raise ValueError(
            f"{source_name} is missing columns: {', '.join(missing_columns)}"
        )


def find_day_columns(columns: Iterable[str]) -> list[str]:
    numbered_columns = []
    for column in columns:
        match = DAY_COLUMN_PATTERN.fullmatch(column)
        if match:
            numbered_columns.append((int(match.group(1)), column))
    return [column for _, column in sorted(numbered_columns)]


def wide_to_long(
    sales: pd.DataFrame,
    day_columns: Iterable[str] | None = None,
) -> pd.DataFrame:
    """Convert selected M5 series from wide daily columns to long rows."""
    selected_day_columns = (
        list(day_columns) if day_columns is not None else find_day_columns(sales.columns)
    )
    _require_columns(sales, SALES_ID_COLUMNS, "sales data")
    _require_columns(sales, selected_day_columns, "sales data")
    if not selected_day_columns:
        raise ValueError("sales data has no d_<number> columns")

    long_sales = sales.melt(
        id_vars=list(SALES_ID_COLUMNS),
        value_vars=selected_day_columns,
        var_name="d",
        value_name="units_sold",
    )
    long_sales["units_sold"] = pd.to_numeric(
        long_sales["units_sold"], errors="raise", downcast="integer"
    )
    return long_sales


def join_calendar_and_prices(
    long_sales: pd.DataFrame,
    calendar: pd.DataFrame,
    sell_prices: pd.DataFrame,
) -> pd.DataFrame:
    """Attach calendar and historical price data without filling missing prices."""
    _require_columns(long_sales, (*SALES_ID_COLUMNS, "d", "units_sold"), "sales data")
    _require_columns(calendar, CALENDAR_COLUMNS, "calendar data")
    _require_columns(
        sell_prices,
        ("store_id", "item_id", "wm_yr_wk", "sell_price"),
        "sell-price data",
    )

    selected_calendar = calendar.loc[:, list(CALENDAR_COLUMNS)].copy()
    selected_calendar["date"] = pd.to_datetime(
        selected_calendar["date"], errors="raise"
    )
    joined = long_sales.merge(
        selected_calendar,
        on="d",
        how="left",
        sort=False,
        validate="many_to_one",
    )
    if joined["date"].isna().any():
        missing_days = sorted(joined.loc[joined["date"].isna(), "d"].unique())
        raise ValueError("calendar data has no rows for: " + ", ".join(missing_days))

    selected_prices = sell_prices.loc[
        :, ["store_id", "item_id", "wm_yr_wk", "sell_price"]
    ]
    joined = joined.merge(
        selected_prices,
        on=["store_id", "item_id", "wm_yr_wk"],
        how="left",
        sort=False,
        validate="many_to_one",
    )
    return sort_dataset(joined)


def sort_dataset(data: pd.DataFrame) -> pd.DataFrame:
    return data.sort_values(
        ["date", "item_id"], kind="mergesort", ignore_index=True
    )


def assign_chronological_splits(
    data: pd.DataFrame,
    validation_days: int = 28,
    test_days: int = 28,
) -> pd.DataFrame:
    """Assign final 28 dates to test and the prior 28 to validation."""
    if validation_days <= 0 or test_days <= 0:
        raise ValueError("validation_days and test_days must be positive")
    result = data.copy()
    result["date"] = pd.to_datetime(result["date"], errors="raise")
    dates = sorted(result["date"].drop_duplicates())
    required_dates = validation_days + test_days + 1
    if len(dates) < required_dates:
        raise ValueError(
            f"at least {required_dates} distinct dates are required for train, "
            "validation, and test splits"
        )

    validation_start = dates[-(validation_days + test_days)]
    test_start = dates[-test_days]
    result["split"] = "train"
    result.loc[result["date"] >= validation_start, "split"] = "validation"
    result.loc[result["date"] >= test_start, "split"] = "test"
    return sort_dataset(result)


def load_selected_sales(
    path: Path,
    store_id: str,
    dept_id: str,
    chunk_size: int,
) -> tuple[pd.DataFrame, set[str]]:
    header = pd.read_csv(path, nrows=0)
    day_columns = find_day_columns(header.columns)
    expected_days = [f"d_{day}" for day in range(1, 1942)]
    if day_columns != expected_days:
        raise ValueError("sales_train_evaluation.csv must contain d_1 through d_1941")
    _require_columns(header, SALES_ID_COLUMNS, path.name)

    selected_chunks: list[pd.DataFrame] = []
    use_columns = [*SALES_ID_COLUMNS, *day_columns]
    for chunk in pd.read_csv(path, usecols=use_columns, chunksize=chunk_size):
        selected = chunk.loc[
            (chunk["store_id"] == store_id) & (chunk["dept_id"] == dept_id),
            use_columns,
        ]
        if not selected.empty:
            selected_chunks.append(wide_to_long(selected, day_columns))

    if not selected_chunks:
        raise ValueError(
            f"no sales series found for store_id={store_id} and dept_id={dept_id}"
        )
    long_sales = pd.concat(selected_chunks, ignore_index=True)
    return long_sales, set(long_sales["item_id"].unique())


def load_selected_prices(
    path: Path,
    store_id: str,
    item_ids: set[str],
    chunk_size: int = 250_000,
) -> pd.DataFrame:
    selected_chunks = []
    columns = ["store_id", "item_id", "wm_yr_wk", "sell_price"]
    for chunk in pd.read_csv(path, usecols=columns, chunksize=chunk_size):
        selected = chunk.loc[
            (chunk["store_id"] == store_id) & chunk["item_id"].isin(item_ids),
            columns,
        ]
        if not selected.empty:
            selected_chunks.append(selected)
    if not selected_chunks:
        raise ValueError(f"no sell-price rows found for store_id={store_id}")
    return pd.concat(selected_chunks, ignore_index=True)


def _native_number(value: Any) -> int | float | None:
    if pd.isna(value):
        return None
    if isinstance(value, int):
        return int(value)
    number = float(value)
    return number if math.isfinite(number) else None


def numeric_summary(series: pd.Series) -> dict[str, int | float | None]:
    summary = series.describe(percentiles=[0.25, 0.5, 0.75])
    return {
        "count": int(summary["count"]),
        "mean": _native_number(summary["mean"]),
        "std": _native_number(summary["std"]),
        "min": _native_number(summary["min"]),
        "25%": _native_number(summary["25%"]),
        "50%": _native_number(summary["50%"]),
        "75%": _native_number(summary["75%"]),
        "max": _native_number(summary["max"]),
    }


def count_duplicate_keys(data: pd.DataFrame) -> int:
    return int(data.duplicated(["item_id", "store_id", "date"]).sum())


def _percentage(count: int, total: int) -> float:
    return round((count / total) * 100.0, 6) if total else 0.0


def build_audit(
    data: pd.DataFrame,
    store_id: str,
    dept_id: str,
    archive_size_bytes: int,
    archive_md5: str,
    raw_file_sizes: dict[str, int],
) -> dict[str, Any]:
    total_rows = len(data)
    split_audit: dict[str, dict[str, Any]] = {}
    for split_name in ("train", "validation", "test"):
        split_rows = data.loc[data["split"] == split_name]
        split_audit[split_name] = {
            "minimum_date": split_rows["date"].min().date().isoformat(),
            "maximum_date": split_rows["date"].max().date().isoformat(),
            "date_count": int(split_rows["date"].nunique()),
            "row_count": int(len(split_rows)),
        }

    missing_price_count = int(data["sell_price"].isna().sum())
    zero_sales_count = int(data["units_sold"].eq(0).sum())
    return {
        "source_url": SOURCE_URL,
        "doi": DOI,
        "license": LICENSE,
        "archive": {
            "filename": ARCHIVE_NAME,
            "size_bytes": int(archive_size_bytes),
            "md5": archive_md5,
        },
        "raw_required_files": {
            filename: {"size_bytes": int(raw_file_sizes[filename])}
            for filename in REQUIRED_FILES
        },
        "selection": {"store_id": store_id, "dept_id": dept_id},
        "total_processed_rows": int(total_rows),
        "unique_item_count": int(data["item_id"].nunique()),
        "minimum_date": data["date"].min().date().isoformat(),
        "maximum_date": data["date"].max().date().isoformat(),
        "chronological_splits": split_audit,
        "missing_sell_price": {
            "count": missing_price_count,
            "percentage": _percentage(missing_price_count, total_rows),
        },
        "zero_sales": {
            "count": zero_sales_count,
            "percentage": _percentage(zero_sales_count, total_rows),
        },
        "numeric_summaries": {
            "units_sold": numeric_summary(data["units_sold"]),
            "sell_price": numeric_summary(data["sell_price"]),
        },
        "duplicate_key_count": count_duplicate_keys(data),
        "real_model_training_status": "No real model has been trained yet.",
    }


def calculate_md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as file_handle:
        for block in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


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


def _output_name(store_id: str, dept_id: str) -> str:
    store_slug = re.sub(r"[^a-z0-9]", "", store_id.lower())
    dept_slug = re.sub(r"[^a-z0-9]", "", dept_id.lower())
    if not store_slug or not dept_slug:
        raise ValueError("store_id and dept_id must contain letters or numbers")
    return f"m5_{store_slug}_{dept_slug}.csv.gz"


def prepare_subset(store_id: str, dept_id: str, chunk_size: int) -> dict[str, Any]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    raw_paths = {filename: RAW_DIR / filename for filename in REQUIRED_FILES}
    archive_path = RAW_DIR / ARCHIVE_NAME
    missing_paths = [
        path.name
        for path in (archive_path, *raw_paths.values())
        if not path.is_file()
    ]
    if missing_paths:
        raise FileNotFoundError(
            "missing M5 files; run download_m5.py first: " + ", ".join(missing_paths)
        )
    actual_md5 = calculate_md5(archive_path)
    if actual_md5 != EXPECTED_MD5:
        raise ValueError(
            f"archive checksum is {actual_md5}, expected {EXPECTED_MD5}"
        )

    long_sales, item_ids = load_selected_sales(
        raw_paths["sales_train_evaluation.csv"],
        store_id,
        dept_id,
        chunk_size,
    )
    calendar = pd.read_csv(raw_paths["calendar.csv"])
    sell_prices = load_selected_prices(
        raw_paths["sell_prices.csv"], store_id, item_ids
    )
    prepared = join_calendar_and_prices(long_sales, calendar, sell_prices)
    prepared = assign_chronological_splits(prepared)
    prepared = prepared.loc[:, list(OUTPUT_COLUMNS)]

    output_path = PROCESSED_DIR / _output_name(store_id, dept_id)
    write_deterministic_gzip_csv(prepared, output_path)

    audit = build_audit(
        prepared,
        store_id,
        dept_id,
        archive_path.stat().st_size,
        actual_md5,
        {filename: path.stat().st_size for filename, path in raw_paths.items()},
    )
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    audit_path = REPORTS_DIR / "m5_audit.json"
    temporary_audit_path = audit_path.with_suffix(".json.tmp")
    try:
        temporary_audit_path.write_text(
            json.dumps(audit, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        os.replace(temporary_audit_path, audit_path)
    finally:
        temporary_audit_path.unlink(missing_ok=True)

    print(f"Subset: store_id={store_id}, dept_id={dept_id}")
    print(
        f"Processed: {len(prepared)} rows, {prepared['item_id'].nunique()} items, "
        f"{prepared['date'].min().date()} to {prepared['date'].max().date()}"
    )
    print(f"Output: {output_path.relative_to(SERVICE_ROOT)}")
    print(f"Audit: {audit_path.relative_to(SERVICE_ROOT)}")
    return audit


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store-id", default="CA_1")
    parser.add_argument("--dept-id", default="FOODS_1")
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=256,
        help="number of wide sales rows to read at a time (default: 256)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        prepare_subset(args.store_id, args.dept_id, args.chunk_size)
    except (OSError, ValueError, pd.errors.ParserError) as exc:
        print(f"M5 preparation failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
