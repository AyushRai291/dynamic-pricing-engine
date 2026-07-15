import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from app.demand_model import (
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
    update_candidate_price,
    validate_feature_frame,
)


def make_feature_frame(rows: int = 2) -> pd.DataFrame:
    values = []
    for index in range(rows):
        row = {feature: float(index + 1) for feature in NUMERIC_FEATURES}
        row.update(
            {
                "item_id": f"ITEM_{index}",
                "store_id": "CA_1",
                "dept_id": "FOODS_1",
                "cat_id": "FOODS",
                "state_id": "CA",
                "event_name_1": "No event",
                "event_type_1": "No event",
            }
        )
        values.append(row)
    return pd.DataFrame(values)


class DemandModelSchemaTests(unittest.TestCase):
    def test_canonical_feature_order_is_stable_and_excludes_metadata(self) -> None:
        expected_numeric = (
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

        self.assertEqual(NUMERIC_FEATURES, expected_numeric)
        self.assertEqual(MODEL_FEATURE_COLUMNS, (*NUMERIC_FEATURES, *CATEGORICAL_FEATURES))
        for excluded in ("units_sold", "date", "d", "split"):
            self.assertIn(excluded, EXCLUDED_MODEL_COLUMNS)
            self.assertNotIn(excluded, MODEL_FEATURE_COLUMNS)

    def test_preprocessor_handles_unknown_train_categories(self) -> None:
        train = validate_feature_frame(make_feature_frame())
        unknown = make_feature_frame(1)
        unknown.loc[0, "item_id"] = "UNSEEN_ITEM"
        unknown.loc[0, "event_name_1"] = "Unseen event"
        preprocessor = create_preprocessor()

        transformed_train = preprocessor.fit_transform(train)
        transformed_unknown = preprocessor.transform(validate_feature_frame(unknown))

        self.assertEqual(transformed_train.shape[1], transformed_unknown.shape[1])
        item_categories = preprocessor.named_transformers_["categorical"].categories_[0]
        self.assertNotIn("UNSEEN_ITEM", item_categories)

    def test_numeric_nan_remains_supported(self) -> None:
        frame = make_feature_frame()
        frame.loc[0, "price_lag_7"] = np.nan
        validated = validate_feature_frame(frame)
        preprocessor = create_preprocessor()

        transformed = preprocessor.fit_transform(validated)
        dense = transformed.toarray() if hasattr(transformed, "toarray") else transformed

        self.assertTrue(np.isnan(dense).any())

    def test_validation_catches_missing_required_features(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing required features"):
            validate_feature_frame(make_feature_frame().drop(columns=["sales_lag_28"]))


class CandidatePriceTests(unittest.TestCase):
    def test_candidate_updates_current_price_and_dependent_ratios_only(self) -> None:
        row = make_feature_frame(1).iloc[0]
        row["price_lag_7"] = 8.0
        row["historical_price_mean_28"] = 10.0

        updated = update_candidate_price(row, 12.0)

        self.assertEqual(updated["sell_price"], 12.0)
        self.assertEqual(updated["price_change_ratio_7"], 0.5)
        self.assertEqual(updated["price_vs_history_ratio"], 1.2)
        self.assertEqual(updated["price_lag_7"], 8.0)
        self.assertEqual(updated["historical_price_mean_28"], 10.0)

    def test_candidate_ratio_is_missing_for_zero_or_missing_history(self) -> None:
        row = make_feature_frame(1).iloc[0]
        row["price_lag_7"] = 0.0
        row["historical_price_mean_28"] = np.nan

        updated = update_candidate_price(row, 12.0)

        self.assertTrue(pd.isna(updated["price_change_ratio_7"]))
        self.assertTrue(pd.isna(updated["price_vs_history_ratio"]))


class DemandPredictionAndMetricTests(unittest.TestCase):
    def test_predictions_are_clipped_non_negative(self) -> None:
        class PassthroughPreprocessor:
            def transform(self, frame: pd.DataFrame) -> np.ndarray:
                return np.ones((len(frame), 1), dtype=np.float32)

        class FixedModel:
            def predict(self, matrix: np.ndarray) -> np.ndarray:
                return np.asarray([-2.0, 3.0], dtype=np.float32)

        predictions = predict_non_negative_demand(
            FixedModel(), PassthroughPreprocessor(), make_feature_frame()
        )

        np.testing.assert_array_equal(predictions, np.asarray([0.0, 3.0]))

    def test_metrics_handle_zero_heavy_targets(self) -> None:
        metrics = calculate_demand_metrics(
            actual=[0.0, 0.0, 2.0, 4.0],
            predicted=[1.0, 0.0, 3.0, 2.0],
        )

        self.assertAlmostEqual(metrics["mae"], 1.0)
        self.assertAlmostEqual(metrics["wape"], 4.0 / 6.0)
        self.assertAlmostEqual(metrics["mean_bias"], 0.0)
        self.assertAlmostEqual(metrics["actual_zero_percentage"], 50.0)
        self.assertAlmostEqual(metrics["mae_actual_zero"], 0.5)
        self.assertAlmostEqual(metrics["mae_actual_positive"], 1.5)

    def test_metrics_reject_zero_wape_denominator(self) -> None:
        with self.assertRaisesRegex(ValueError, "WAPE is undefined"):
            calculate_demand_metrics([0.0, 0.0], [0.0, 1.0])


class DemandArtifactTests(unittest.TestCase):
    def test_missing_artifact_error_is_clear(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            with self.assertRaisesRegex(RuntimeError, "demand model artifact is missing"):
                load_demand_artifacts(
                    root / "model.json",
                    root / "preprocessor.joblib",
                    root / "metadata.json",
                )

    @unittest.skipUnless(
        DEMAND_MODEL_PATH.is_file()
        and DEMAND_PREPROCESSOR_PATH.is_file()
        and DEMAND_METADATA_PATH.is_file(),
        "real Day 13 artifacts have not been trained yet",
    )
    def test_real_saved_artifacts_reload_and_predict(self) -> None:
        model, preprocessor, metadata = load_demand_artifacts()

        predictions = predict_non_negative_demand(
            model, preprocessor, make_feature_frame(1)
        )

        self.assertEqual(metadata["model_version"], "m5-demand-xgb-v1")
        self.assertEqual(len(predictions), 1)
        self.assertTrue(np.isfinite(predictions).all())
        self.assertTrue((predictions >= 0).all())


if __name__ == "__main__":
    unittest.main()
