# M5 pilot data

M5 contains real historical daily Walmart unit sales, calendar events, SNAP flags,
and weekly item prices. This project uses the open [Zenodo
mirror](https://zenodo.org/records/12636070), DOI
`10.5281/zenodo.12636070`, attributed to Kaggle as the record creator and licensed
under CC BY 4.0.

The current pilot selects store `CA_1` and department `FOODS_1`. It is small enough
for reproducible local iteration while retaining genuine demand, price, event, and
zero-sales behavior. Raw archives/CSVs and processed outputs are ignored by Git.

From `apps/ml-service`, run:

```powershell
.\.venv\Scripts\python.exe scripts\download_m5.py
.\.venv\Scripts\python.exe scripts\prepare_m5_subset.py
```

The preparation uses the final 28 dates as test, the preceding 28 as validation,
and all earlier dates as training data so future observations never leak backward.
Missing historical prices are deliberately retained rather than filled or dropped.

This is real Walmart demand and price history; it is not Indian e-commerce
competitor data and cannot validate that target market by itself.
