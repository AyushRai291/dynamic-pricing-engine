import unittest

import numpy as np

from app.bootstrap import bootstrap_price_score
from app.features import build_pricing_features
from app.model import (
    FEATURE_NAMES,
    clamp_price_score,
    load_model_artifacts,
    ordered_feature_values,
    predict_price_score,
    score_to_action,
)
from app.schemas import PricingContext, PricingFeatures


def make_context(**overrides: object) -> PricingContext:
    values: dict[str, object] = {
        "current_price": 100,
        "cost_price": 60,
        "min_price": 80,
        "max_price": 130,
        "inventory_count": 20,
        "competitors": [],
    }
    values.update(overrides)
    return PricingContext(**values)


class BootstrapPolicyTests(unittest.TestCase):
    def test_target_score_is_bounded(self) -> None:
        base = build_pricing_features(make_context())
        extremes = (
            base.model_copy(
                update={
                    "price_gap_ratio": -100.0,
                    "price_position_ratio": -100.0,
                    "gross_margin_ratio": -100.0,
                    "competitor_available_ratio": 1.0,
                    "has_competitor_data": 1,
                }
            ),
            base.model_copy(
                update={
                    "price_gap_ratio": 100.0,
                    "price_position_ratio": 100.0,
                    "gross_margin_ratio": 100.0,
                    "competitor_available_ratio": 1.0,
                    "has_competitor_data": 1,
                }
            ),
        )

        for features in extremes:
            with self.subTest(features=features):
                score = bootstrap_price_score(features)
                self.assertGreaterEqual(score, 0.0)
                self.assertLessEqual(score, 100.0)

    def test_below_market_scores_higher_than_above_market(self) -> None:
        below_market = build_pricing_features(
            make_context(competitors=[{"price": 130, "is_available": True}])
        )
        above_market = build_pricing_features(
            make_context(competitors=[{"price": 70, "is_available": True}])
        )

        self.assertGreater(
            bootstrap_price_score(below_market),
            bootstrap_price_score(above_market),
        )

    def test_low_margin_protection_does_not_lower_score(self) -> None:
        high_margin = build_pricing_features(
            make_context(cost_price=50, min_price=98)
        )
        low_margin = build_pricing_features(
            make_context(cost_price=98, min_price=98)
        )

        self.assertGreaterEqual(
            bootstrap_price_score(low_margin),
            bootstrap_price_score(high_margin),
        )

    def test_missing_competitors_remove_market_influence(self) -> None:
        base = build_pricing_features(make_context())
        below_market = base.model_copy(update={"price_gap_ratio": -0.30})
        above_market = base.model_copy(update={"price_gap_ratio": 0.30})

        self.assertEqual(
            bootstrap_price_score(below_market),
            bootstrap_price_score(above_market),
        )

    def test_action_threshold_boundaries(self) -> None:
        self.assertEqual(score_to_action(39.999), "decrease")
        self.assertEqual(score_to_action(40.0), "hold")
        self.assertEqual(score_to_action(60.0), "hold")
        self.assertEqual(score_to_action(60.001), "increase")

    def test_ordered_vector_follows_central_feature_list(self) -> None:
        features = build_pricing_features(
            make_context(competitors=[{"price": 90, "is_available": True}])
        )
        expected = tuple(float(getattr(features, name)) for name in FEATURE_NAMES)

        self.assertEqual(ordered_feature_values(features), expected)
        self.assertEqual(len(expected), 11)


class ModelArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.model, cls.metadata = load_model_artifacts()
        cls.features = build_pricing_features(
            make_context(
                competitors=[
                    {"price": 90, "is_available": True},
                    {"price": 110, "is_available": True},
                    {"price": 95, "is_available": False},
                ]
            )
        )

    def test_model_artifact_and_metadata_load(self) -> None:
        self.assertEqual(self.metadata["model_version"], "bootstrap-xgb-v1")
        self.assertEqual(self.metadata["model_source"], "synthetic_rule_based")
        self.assertEqual(self.metadata["feature_names"], list(FEATURE_NAMES))

    def test_same_input_produces_deterministic_prediction(self) -> None:
        first = predict_price_score(self.model, self.metadata, self.features)
        second = predict_price_score(self.model, self.metadata, self.features)

        self.assertEqual(first, second)

    def test_prediction_score_is_clamped(self) -> None:
        class FixedModel:
            def __init__(self, score: float) -> None:
                self.score = score

            def predict(self, feature_matrix: np.ndarray) -> np.ndarray:
                return np.asarray([self.score], dtype=np.float32)

        low = predict_price_score(FixedModel(-10), self.metadata, self.features)
        high = predict_price_score(FixedModel(110), self.metadata, self.features)

        self.assertEqual(low.price_score, 0.0)
        self.assertEqual(high.price_score, 100.0)
        self.assertEqual(clamp_price_score(-10), 0.0)
        self.assertEqual(clamp_price_score(110), 100.0)

    def test_prediction_action_matches_score(self) -> None:
        response = predict_price_score(self.model, self.metadata, self.features)

        self.assertEqual(response.action, score_to_action(response.price_score))


if __name__ == "__main__":
    unittest.main()
