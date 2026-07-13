import unittest

from pydantic import ValidationError

from app.features import build_pricing_features
from app.schemas import PricingContext


class PricingFeatureTests(unittest.TestCase):
    def make_context(self, **overrides: object) -> PricingContext:
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

    def test_normal_available_competitor_case(self) -> None:
        context = self.make_context(
            competitors=[
                {"price": 90, "is_available": True},
                {"price": 110, "is_available": True},
                {"price": 95, "is_available": False},
            ]
        )

        features = build_pricing_features(context)

        self.assertAlmostEqual(features.price_gap_ratio, 0.0)
        self.assertAlmostEqual(features.gross_margin_ratio, 0.4)
        self.assertAlmostEqual(features.markdown_headroom_ratio, 0.2)
        self.assertAlmostEqual(features.markup_headroom_ratio, 0.3)
        self.assertAlmostEqual(features.price_position_ratio, 0.4)
        self.assertEqual(features.inventory_count, 20)
        self.assertEqual(features.competitor_count, 3)
        self.assertEqual(features.available_competitor_count, 2)
        self.assertAlmostEqual(features.competitor_available_ratio, 2 / 3)
        self.assertAlmostEqual(features.competitor_price_spread_ratio, 0.2)
        self.assertEqual(features.has_competitor_data, 1)

    def test_unavailable_prices_are_excluded_from_statistics(self) -> None:
        context = self.make_context(
            competitors=[
                {"price": 80, "is_available": True},
                {"price": 200, "is_available": False},
            ]
        )

        features = build_pricing_features(context)

        self.assertAlmostEqual(features.price_gap_ratio, 0.25)
        self.assertAlmostEqual(features.competitor_price_spread_ratio, 0.0)
        self.assertEqual(features.available_competitor_count, 1)
        self.assertAlmostEqual(features.competitor_available_ratio, 0.5)

    def test_empty_competitor_list_uses_neutral_features(self) -> None:
        features = build_pricing_features(self.make_context())

        self.assertAlmostEqual(features.price_gap_ratio, 0.0)
        self.assertEqual(features.competitor_count, 0)
        self.assertEqual(features.available_competitor_count, 0)
        self.assertAlmostEqual(features.competitor_available_ratio, 0.0)
        self.assertAlmostEqual(features.competitor_price_spread_ratio, 0.0)
        self.assertEqual(features.has_competitor_data, 0)

    def test_all_unavailable_competitors_use_neutral_price_features(self) -> None:
        context = self.make_context(
            competitors=[
                {"price": 90, "is_available": False},
                {"price": 110, "is_available": False},
            ]
        )

        features = build_pricing_features(context)

        self.assertAlmostEqual(features.price_gap_ratio, 0.0)
        self.assertEqual(features.competitor_count, 2)
        self.assertEqual(features.available_competitor_count, 0)
        self.assertAlmostEqual(features.competitor_available_ratio, 0.0)
        self.assertAlmostEqual(features.competitor_price_spread_ratio, 0.0)
        self.assertEqual(features.has_competitor_data, 0)

    def test_current_price_at_minimum(self) -> None:
        features = build_pricing_features(
            self.make_context(current_price=80, max_price=130)
        )

        self.assertAlmostEqual(features.markdown_headroom_ratio, 0.0)
        self.assertAlmostEqual(features.price_position_ratio, 0.0)

    def test_current_price_at_maximum(self) -> None:
        features = build_pricing_features(
            self.make_context(current_price=130, max_price=130)
        )

        self.assertAlmostEqual(features.markup_headroom_ratio, 0.0)
        self.assertAlmostEqual(features.price_position_ratio, 1.0)

    def test_fixed_price_range_uses_neutral_position(self) -> None:
        features = build_pricing_features(
            self.make_context(current_price=100, min_price=100, max_price=100)
        )

        self.assertAlmostEqual(features.price_position_ratio, 0.5)

    def test_invalid_price_relationships_are_rejected(self) -> None:
        invalid_overrides = (
            {"cost_price": 90, "min_price": 80},
            {"min_price": 110, "current_price": 100},
            {"current_price": 140, "max_price": 130},
        )

        for overrides in invalid_overrides:
            with self.subTest(overrides=overrides):
                with self.assertRaises(ValidationError):
                    self.make_context(**overrides)

    def test_negative_values_are_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self.make_context(inventory_count=-1)
        with self.assertRaises(ValidationError):
            self.make_context(current_price=-1)
        with self.assertRaises(ValidationError):
            self.make_context(
                competitors=[{"price": -1, "is_available": True}]
            )

    def test_non_finite_prices_are_rejected(self) -> None:
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    self.make_context(current_price=value)

    def test_repeated_builds_are_deterministic(self) -> None:
        context = self.make_context(
            competitors=[{"price": 90, "is_available": True}]
        )

        first = build_pricing_features(context)
        second = build_pricing_features(context)

        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
