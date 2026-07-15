"""Leakage-safe demand features for the chronological M5 pilot dataset."""

import math
from typing import Any, Iterable

import pandas as pd


SERIES_KEY_COLUMNS = ("item_id", "store_id")
IDENTIFIER_COLUMNS = ("item_id", "store_id", "dept_id", "cat_id", "state_id")
TARGET_COLUMN = "units_sold"
NEUTRAL_EVENT_CATEGORY = "No event"
SPLIT_ORDER = ("train", "validation", "test")

DEMAND_HISTORY_FEATURES = (
    "sales_lag_1",
    "sales_lag_7",
    "sales_lag_28",
    "sales_rolling_mean_7",
    "sales_rolling_mean_28",
    "sales_rolling_std_28",
    "demand_trend_7_28",
)
PRICE_HISTORY_FEATURES = (
    "price_lag_7",
    "price_change_ratio_7",
    "historical_price_mean_28",
    "price_vs_history_ratio",
)
CALENDAR_FEATURES = (
    "day_of_week",
    "month",
    "week_of_year",
    "is_weekend",
    "has_event",
    "snap_active",
)
MODEL_FEATURE_COLUMNS = (
    *IDENTIFIER_COLUMNS,
    "sell_price",
    "event_name_1",
    "event_type_1",
    *DEMAND_HISTORY_FEATURES,
    *PRICE_HISTORY_FEATURES,
    *CALENDAR_FEATURES,
)
OUTPUT_COLUMNS = (
    "date",
    "d",
    "split",
    *MODEL_FEATURE_COLUMNS,
    TARGET_COLUMN,
)
REQUIRED_INPUT_COLUMNS = (
    *IDENTIFIER_COLUMNS,
    "date",
    "d",
    "split",
    "sell_price",
    TARGET_COLUMN,
    "snap_CA",
)

FEATURE_DEFINITIONS = {
    "sales_lag_1": "units_sold from 1 prior row in the item/store series",
    "sales_lag_7": "units_sold from 7 prior rows in the item/store series",
    "sales_lag_28": "units_sold from 28 prior rows in the item/store series",
    "sales_rolling_mean_7": "mean units_sold over the prior 7 rows after shift(1)",
    "sales_rolling_mean_28": "mean units_sold over the prior 28 rows after shift(1)",
    "sales_rolling_std_28": (
        "sample standard deviation of units_sold over the prior 28 rows after shift(1)"
    ),
    "demand_trend_7_28": (
        "(sales_rolling_mean_7 - sales_rolling_mean_28) / "
        "(sales_rolling_mean_28 + 1)"
    ),
    "price_lag_7": "sell_price from 7 prior rows in the item/store series",
    "price_change_ratio_7": "(sell_price - price_lag_7) / price_lag_7",
    "historical_price_mean_28": (
        "mean available sell_price over the prior 28 rows after shift(1); "
        "missing prices remain missing and are not backfilled"
    ),
    "price_vs_history_ratio": "sell_price / historical_price_mean_28",
    "day_of_week": "date weekday number where Monday=0 and Sunday=6",
    "month": "calendar month number from date",
    "week_of_year": "ISO calendar week number from date",
    "is_weekend": "1 when day_of_week is Saturday or Sunday, otherwise 0",
    "has_event": "1 when event_name_1 is present, otherwise 0",
    "snap_active": "current California SNAP indicator copied from snap_CA",
}


def _require_columns(
    data: pd.DataFrame,
    required_columns: Iterable[str],
    source_name: str,
) -> None:
    missing_columns = sorted(set(required_columns) - set(data.columns))
    if missing_columns:
        raise ValueError(
            f"{source_name} is missing columns: {', '.join(missing_columns)}"
        )


def count_duplicate_keys(data: pd.DataFrame) -> int:
    return int(data.duplicated(["item_id", "store_id", "date"]).sum())


def sort_demand_rows(data: pd.DataFrame) -> pd.DataFrame:
    return data.sort_values(
        ["date", "item_id"], kind="mergesort", ignore_index=True
    )


def safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    """Divide where both inputs exist and the denominator is nonzero; else NaN."""
    numeric_numerator = pd.to_numeric(numerator, errors="coerce")
    numeric_denominator = pd.to_numeric(denominator, errors="coerce")
    valid = (
        numeric_numerator.notna()
        & numeric_denominator.notna()
        & numeric_denominator.ne(0)
    )
    return numeric_numerator.div(numeric_denominator).where(valid)


def _normalize_event_context(data: pd.DataFrame) -> None:
    if "event_name_1" in data:
        event_names = data["event_name_1"].astype("string").str.strip()
        has_event = event_names.notna() & event_names.ne("")
        data["event_name_1"] = event_names.where(
            has_event, NEUTRAL_EVENT_CATEGORY
        )
        data["has_event"] = has_event.astype("int8")
    else:
        data["event_name_1"] = NEUTRAL_EVENT_CATEGORY
        data["has_event"] = 0

    if "event_type_1" in data:
        event_types = data["event_type_1"].astype("string").str.strip()
        data["event_type_1"] = event_types.where(
            event_types.notna() & event_types.ne(""), NEUTRAL_EVENT_CATEGORY
        )
    else:
        data["event_type_1"] = NEUTRAL_EVENT_CATEGORY


def build_demand_features(source: pd.DataFrame) -> pd.DataFrame:
    """Calculate features using current context and strictly prior series rows."""
    _require_columns(source, REQUIRED_INPUT_COLUMNS, "demand source data")
    data = source.copy()
    data["date"] = pd.to_datetime(data["date"], errors="raise")
    data[TARGET_COLUMN] = pd.to_numeric(data[TARGET_COLUMN], errors="raise")
    data["sell_price"] = pd.to_numeric(data["sell_price"], errors="coerce")
    if data[TARGET_COLUMN].isna().any():
        raise ValueError("units_sold target contains missing values")

    data = data.sort_values(
        [*SERIES_KEY_COLUMNS, "date"], kind="mergesort", ignore_index=True
    )
    duplicate_count = count_duplicate_keys(data)
    if duplicate_count:
        raise ValueError(f"source data contains {duplicate_count} duplicate keys")

    grouped = data.groupby(list(SERIES_KEY_COLUMNS), sort=False)
    data["sales_lag_1"] = grouped[TARGET_COLUMN].shift(1)
    data["sales_lag_7"] = grouped[TARGET_COLUMN].shift(7)
    data["sales_lag_28"] = grouped[TARGET_COLUMN].shift(28)
    data["sales_rolling_mean_7"] = grouped[TARGET_COLUMN].transform(
        lambda values: values.shift(1).rolling(7, min_periods=7).mean()
    )
    data["sales_rolling_mean_28"] = grouped[TARGET_COLUMN].transform(
        lambda values: values.shift(1).rolling(28, min_periods=28).mean()
    )
    data["sales_rolling_std_28"] = grouped[TARGET_COLUMN].transform(
        lambda values: values.shift(1).rolling(28, min_periods=28).std()
    )
    data["demand_trend_7_28"] = safe_divide(
        data["sales_rolling_mean_7"] - data["sales_rolling_mean_28"],
        data["sales_rolling_mean_28"] + 1.0,
    )

    data["price_lag_7"] = grouped["sell_price"].shift(7)
    data["price_change_ratio_7"] = safe_divide(
        data["sell_price"] - data["price_lag_7"], data["price_lag_7"]
    )
    data["historical_price_mean_28"] = grouped["sell_price"].transform(
        lambda values: values.shift(1).rolling(28, min_periods=1).mean()
    )
    data["price_vs_history_ratio"] = safe_divide(
        data["sell_price"], data["historical_price_mean_28"]
    )

    data["day_of_week"] = data["date"].dt.dayofweek.astype("int8")
    data["month"] = data["date"].dt.month.astype("int8")
    data["week_of_year"] = data["date"].dt.isocalendar().week.astype("int16")
    data["is_weekend"] = data["day_of_week"].ge(5).astype("int8")
    _normalize_event_context(data)
    data["snap_active"] = pd.to_numeric(data["snap_CA"], errors="raise").astype(
        "int8"
    )
    return sort_demand_rows(data)


def filter_masks(featured: pd.DataFrame) -> dict[str, pd.Series]:
    _require_columns(
        featured,
        ("sell_price", *DEMAND_HISTORY_FEATURES),
        "featured demand data",
    )
    return {
        "missing_current_sell_price": featured["sell_price"].isna(),
        "incomplete_28_day_demand_history": featured.loc[
            :, list(DEMAND_HISTORY_FEATURES)
        ].isna().any(axis=1),
    }


def filter_model_ready_rows(featured: pd.DataFrame) -> pd.DataFrame:
    """Remove price-missing and demand-warm-up rows, retaining zero targets."""
    masks = filter_masks(featured)
    eligible = ~(
        masks["missing_current_sell_price"]
        | masks["incomplete_28_day_demand_history"]
    )
    result = featured.loc[eligible, list(OUTPUT_COLUMNS)].copy()
    return sort_demand_rows(result)


def validate_split_chronology(data: pd.DataFrame) -> None:
    unknown_splits = sorted(set(data["split"].unique()) - set(SPLIT_ORDER))
    if unknown_splits:
        raise ValueError("unknown split labels: " + ", ".join(unknown_splits))
    for split_name in SPLIT_ORDER:
        if not data["split"].eq(split_name).any():
            raise ValueError(f"split has no rows after filtering: {split_name}")
    for earlier, later in zip(SPLIT_ORDER, SPLIT_ORDER[1:]):
        earlier_max = data.loc[data["split"] == earlier, "date"].max()
        later_min = data.loc[data["split"] == later, "date"].min()
        if earlier_max >= later_min:
            raise ValueError(f"split dates overlap or are out of order: {earlier}/{later}")


def _percentage(count: int, total: int) -> float:
    return round((count / total) * 100.0, 6) if total else 0.0


def _native_number(value: Any) -> int | float | None:
    if pd.isna(value):
        return None
    if isinstance(value, int):
        return int(value)
    number = float(value)
    return number if math.isfinite(number) else None


def build_feature_audit(
    featured: pd.DataFrame,
    final_data: pd.DataFrame,
    source_dataset_name: str,
    output_dataset_name: str,
) -> dict[str, Any]:
    masks = filter_masks(featured)
    missing_price = masks["missing_current_sell_price"]
    incomplete_history = masks["incomplete_28_day_demand_history"]
    overlap = missing_price & incomplete_history
    removed_union = missing_price | incomplete_history
    split_audit: dict[str, dict[str, Any]] = {}
    for split_name in SPLIT_ORDER:
        split_rows = final_data.loc[final_data["split"] == split_name]
        split_audit[split_name] = {
            "minimum_date": split_rows["date"].min().date().isoformat(),
            "maximum_date": split_rows["date"].max().date().isoformat(),
            "date_count": int(split_rows["date"].nunique()),
            "row_count": int(len(split_rows)),
        }

    target = final_data[TARGET_COLUMN]
    zero_target_count = int(target.eq(0).sum())
    return {
        "source_dataset": source_dataset_name,
        "output_dataset": output_dataset_name,
        "target": TARGET_COLUMN,
        "feature_columns": list(MODEL_FEATURE_COLUMNS),
        "feature_definitions": FEATURE_DEFINITIONS,
        "input_row_count": int(len(featured)),
        "final_row_count": int(len(final_data)),
        "pre_filter_counts": {
            "missing_sell_price": int(missing_price.sum()),
            "missing_sell_price_and_positive_units_sold": int(
                (missing_price & featured[TARGET_COLUMN].gt(0)).sum()
            ),
            "zero_units_sold": int(featured[TARGET_COLUMN].eq(0).sum()),
            "incomplete_28_day_demand_history": int(incomplete_history.sum()),
        },
        "removed_rows": {
            "missing_current_sell_price": int(missing_price.sum()),
            "incomplete_28_day_demand_history": int(incomplete_history.sum()),
            "overlap_between_reasons": int(overlap.sum()),
            "total_unique_rows_removed": int(removed_union.sum()),
            "exclusive_breakdown": {
                "missing_price_only": int((missing_price & ~incomplete_history).sum()),
                "incomplete_history_only": int(
                    (incomplete_history & ~missing_price).sum()
                ),
                "both_reasons": int(overlap.sum()),
            },
        },
        "missing_price_positive_sales_count": int(
            (missing_price & featured[TARGET_COLUMN].gt(0)).sum()
        ),
        "chronological_splits": split_audit,
        "target_summary": {
            "mean": _native_number(target.mean()),
            "standard_deviation": _native_number(target.std()),
            "minimum": _native_number(target.min()),
            "maximum": _native_number(target.max()),
        },
        "zero_target": {
            "count": zero_target_count,
            "percentage": _percentage(zero_target_count, len(final_data)),
        },
        "duplicate_key_count": count_duplicate_keys(final_data),
        "null_count_by_feature": {
            column: int(final_data[column].isna().sum())
            for column in MODEL_FEATURE_COLUMNS
        },
        "leakage_controls": [
            "Rows are grouped by item_id and store_id and ordered by date.",
            "All demand lags use shift and all rolling demand windows start with shift(1).",
            "Rolling windows are trailing only and never centered.",
            "Price lag and rolling price history use past rows only; prices are never backfilled.",
            "Features are calculated over each full chronological series before eligibility filtering.",
            "Existing train, validation, and test labels are preserved; no random split is used.",
            "Current sell_price is allowed as known candidate-price context; units_sold is target only.",
        ],
        "model_training_status": "No model was trained on Day 12.",
    }
