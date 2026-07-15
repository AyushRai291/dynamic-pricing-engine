"""Train and evaluate the real M5 demand model without touching API behavior."""

import json
import os
import platform
import sys
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import sklearn
import xgboost
from xgboost import XGBRegressor

SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from app.demand_model import (  # noqa: E402
    CATEGORICAL_FEATURES,
    DEMAND_METADATA_PATH,
    DEMAND_MODEL_PATH,
    DEMAND_PREPROCESSOR_PATH,
    EXCLUDED_MODEL_COLUMNS,
    MODEL_FEATURE_COLUMNS,
    NUMERIC_FEATURES,
    calculate_demand_metrics,
    create_preprocessor,
    load_demand_artifacts,
    predict_non_negative_demand,
    validate_feature_frame,
)


DATASET_PATH = SERVICE_ROOT / "data" / "processed" / "m5_ca1_foods1_features.csv.gz"
TARGET = "units_sold"
MODEL_VERSION = "m5-demand-xgb-v1"
MODEL_PARAMETERS: dict[str, Any] = {
    "objective": "count:poisson",
    "tree_method": "hist",
    "n_estimators": 500,
    "learning_rate": 0.05,
    "max_depth": 6,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "random_state": 42,
    "n_jobs": 1,
    "eval_metric": "mae",
    "early_stopping_rounds": 40,
    "verbosity": 0,
}
SPLITS = ("train", "validation", "test")


def validate_training_data(data: pd.DataFrame) -> pd.DataFrame:
    required_columns = {
        *MODEL_FEATURE_COLUMNS,
        *EXCLUDED_MODEL_COLUMNS,
        TARGET,
        "item_id",
        "store_id",
    }
    missing_columns = sorted(required_columns - set(data.columns))
    if missing_columns:
        raise ValueError("training data is missing columns: " + ", ".join(missing_columns))

    validated = data.copy()
    validated["date"] = pd.to_datetime(validated["date"], errors="raise")
    split_labels = set(validated["split"].unique())
    if split_labels != set(SPLITS):
        raise ValueError(f"expected split labels {SPLITS}, found {sorted(split_labels)}")
    duplicate_count = int(
        validated.duplicated(["item_id", "store_id", "date"]).sum()
    )
    if duplicate_count:
        raise ValueError(f"training data contains {duplicate_count} duplicate keys")

    target = pd.to_numeric(validated[TARGET], errors="raise")
    if target.isna().any() or not np.isfinite(target.to_numpy()).all():
        raise ValueError("units_sold target must be finite and non-null")
    if target.lt(0).any():
        raise ValueError("units_sold target must be non-negative")
    validated[TARGET] = target.astype("float32")
    validate_feature_frame(validated)

    if TARGET in MODEL_FEATURE_COLUMNS:
        raise ValueError("units_sold target must not appear in model features")
    for earlier, later in zip(SPLITS, SPLITS[1:]):
        earlier_max = validated.loc[validated["split"] == earlier, "date"].max()
        later_min = validated.loc[validated["split"] == later, "date"].min()
        if earlier_max >= later_min:
            raise ValueError(f"split dates overlap or are out of order: {earlier}/{later}")
    return validated


def split_summary(data: pd.DataFrame) -> dict[str, dict[str, Any]]:
    summary = {}
    for split_name in SPLITS:
        rows = data.loc[data["split"] == split_name]
        summary[split_name] = {
            "minimum_date": rows["date"].min().date().isoformat(),
            "maximum_date": rows["date"].max().date().isoformat(),
            "row_count": int(len(rows)),
        }
    return summary


def evaluate_baselines(rows: pd.DataFrame) -> dict[str, dict[str, float | None]]:
    actual = rows[TARGET].to_numpy(dtype=np.float64)
    return {
        "zero_demand": calculate_demand_metrics(actual, np.zeros_like(actual)),
        "sales_lag_7": calculate_demand_metrics(
            actual, rows["sales_lag_7"].to_numpy(dtype=np.float64)
        ),
        "sales_rolling_mean_7": calculate_demand_metrics(
            actual, rows["sales_rolling_mean_7"].to_numpy(dtype=np.float64)
        ),
    }


def top_feature_importances(
    model: XGBRegressor,
    preprocessor: Any,
    limit: int = 20,
) -> list[dict[str, float | str]]:
    names = preprocessor.get_feature_names_out()
    importances = model.feature_importances_
    if len(names) != len(importances):
        raise ValueError("transformed feature names and model importances differ")
    ranked = sorted(
        zip(names, importances),
        key=lambda pair: (-float(pair[1]), str(pair[0])),
    )
    return [
        {"feature": str(name), "importance": float(importance)}
        for name, importance in ranked[:limit]
    ]


def save_artifacts(
    model: XGBRegressor,
    preprocessor: Any,
    metadata: dict[str, Any],
) -> None:
    DEMAND_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    model_temporary = DEMAND_MODEL_PATH.with_name("m5_demand_xgb.tmp.json")
    preprocessor_temporary = DEMAND_PREPROCESSOR_PATH.with_name(
        "m5_demand_preprocessor.tmp.joblib"
    )
    metadata_temporary = DEMAND_METADATA_PATH.with_name(
        "m5_demand_metadata.tmp.json"
    )
    try:
        model.save_model(model_temporary)
        joblib.dump(preprocessor, preprocessor_temporary, compress=3)
        metadata_temporary.write_text(
            json.dumps(metadata, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
        os.replace(model_temporary, DEMAND_MODEL_PATH)
        os.replace(preprocessor_temporary, DEMAND_PREPROCESSOR_PATH)
        os.replace(metadata_temporary, DEMAND_METADATA_PATH)
    finally:
        model_temporary.unlink(missing_ok=True)
        preprocessor_temporary.unlink(missing_ok=True)
        metadata_temporary.unlink(missing_ok=True)


def train_demand_model() -> dict[str, Any]:
    if not DATASET_PATH.is_file():
        raise FileNotFoundError(
            "Day 12 feature dataset is missing; run build_m5_demand_features.py first"
        )
    data = pd.read_csv(DATASET_PATH, parse_dates=["date"], low_memory=False)
    data = validate_training_data(data)
    split_rows = {
        split_name: data.loc[data["split"] == split_name].copy()
        for split_name in SPLITS
    }

    preprocessor = create_preprocessor()
    train_features = validate_feature_frame(split_rows["train"])
    validation_features = validate_feature_frame(split_rows["validation"])
    transformed_train = preprocessor.fit_transform(train_features)
    transformed_validation = preprocessor.transform(validation_features)

    model = XGBRegressor(**MODEL_PARAMETERS)
    model.fit(
        transformed_train,
        split_rows["train"][TARGET].to_numpy(dtype=np.float32),
        eval_set=[
            (
                transformed_validation,
                split_rows["validation"][TARGET].to_numpy(dtype=np.float32),
            )
        ],
        verbose=False,
    )

    validation_predictions = predict_non_negative_demand(
        model, preprocessor, validation_features
    )
    validation_metrics = calculate_demand_metrics(
        split_rows["validation"][TARGET], validation_predictions
    )
    validation_baselines = evaluate_baselines(split_rows["validation"])

    test_features = validate_feature_frame(split_rows["test"])
    test_predictions = predict_non_negative_demand(model, preprocessor, test_features)
    test_metrics = calculate_demand_metrics(
        split_rows["test"][TARGET], test_predictions
    )
    test_baselines = evaluate_baselines(split_rows["test"])

    best_iteration = int(model.best_iteration)
    metadata = {
        "model_name": "M5 CA_1 FOODS_1 demand regressor",
        "model_version": MODEL_VERSION,
        "model_source": "real_m5_historical_data",
        "training_dataset": DATASET_PATH.name,
        "split_summary": split_summary(data),
        "numeric_features": list(NUMERIC_FEATURES),
        "categorical_features": list(CATEGORICAL_FEATURES),
        "excluded_columns": list(EXCLUDED_MODEL_COLUMNS),
        "preprocessing_policy": {
            "fit_scope": "train rows only",
            "numeric": "passthrough with NaN preserved for XGBoost",
            "categorical": "OneHotEncoder(handle_unknown='ignore') fit on train only",
        },
        "missing_value_policy": (
            "No price or history values are filled; numeric NaN is passed to "
            "XGBoost native missing-value handling."
        ),
        "xgboost_parameters": MODEL_PARAMETERS,
        "best_iteration_zero_based": best_iteration,
        "evaluated_tree_count": best_iteration + 1,
        "validation_metrics": validation_metrics,
        "untouched_test_metrics": test_metrics,
        "baseline_metrics": {
            "validation": validation_baselines,
            "test": test_baselines,
        },
        "top_transformed_feature_importances": top_feature_importances(
            model, preprocessor
        ),
        "target_definition": (
            "Current-date units_sold for an item/store using known current price "
            "and calendar context plus strictly prior demand and price history."
        ),
        "dataset_limitations": [
            "The pilot contains only Walmart CA_1 / FOODS_1 historical observations.",
            "It is not Indian e-commerce or competitor-market data.",
            "Zero-inflated demand and missing historical prices remain in the features.",
            "Validation covers 28 days and the untouched test covers the following 28 days.",
        ],
        "causality_warning": (
            "Observational price-demand relationship is not guaranteed causal."
        ),
        "day_10_distinction": (
            "This real-data units_sold demand model is separate from the Day 10 "
            "synthetic 0-100 price-score model."
        ),
        "test_evaluation_policy": (
            "The test split was transformed and evaluated only after model fitting "
            "and validation-based early stopping were complete."
        ),
        "package_versions": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "xgboost": xgboost.__version__,
            "joblib": joblib.__version__,
        },
        "artifacts": {
            "model": DEMAND_MODEL_PATH.name,
            "preprocessor": DEMAND_PREPROCESSOR_PATH.name,
            "metadata": DEMAND_METADATA_PATH.name,
        },
    }
    save_artifacts(model, preprocessor, metadata)

    sample_positions = [0, 1, 2, len(test_features) // 2, len(test_features) - 1]
    sample_features = test_features.iloc[sample_positions]
    pre_save_sample = predict_non_negative_demand(
        model, preprocessor, sample_features
    )
    reloaded_model, reloaded_preprocessor, _ = load_demand_artifacts()
    reloaded_sample = predict_non_negative_demand(
        reloaded_model, reloaded_preprocessor, sample_features
    )
    np.testing.assert_allclose(
        reloaded_sample, pre_save_sample, rtol=1e-7, atol=1e-7
    )
    if not np.isfinite(reloaded_sample).all() or (reloaded_sample < 0).any():
        raise ValueError("reloaded demand predictions must be finite and non-negative")

    print(
        f"Rows: train={len(split_rows['train'])}, "
        f"validation={len(split_rows['validation'])}, test={len(split_rows['test'])}"
    )
    print(
        f"Best iteration: {best_iteration}; evaluated trees: {best_iteration + 1}"
    )
    print(
        "Validation model: "
        f"MAE={validation_metrics['mae']:.6f}, "
        f"RMSE={validation_metrics['rmse']:.6f}, "
        f"R2={validation_metrics['r2']:.6f}, "
        f"WAPE={validation_metrics['wape']:.6f}"
    )
    print(
        "Untouched test model: "
        f"MAE={test_metrics['mae']:.6f}, RMSE={test_metrics['rmse']:.6f}, "
        f"R2={test_metrics['r2']:.6f}, WAPE={test_metrics['wape']:.6f}"
    )
    print("Reload sample (actual -> predicted):")
    sample_rows = split_rows["test"].iloc[sample_positions]
    for (_, row), prediction in zip(sample_rows.iterrows(), reloaded_sample):
        print(
            f"  {row['date'].date()} {row['item_id']}: "
            f"{row[TARGET]:.0f} -> {prediction:.4f}"
        )
    return metadata


def main() -> None:
    try:
        train_demand_model()
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"Demand model training failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
