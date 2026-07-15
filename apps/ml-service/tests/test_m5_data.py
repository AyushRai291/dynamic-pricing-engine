import unittest

import pandas as pd

from scripts.prepare_m5_subset import (
    assign_chronological_splits,
    build_audit,
    count_duplicate_keys,
    join_calendar_and_prices,
    wide_to_long,
)


class M5TransformationTests(unittest.TestCase):
    def test_wide_to_long_conversion(self) -> None:
        wide = pd.DataFrame(
            [
                {
                    "item_id": "ITEM_1",
                    "store_id": "CA_1",
                    "dept_id": "FOODS_1",
                    "cat_id": "FOODS",
                    "state_id": "CA",
                    "d_1": 2,
                    "d_2": 0,
                }
            ]
        )

        long = wide_to_long(wide)

        self.assertEqual(long["d"].tolist(), ["d_1", "d_2"])
        self.assertEqual(long["units_sold"].tolist(), [2, 0])
        self.assertEqual(long["item_id"].tolist(), ["ITEM_1", "ITEM_1"])

    def test_calendar_and_price_joins_preserve_missing_price(self) -> None:
        long_sales = pd.DataFrame(
            [
                {
                    "item_id": "ITEM_1",
                    "store_id": "CA_1",
                    "dept_id": "FOODS_1",
                    "cat_id": "FOODS",
                    "state_id": "CA",
                    "d": "d_2",
                    "units_sold": 3,
                },
                {
                    "item_id": "ITEM_1",
                    "store_id": "CA_1",
                    "dept_id": "FOODS_1",
                    "cat_id": "FOODS",
                    "state_id": "CA",
                    "d": "d_1",
                    "units_sold": 1,
                },
            ]
        )
        calendar = pd.DataFrame(
            [
                self._calendar_row("d_1", "2011-01-29", 11101),
                self._calendar_row("d_2", "2011-01-30", 11102),
            ]
        )
        prices = pd.DataFrame(
            [
                {
                    "store_id": "CA_1",
                    "item_id": "ITEM_1",
                    "wm_yr_wk": 11101,
                    "sell_price": 2.5,
                }
            ]
        )

        joined = join_calendar_and_prices(long_sales, calendar, prices)

        self.assertEqual(joined["d"].tolist(), ["d_1", "d_2"])
        self.assertEqual(joined.loc[0, "sell_price"], 2.5)
        self.assertTrue(pd.isna(joined.loc[1, "sell_price"]))

    def test_chronological_split_uses_final_28_and_preceding_28_dates(self) -> None:
        dates = pd.date_range("2020-01-01", periods=84, freq="D")
        data = pd.DataFrame(
            {"date": dates, "item_id": "ITEM_1", "store_id": "CA_1"}
        )

        split = assign_chronological_splits(data)

        self.assertEqual(split["split"].value_counts().to_dict(), {
            "train": 28,
            "validation": 28,
            "test": 28,
        })
        self.assertEqual(
            split.loc[split["split"] == "validation", "date"].min(), dates[28]
        )
        self.assertEqual(
            split.loc[split["split"] == "test", "date"].min(), dates[56]
        )

    def test_join_output_order_is_deterministic_by_date_and_item(self) -> None:
        long_sales = pd.DataFrame(
            [
                self._sales_row("ITEM_2", "d_1", 2),
                self._sales_row("ITEM_1", "d_1", 1),
            ]
        )
        calendar = pd.DataFrame(
            [self._calendar_row("d_1", "2011-01-29", 11101)]
        )
        prices = pd.DataFrame(
            [
                self._price_row("ITEM_2", 11101, 3.0),
                self._price_row("ITEM_1", 11101, 2.0),
            ]
        )

        first = join_calendar_and_prices(long_sales, calendar, prices)
        second = join_calendar_and_prices(long_sales, calendar, prices)

        self.assertEqual(first["item_id"].tolist(), ["ITEM_1", "ITEM_2"])
        pd.testing.assert_frame_equal(first, second)

    @staticmethod
    def _sales_row(item_id: str, day: str, units_sold: int) -> dict[str, object]:
        return {
            "item_id": item_id,
            "store_id": "CA_1",
            "dept_id": "FOODS_1",
            "cat_id": "FOODS",
            "state_id": "CA",
            "d": day,
            "units_sold": units_sold,
        }

    @staticmethod
    def _calendar_row(day: str, date: str, week: int) -> dict[str, object]:
        return {
            "d": day,
            "date": date,
            "wm_yr_wk": week,
            "weekday": "Saturday",
            "event_name_1": None,
            "event_type_1": None,
            "event_name_2": None,
            "event_type_2": None,
            "snap_CA": 0,
        }

    @staticmethod
    def _price_row(item_id: str, week: int, price: float) -> dict[str, object]:
        return {
            "store_id": "CA_1",
            "item_id": item_id,
            "wm_yr_wk": week,
            "sell_price": price,
        }


class M5AuditTests(unittest.TestCase):
    def test_duplicate_key_audit_counts_rows_beyond_first(self) -> None:
        dates = pd.date_range("2020-01-01", periods=57, freq="D")
        data = pd.DataFrame(
            {
                "item_id": "ITEM_1",
                "store_id": "CA_1",
                "date": dates,
                "units_sold": 0,
                "sell_price": 2.5,
            }
        )
        data = pd.concat([data, data.iloc[[0]]], ignore_index=True)
        data = assign_chronological_splits(data)

        audit = build_audit(
            data,
            "CA_1",
            "FOODS_1",
            archive_size_bytes=10,
            archive_md5="86f57416a314197f40a17cc6fc60cbb4",
            raw_file_sizes={
                "calendar.csv": 1,
                "sell_prices.csv": 2,
                "sales_train_evaluation.csv": 3,
            },
        )

        self.assertEqual(count_duplicate_keys(data), 1)
        self.assertEqual(audit["duplicate_key_count"], 1)
        self.assertEqual(
            audit["real_model_training_status"],
            "No real model has been trained yet.",
        )


if __name__ == "__main__":
    unittest.main()
