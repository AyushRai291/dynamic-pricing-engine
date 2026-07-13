import json
import math
from pathlib import Path
from typing import Any

import numpy as np
from xgboost import XGBRegressor

from app.schemas import PredictionResponse, PriceAction, PricingFeatures


FEATURE_NAMES = (
    "price_gap_ratio",
    "gross_margin_ratio",
    "markdown_headroom_ratio",
    "markup_headroom_ratio",
    "price_position_ratio",
    "inventory_count",
    "competitor_count",
    "available_competitor_count",
    "competitor_available_ratio",
    "competitor_price_spread_ratio",
    "has_competitor_data",
)

SERVICE_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = SERVICE_ROOT / "models" / "price_score_xgb.json"
METADATA_PATH = SERVICE_ROOT / "models" / "metadata.json"


def ordered_feature_values(features: PricingFeatures) -> tuple[float, ...]:
    return tuple(float(getattr(features, name)) for name in FEATURE_NAMES)


def score_to_action(score: float) -> PriceAction:
    if score < 40.0:
        return "decrease"
    if score <= 60.0:
        return "hold"
    return "increase"


def clamp_price_score(score: float) -> float:
    if not math.isfinite(score):
        raise ValueError("model returned a non-finite price score")
    return min(max(score, 0.0), 100.0)


def load_model_artifacts(
    model_path: Path = MODEL_PATH,
    metadata_path: Path = METADATA_PATH,
) -> tuple[XGBRegressor, dict[str, Any]]:
    if not model_path.is_file():
        raise RuntimeError(f"price-score model artifact is missing: {model_path}")
    if not metadata_path.is_file():
        raise RuntimeError(f"price-score metadata is missing: {metadata_path}")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("price-score metadata is invalid") from exc

    if metadata.get("feature_names") != list(FEATURE_NAMES):
        raise RuntimeError("price-score metadata feature order is invalid")
    if metadata.get("model_source") != "synthetic_rule_based":
        raise RuntimeError("price-score metadata model source is invalid")
    if not isinstance(metadata.get("model_version"), str):
        raise RuntimeError("price-score metadata model version is invalid")

    model = XGBRegressor()
    try:
        model.load_model(model_path)
    except Exception as exc:
        raise RuntimeError("price-score model artifact is invalid") from exc
    if model.get_booster().num_features() != len(FEATURE_NAMES):
        raise RuntimeError("price-score model feature count is invalid")

    return model, metadata


def predict_price_score(
    model: XGBRegressor,
    metadata: dict[str, Any],
    features: PricingFeatures,
) -> PredictionResponse:
    feature_matrix = np.asarray(
        [ordered_feature_values(features)],
        dtype=np.float32,
    )
    raw_score = float(model.predict(feature_matrix)[0])
    price_score = clamp_price_score(raw_score)
    return PredictionResponse(
        price_score=price_score,
        action=score_to_action(price_score),
        model_version=metadata["model_version"],
        model_source=metadata["model_source"],
        features=features,
    )
