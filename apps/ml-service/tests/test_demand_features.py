import unittest

import pandas as pd

from app.demand_features import (
    DEMAND_HISTORY_FEATURES,
    build_demand_features,
    count_duplicate_keys,
    filter_model_ready_rows,
    safe_divide,
    validate_split_chronology,
)


def make_source(days: int = 90) -> pd.DataFrame:
    dates = pd.date_range("2020-01-01", periods=days, freq="D")
    rows = []
    for item_id, units_offset, price_offset in (
        ("ITEM_A", 1, 10.0),
        ("ITEM_B", 101, 20.0),
    ):
        for index, date in enumerate(dates):
            if index < days - 56:
                split = "train"
            elif index < days - 28:
                split = "validation"
            else:
                split = "test"
            rows.append(
                {
                    "item_id": item_id,
                    "store_id": "CA_1",
                    "dept_id": "FOODS_1",
                    "cat_id": "FOODS",
                    "state_id": "CA",
                    "date": date,
                    "d": f"d_{index + 1}",
                    "split": split,
                    "sell_price": price_offset + index,
                    "units_sold": units_offset + index,
                    "event_name_1": "Promotion" if index == 40 else None,
                    "event_type_1": "Cultural" if index == 40 else None,
                    "snap_CA": index % 2,
                }
            )
    return pd.DataFrame(rows)


class DemandFeatureTests(unittest.TestCase):
    def test_sales_lags_and_rolling_features_use_only_past_values(self) -> None:
        featured = build_demand_features(make_source())
        item_a = featured.loc[featured["item_id"] == "ITEM_A"].reset_index(drop=True)
        row = item_a.iloc[28]

        self.assertEqual(row["sales_lag_1"], 28)
        self.assertEqual(row["sales_lag_7"], 22)
        self.assertEqual(row["sales_lag_28"], 1)
        self.assertAlmostEqual(row["sales_rolling_mean_7"], 25.0)
        self.assertAlmostEqual(row["sales_rolling_mean_28"], 14.5)
        self.assertAlmostEqual(
            row["sales_rolling_std_28"], pd.Series(range(1, 29)).std()
        )
        self.assertAlmostEqual(row["demand_trend_7_28"], (25.0 - 14.5) / 15.5)

    def test_modifying_future_target_does_not_change_earlier_features(self) -> None:
        source = make_source()
        modified = source.copy()
        final_item_a = (
            (modified["item_id"] == "ITEM_A")
            & (modified["date"] == modified["date"].max())
        )
        modified.loc[final_item_a, "units_sold"] = 999_999

        original_features = build_demand_features(source)
        modified_features = build_demand_features(modified)
        comparison_columns = ["item_id", "date", *DEMAND_HISTORY_FEATURES]

        pd.testing.assert_frame_equal(
            original_features.loc[:, comparison_columns],
            modified_features.loc[:, comparison_columns],
        )

    def test_item_groups_do_not_leak_into_each_other(self) -> None:
        featured = build_demand_features(make_source())
        item_b = featured.loc[featured["item_id"] == "ITEM_B"].reset_index(drop=True)

        self.assertTrue(pd.isna(item_b.loc[0, "sales_lag_1"]))
        self.assertTrue(pd.isna(item_b.loc[0, "price_lag_7"]))
        self.assertEqual(item_b.loc[28, "sales_lag_28"], 101)

    def test_price_history_uses_past_prices(self) -> None:
        featured = build_demand_features(make_source())
        item_a = featured.loc[featured["item_id"] == "ITEM_A"].reset_index(drop=True)
        row = item_a.iloc[28]

        self.assertEqual(row["price_lag_7"], 31.0)
        self.assertAlmostEqual(row["price_change_ratio_7"], (38.0 - 31.0) / 31.0)
        self.assertAlmostEqual(row["historical_price_mean_28"], 23.5)
        self.assertAlmostEqual(row["price_vs_history_ratio"], 38.0 / 23.5)

    def test_safe_division_preserves_missing_or_zero_denominators(self) -> None:
        result = safe_divide(
            pd.Series([2.0, 1.0, None, 4.0]),
            pd.Series([1.0, 0.0, 2.0, None]),
        )

        self.assertEqual(result.iloc[0], 2.0)
        self.assertTrue(pd.isna(result.iloc[1]))
        self.assertTrue(pd.isna(result.iloc[2]))
        self.assertTrue(pd.isna(result.iloc[3]))

    def test_output_is_chronological_and_event_missingness_is_explicit(self) -> None:
        shuffled = make_source().sample(frac=1.0, random_state=42).reset_index(drop=True)

        featured = build_demand_features(shuffled)

        expected_keys = featured.sort_values(
            ["date", "item_id"], kind="mergesort"
        )[["date", "item_id"]].reset_index(drop=True)
        pd.testing.assert_frame_equal(featured[["date", "item_id"]], expected_keys)
        no_event = featured.loc[featured["has_event"] == 0]
        self.assertTrue(no_event["event_name_1"].eq("No event").all())

    def test_filter_excludes_missing_price_but_retains_zero_target(self) -> None:
        source = make_source()
        missing_price_key = ("ITEM_A", source["date"].sort_values().unique()[30])
        zero_target_key = ("ITEM_A", source["date"].sort_values().unique()[31])
        source.loc[
            (source["item_id"] == missing_price_key[0])
            & (source["date"] == missing_price_key[1]),
            "sell_price",
        ] = None
        source.loc[
            (source["item_id"] == zero_target_key[0])
            & (source["date"] == zero_target_key[1]),
            "units_sold",
        ] = 0

        final_data = filter_model_ready_rows(build_demand_features(source))
        final_keys = set(zip(final_data["item_id"], final_data["date"]))

        self.assertNotIn(missing_price_key, final_keys)
        self.assertIn(zero_target_key, final_keys)
        retained_zero = final_data.loc[
            (final_data["item_id"] == zero_target_key[0])
            & (final_data["date"] == zero_target_key[1]),
            "units_sold",
        ]
        self.assertEqual(retained_zero.iloc[0], 0)

    def test_splits_remain_chronological_and_keys_are_unique(self) -> None:
        source = make_source()
        final_data = filter_model_ready_rows(build_demand_features(source))

        validate_split_chronology(final_data)
        self.assertEqual(count_duplicate_keys(final_data), 0)
        for split_name in ("train", "validation", "test"):
            source_dates = set(source.loc[source["split"] == split_name, "date"])
            final_dates = set(final_data.loc[final_data["split"] == split_name, "date"])
            self.assertTrue(final_dates.issubset(source_dates))


if __name__ == "__main__":
    unittest.main()
