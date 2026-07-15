import copy
import math
import unittest
from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient

from app.demand_model import load_demand_artifacts, update_candidate_price
from app.main import app


def demand_features() -> dict[str, object]:
    return {
        "sell_price": 2.0,
        "sales_lag_1": 1.0,
        "sales_lag_7": 2.0,
        "sales_lag_28": 1.0,
        "sales_rolling_mean_7": 1.4,
        "sales_rolling_mean_28": 1.2,
        "sales_rolling_std_28": 1.1,
        "demand_trend_7_28": 0.090909,
        "price_lag_7": 2.0,
        "price_change_ratio_7": 0.0,
        "historical_price_mean_28": 2.0,
        "price_vs_history_ratio": 1.0,
        "day_of_week": 0,
        "month": 4,
        "week_of_year": 17,
        "is_weekend": 0,
        "has_event": 0,
        "snap_active": 0,
        "item_id": "FOODS_1_001",
        "store_id": "CA_1",
        "dept_id": "FOODS_1",
        "cat_id": "FOODS",
        "state_id": "CA",
        "event_name_1": "No event",
        "event_type_1": "No event",
    }


def simulation_payload() -> dict[str, object]:
    return {
        "features": demand_features(),
        "candidate_prices": [1.8, 2.0, 2.2],
        "cost_price": 1.0,
        "min_price": 1.5,
        "max_price": 2.3,
        "max_change_ratio": 0.15,
    }


class DemandApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client_context = TestClient(app, raise_server_exceptions=False)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_context.__exit__(None, None, None)

    def test_demand_prediction_returns_honest_non_negative_output(self) -> None:
        response = self.client.post("/demand/predict", json=demand_features())

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(math.isfinite(body["predicted_units"]))
        self.assertGreaterEqual(body["predicted_units"], 0.0)
        self.assertEqual(body["model_version"], "m5-demand-xgb-v1")
        self.assertEqual(body["model_source"], "real_m5_historical_data")
        self.assertIn("M5 CA_1 / FOODS_1", body["training_scope"])
        self.assertIn("not causal", body["warning"])
        self.assertIn("not validated for Indian e-commerce", body["warning"])

    def test_null_historical_prices_and_unknown_item_are_accepted(self) -> None:
        features = demand_features()
        features["item_id"] = "UNKNOWN_ITEM"
        for field in (
            "price_lag_7",
            "price_change_ratio_7",
            "historical_price_mean_28",
            "price_vs_history_ratio",
        ):
            features[field] = None

        response = self.client.post("/demand/predict", json=features)

        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.json()["predicted_units"], 0.0)

    def test_simulation_preserves_order_and_reconciles_arithmetic(self) -> None:
        payload = simulation_payload()
        original = copy.deepcopy(payload["features"])

        response = self.client.post("/demand/simulate-prices", json=payload)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            [result["candidate_price"] for result in body["results"]],
            payload["candidate_prices"],
        )
        self.assertEqual(len(body["results"]), 3)
        for result in body["results"]:
            expected_revenue = round(
                result["candidate_price"] * result["predicted_units"], 6
            )
            expected_profit = round(
                (result["candidate_price"] - payload["cost_price"])
                * result["predicted_units"],
                6,
            )
            self.assertAlmostEqual(result["expected_revenue"], expected_revenue)
            self.assertAlmostEqual(result["expected_gross_profit"], expected_profit)
        self.assertEqual(payload["features"], original)
        self.assertNotIn("recommended_price", body)
        self.assertNotIn("confidence", body)

    def test_candidate_helper_updates_ratios_without_history_mutation(self) -> None:
        original = demand_features()
        updated = update_candidate_price(pd.Series(original), 2.2)

        self.assertAlmostEqual(updated["price_change_ratio_7"], 0.1)
        self.assertAlmostEqual(updated["price_vs_history_ratio"], 1.1)
        self.assertEqual(updated["price_lag_7"], original["price_lag_7"])
        self.assertEqual(
            updated["historical_price_mean_28"],
            original["historical_price_mean_28"],
        )

    def assert_simulation_error(
        self, payload: dict[str, object], message: str
    ) -> None:
        response = self.client.post("/demand/simulate-prices", json=payload)
        self.assertEqual(response.status_code, 422)
        self.assertIn(message, str(response.json()))

    def test_below_cost_candidate_returns_422(self) -> None:
        payload = simulation_payload()
        payload.update(candidate_prices=[1.8], cost_price=1.9)
        self.assert_simulation_error(payload, "cost_price")

    def test_candidate_outside_bounds_returns_422(self) -> None:
        payload = simulation_payload()
        payload.update(candidate_prices=[2.3], max_price=2.2)
        self.assert_simulation_error(payload, "min_price and max_price")

    def test_candidate_above_maximum_change_returns_422(self) -> None:
        payload = simulation_payload()
        payload.update(candidate_prices=[2.4], min_price=1.0, max_price=3.0)
        self.assert_simulation_error(payload, "max_change_ratio")

    def test_duplicate_candidates_return_422(self) -> None:
        payload = simulation_payload()
        payload["candidate_prices"] = [2.0, 2.0]
        self.assert_simulation_error(payload, "unique")

    def test_requested_maximum_change_cannot_exceed_15_percent(self) -> None:
        payload = simulation_payload()
        payload["max_change_ratio"] = 0.151
        self.assert_simulation_error(payload, "less than or equal to 0.15")

    def test_more_than_25_candidates_returns_422(self) -> None:
        payload = simulation_payload()
        payload["candidate_prices"] = [1.75 + index * 0.01 for index in range(26)]
        self.assert_simulation_error(payload, "25")

    def test_missing_feature_returns_422(self) -> None:
        features = demand_features()
        del features["sales_lag_28"]

        response = self.client.post("/demand/predict", json=features)

        self.assertEqual(response.status_code, 422)
        self.assertIn("sales_lag_28", str(response.json()))

    def test_invalid_binary_and_calendar_values_return_422(self) -> None:
        for field, value in (("snap_active", 2), ("day_of_week", 7), ("month", 13)):
            with self.subTest(field=field):
                features = demand_features()
                features[field] = value
                response = self.client.post("/demand/predict", json=features)
                self.assertEqual(response.status_code, 422)

    def test_whitespace_category_returns_422(self) -> None:
        features = demand_features()
        features["item_id"] = "   "

        response = self.client.post("/demand/predict", json=features)

        self.assertEqual(response.status_code, 422)
        self.assertIn("must not be empty", str(response.json()))

    def test_unexpected_inference_error_is_sanitized(self) -> None:
        class FailingModel:
            def predict(self, matrix: object) -> object:
                raise RuntimeError("C:\\private\\model failure")

        original_model = app.state.demand_model
        app.state.demand_model = FailingModel()
        try:
            response = self.client.post("/demand/predict", json=demand_features())
        finally:
            app.state.demand_model = original_model

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {"detail": "Demand inference failed."})

    def test_existing_endpoints_remain_functional(self) -> None:
        health = self.client.get("/health")
        pricing_context = {
            "current_price": 100,
            "cost_price": 60,
            "min_price": 80,
            "max_price": 130,
            "inventory_count": 20,
            "competitors": [{"price": 95, "is_available": True}],
        }
        features = self.client.post("/features/build", json=pricing_context)
        prediction = self.client.post("/predict", json=pricing_context)

        self.assertEqual(health.status_code, 200)
        self.assertEqual(features.status_code, 200)
        self.assertEqual(prediction.status_code, 200)
        self.assertEqual(prediction.json()["model_source"], "synthetic_rule_based")

    def test_docs_and_openapi_include_new_and_existing_endpoints(self) -> None:
        docs = self.client.get("/docs")
        openapi = self.client.get("/openapi.json")

        self.assertEqual(docs.status_code, 200)
        self.assertEqual(openapi.status_code, 200)
        paths = openapi.json()["paths"]
        for path in (
            "/health",
            "/features/build",
            "/predict",
            "/demand/predict",
            "/demand/simulate-prices",
        ):
            self.assertIn(path, paths)
        self.assertIn("bootstrap price score", paths["/predict"]["post"]["summary"])
        self.assertIn("real M5", paths["/demand/predict"]["post"]["summary"])

    def test_demand_artifacts_load_once_per_lifespan(self) -> None:
        with patch("app.main.load_demand_artifacts", wraps=load_demand_artifacts) as loader:
            with TestClient(app) as client:
                self.assertEqual(client.post("/demand/predict", json=demand_features()).status_code, 200)
                self.assertEqual(client.post("/demand/predict", json=demand_features()).status_code, 200)

        self.assertEqual(loader.call_count, 1)


if __name__ == "__main__":
    unittest.main()
