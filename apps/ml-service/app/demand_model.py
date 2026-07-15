"""Preprocessing, prediction, and evaluation helpers for the M5 demand model."""

import json
import math
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBRegressor


NUMERIC_FEATURES = (
    "sell_price",
    "sales_lag_1",
    "sales_lag_7",
    "sales_lag_28",
    "sales_rolling_mean_7",
    "sales_rolling_mean_28",
    "sales_rolling_std_28",
    "demand_trend_7_28",
    "price_lag_7",
    "price_change_ratio_7",
    "historical_price_mean_28",
    "price_vs_history_ratio",
    "day_of_week",
    "month",
    "week_of_year",
    "is_weekend",
    "has_event",
    "snap_active",
)
CATEGORICAL_FEATURES = (
    "item_id",
    "store_id",
    "dept_id",
    "cat_id",
    "state_id",
    "event_name_1",
    "event_type_1",
)
MODEL_FEATURE_COLUMNS = (*NUMERIC_FEATURES, *CATEGORICAL_FEATURES)
EXCLUDED_MODEL_COLUMNS = ("units_sold", "date", "d", "split")

SERVICE_ROOT = Path(__file__).resolve().parent.parent
DEMAND_MODEL_PATH = SERVICE_ROOT / "models" / "m5_demand_xgb.json"
DEMAND_PREPROCESSOR_PATH = (
    SERVICE_ROOT / "models" / "m5_demand_preprocessor.joblib"
)
DEMAND_METADATA_PATH = SERVICE_ROOT / "models" / "m5_demand_metadata.json"


def validate_feature_frame(frame: pd.DataFrame) -> pd.DataFrame:
    """Select canonical features, allowing numeric NaN but rejecting infinities."""
    missing_features = sorted(set(MODEL_FEATURE_COLUMNS) - set(frame.columns))
    if missing_features:
        raise ValueError(
            "demand feature frame is missing required features: "
            + ", ".join(missing_features)
        )

    validated = frame.loc[:, list(MODEL_FEATURE_COLUMNS)].copy()
    for column in NUMERIC_FEATURES:
        validated[column] = pd.to_numeric(validated[column], errors="raise").astype(
            "float32"
        )
    numeric_values = validated.loc[:, list(NUMERIC_FEATURES)].to_numpy()
    if np.isinf(numeric_values).any():
        raise ValueError("demand feature frame contains infinite numeric values")

    missing_categorical = validated.loc[:, list(CATEGORICAL_FEATURES)].isna()
    if missing_categorical.any().any():
        columns = missing_categorical.columns[missing_categorical.any()].tolist()
        raise ValueError(
            "demand feature frame contains missing categorical values: "
            + ", ".join(columns)
        )
    for column in CATEGORICAL_FEATURES:
        validated[column] = validated[column].astype(str)
    return validated


def create_preprocessor() -> ColumnTransformer:
    """Create an unfitted train-only numeric/categorical preprocessor."""
    return ColumnTransformer(
        transformers=[
            ("numeric", "passthrough", list(NUMERIC_FEATURES)),
            (
                "categorical",
                OneHotEncoder(
                    handle_unknown="ignore",
                    sparse_output=True,
                    dtype=np.float32,
                ),
                list(CATEGORICAL_FEATURES),
            ),
        ],
        remainder="drop",
        sparse_threshold=1.0,
    )


def predict_non_negative_demand(
    model: Any,
    preprocessor: Any,
    feature_frame: pd.DataFrame,
) -> np.ndarray:
    """Transform canonical features and return finite predictions clipped at zero."""
    validated = validate_feature_frame(feature_frame)
    transformed = preprocessor.transform(validated)
    predictions = np.asarray(model.predict(transformed), dtype=np.float64).reshape(-1)
    if len(predictions) != len(feature_frame):
        raise ValueError("demand model returned an unexpected prediction count")
    if not np.isfinite(predictions).all():
        raise ValueError("demand model returned non-finite predictions")
    return np.maximum(predictions, 0.0)


def _safe_candidate_ratio(numerator: float, denominator: Any) -> float:
    if pd.isna(denominator):
        return math.nan
    numeric_denominator = float(denominator)
    if not math.isfinite(numeric_denominator) or numeric_denominator == 0.0:
        return math.nan
    return numerator / numeric_denominator


def update_candidate_price(row: pd.Series, candidate_price: float) -> pd.Series:
    """Update current-price features without changing historical price inputs."""
    numeric_price = float(candidate_price)
    if not math.isfinite(numeric_price) or numeric_price <= 0.0:
        raise ValueError("candidate_price must be a positive finite number")

    updated = row.copy(deep=True)
    updated["sell_price"] = numeric_price
    price_lag_7 = updated.get("price_lag_7")
    historical_mean = updated.get("historical_price_mean_28")
    updated["price_change_ratio_7"] = _safe_candidate_ratio(
        numeric_price - float(price_lag_7) if not pd.isna(price_lag_7) else math.nan,
        price_lag_7,
    )
    updated["price_vs_history_ratio"] = _safe_candidate_ratio(
        numeric_price,
        historical_mean,
    )
    return updated


def calculate_demand_metrics(
    actual: Any,
    predicted: Any,
) -> dict[str, float | None]:
    """Calculate zero-aware regression metrics; WAPE is a ratio, not a percent."""
    actual_values = np.asarray(actual, dtype=np.float64).reshape(-1)
    predicted_values = np.asarray(predicted, dtype=np.float64).reshape(-1)
    if actual_values.size == 0 or actual_values.shape != predicted_values.shape:
        raise ValueError("actual and predicted demand must be non-empty and aligned")
    if not np.isfinite(actual_values).all() or not np.isfinite(predicted_values).all():
        raise ValueError("actual and predicted demand must be finite")
    if (actual_values < 0).any() or (predicted_values < 0).any():
        raise ValueError("actual and predicted demand must be non-negative")

    wape_denominator = float(actual_values.sum())
    if wape_denominator <= 0.0:
        raise ValueError("WAPE is undefined when total actual demand is zero")

    absolute_errors = np.abs(predicted_values - actual_values)
    zero_mask = actual_values == 0.0
    positive_mask = actual_values > 0.0
    return {
        "mae": float(mean_absolute_error(actual_values, predicted_values)),
        "rmse": float(mean_squared_error(actual_values, predicted_values) ** 0.5),
        "r2": float(r2_score(actual_values, predicted_values)),
        "wape": float(absolute_errors.sum() / wape_denominator),
        "mean_bias": float(np.mean(predicted_values - actual_values)),
        "actual_mean": float(actual_values.mean()),
        "predicted_mean": float(predicted_values.mean()),
        "prediction_minimum": float(predicted_values.min()),
        "prediction_maximum": float(predicted_values.max()),
        "actual_zero_percentage": float(zero_mask.mean() * 100.0),
        "mae_actual_zero": (
            float(absolute_errors[zero_mask].mean()) if zero_mask.any() else None
        ),
        "mae_actual_positive": (
            float(absolute_errors[positive_mask].mean()) if positive_mask.any() else None
        ),
    }


def load_demand_artifacts(
    model_path: Path = DEMAND_MODEL_PATH,
    preprocessor_path: Path = DEMAND_PREPROCESSOR_PATH,
    metadata_path: Path = DEMAND_METADATA_PATH,
) -> tuple[XGBRegressor, ColumnTransformer, dict[str, Any]]:
    """Load and validate the separately versioned real-demand artifacts."""
    for label, path in (
        ("demand model", model_path),
        ("demand preprocessor", preprocessor_path),
        ("demand metadata", metadata_path),
    ):
        if not path.is_file():
            raise RuntimeError(f"{label} artifact is missing: {path}")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("demand metadata artifact is invalid") from exc
    if metadata.get("numeric_features") != list(NUMERIC_FEATURES):
        raise RuntimeError("demand metadata numeric feature order is invalid")
    if metadata.get("categorical_features") != list(CATEGORICAL_FEATURES):
        raise RuntimeError("demand metadata categorical feature order is invalid")
    if metadata.get("model_source") != "real_m5_historical_data":
        raise RuntimeError("demand metadata model source is invalid")

    try:
        preprocessor = joblib.load(preprocessor_path)
    except Exception as exc:
        raise RuntimeError("demand preprocessor artifact is invalid") from exc
    if not isinstance(preprocessor, ColumnTransformer):
        raise RuntimeError("demand preprocessor artifact has an invalid type")
    try:
        transformed_feature_count = len(preprocessor.get_feature_names_out())
    except Exception as exc:
        raise RuntimeError("demand preprocessor artifact is not fitted") from exc

    model = XGBRegressor()
    try:
        model.load_model(model_path)
    except Exception as exc:
        raise RuntimeError("demand model artifact is invalid") from exc
    if model.get_booster().num_features() != transformed_feature_count:
        raise RuntimeError("demand model and preprocessor feature counts differ")
    return model, preprocessor, metadata
