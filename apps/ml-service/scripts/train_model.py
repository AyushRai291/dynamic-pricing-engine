"""Train the bootstrap model on synthetic rule-based pricing scenarios only."""

import json
import random
from typing import Any

import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor

from app.bootstrap import bootstrap_price_score
from app.features import build_pricing_features
from app.model import FEATURE_NAMES, METADATA_PATH, MODEL_PATH, ordered_feature_values
from app.schemas import PricingContext


SEED = 42
SAMPLE_COUNT = 4_500
MODEL_VERSION = "bootstrap-xgb-v1"
MODEL_SOURCE = "synthetic_rule_based"
MODEL_PARAMETERS: dict[str, Any] = {
    "objective": "reg:squarederror",
    "n_estimators": 160,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "random_state": SEED,
    "n_jobs": 1,
}
METRICS_WARNING = (
    "Synthetic-only metrics show how well the model learns the bootstrap rule-based "
    "policy; they are not real-world business performance."
)


def generate_bootstrap_dataset(
    sample_count: int = SAMPLE_COUNT,
    seed: int = SEED,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate valid raw synthetic contexts, then use the production feature builder."""
    random_generator = random.Random(seed)
    rows: list[tuple[float, ...]] = []
    targets: list[float] = []

    for _ in range(sample_count):
        current_price = random_generator.uniform(20.0, 500.0)
        min_price = current_price * (1.0 - random_generator.uniform(0.0, 0.35))
        max_price = current_price * (1.0 + random_generator.uniform(0.0, 0.45))
        cost_price = min_price * random_generator.uniform(0.45, 1.0)
        competitor_count = random_generator.randint(0, 5)
        competitors = [
            {
                "price": current_price * random_generator.uniform(0.70, 1.30),
                "is_available": random_generator.random() < 0.75,
            }
            for _ in range(competitor_count)
        ]
        context = PricingContext(
            current_price=current_price,
            cost_price=cost_price,
            min_price=min_price,
            max_price=max_price,
            inventory_count=random_generator.randint(0, 500),
            competitors=competitors,
        )
        features = build_pricing_features(context)
        rows.append(ordered_feature_values(features))
        targets.append(bootstrap_price_score(features))

    return (
        np.asarray(rows, dtype=np.float32),
        np.asarray(targets, dtype=np.float32),
    )


def train_model() -> dict[str, Any]:
    features, targets = generate_bootstrap_dataset()
    train_features, test_features, train_targets, test_targets = train_test_split(
        features,
        targets,
        test_size=0.20,
        random_state=SEED,
    )

    model = XGBRegressor(**MODEL_PARAMETERS)
    model.fit(train_features, train_targets)
    predictions = model.predict(test_features)
    metrics = {
        "mae": float(mean_absolute_error(test_targets, predictions)),
        "rmse": float(mean_squared_error(test_targets, predictions) ** 0.5),
        "r2": float(r2_score(test_targets, predictions)),
    }

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model.save_model(MODEL_PATH)
    metadata = {
        "model_version": MODEL_VERSION,
        "model_source": MODEL_SOURCE,
        "training_data": "bootstrap synthetic rule-based training data",
        "seed": SEED,
        "sample_count": SAMPLE_COUNT,
        "feature_names": list(FEATURE_NAMES),
        "action_thresholds": {
            "decrease": "score < 40",
            "hold": "40 <= score <= 60",
            "increase": "score > 60",
        },
        "model_parameters": MODEL_PARAMETERS,
        "synthetic_test_metrics": metrics,
        "warning": METRICS_WARNING,
    }
    METADATA_PATH.write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    return metadata


def main() -> None:
    metadata = train_model()
    metrics = metadata["synthetic_test_metrics"]
    print(
        f"Trained {metadata['model_version']} on {metadata['sample_count']} "
        "bootstrap synthetic scenarios; "
        f"MAE={metrics['mae']:.6f}, RMSE={metrics['rmse']:.6f}, "
        f"R2={metrics['r2']:.6f}"
    )
    print(metadata["warning"])


if __name__ == "__main__":
    main()
