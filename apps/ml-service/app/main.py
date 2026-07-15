from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Request

from app.demand_model import (
    MODEL_FEATURE_COLUMNS,
    load_demand_artifacts,
    predict_non_negative_demand,
    update_candidate_price,
)
from app.features import build_pricing_features
from app.model import load_model_artifacts, predict_price_score
from app.schemas import (
    DemandFeatureInput,
    DemandPredictionResponse,
    DemandPriceSimulationRequest,
    DemandPriceSimulationResponse,
    DemandPriceSimulationResult,
    FeatureBuildResponse,
    HealthResponse,
    PredictionResponse,
    PricingContext,
)


DEMAND_WARNING = (
    "Observational M5 CA_1 / FOODS_1 pilot output; the price-demand relationship "
    "is not causal and the model is not validated for Indian e-commerce demand."
)
SIMULATION_WARNING = (
    DEMAND_WARNING
    + " Candidate results are experimental scenarios, not an automatic price "
    "recommendation or update."
)


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    model, metadata = load_model_artifacts()
    demand_model, demand_preprocessor, demand_metadata = load_demand_artifacts()
    application.state.price_score_model = model
    application.state.price_score_metadata = metadata
    application.state.demand_model = demand_model
    application.state.demand_preprocessor = demand_preprocessor
    application.state.demand_metadata = demand_metadata
    yield


app = FastAPI(
    title="Dynamic Pricing ML Service",
    version="0.1.0",
    description=(
        "Deterministic pricing features and an infrastructure-only score model "
        "trained on bootstrap synthetic rule-based data."
    ),
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="dynamic-pricing-ml",
        version="0.1.0",
    )


@app.post(
    "/features/build",
    response_model=FeatureBuildResponse,
    summary="Build pricing features",
    description="Validate raw pricing context and return deterministic numeric features.",
)
def build_features(context: PricingContext) -> FeatureBuildResponse:
    return FeatureBuildResponse(features=build_pricing_features(context))


@app.post(
    "/predict",
    response_model=PredictionResponse,
    summary="Predict a bootstrap price score",
    description=(
        "Return a 0-100 price score learned from bootstrap synthetic rule-based "
        "training data; this is not a suggested price or real-world performance claim."
    ),
)
def predict(context: PricingContext, request: Request) -> PredictionResponse:
    features = build_pricing_features(context)
    return predict_price_score(
        request.app.state.price_score_model,
        request.app.state.price_score_metadata,
        features,
    )


def _demand_frame(features: DemandFeatureInput) -> pd.DataFrame:
    values = features.model_dump()
    for column in (
        "price_lag_7",
        "price_change_ratio_7",
        "historical_price_mean_28",
        "price_vs_history_ratio",
    ):
        if values[column] is None:
            values[column] = np.nan
    return pd.DataFrame([values], columns=list(MODEL_FEATURE_COLUMNS))


def _training_scope(metadata: dict[str, object]) -> str:
    train = metadata["split_summary"]["train"]
    return (
        "M5 CA_1 / FOODS_1 historical pilot; train "
        f"{train['minimum_date']} through {train['maximum_date']}"
    )


def _run_demand_prediction(request: Request, features: pd.DataFrame) -> np.ndarray:
    try:
        return predict_non_negative_demand(
            request.app.state.demand_model,
            request.app.state.demand_preprocessor,
            features,
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Demand inference failed.",
        ) from None


@app.post(
    "/demand/predict",
    response_model=DemandPredictionResponse,
    summary="Predict real M5 expected units",
    description=(
        "Predict current-date units_sold from one complete leakage-safe feature "
        "row using the saved real M5 demand model. This differs from /predict, "
        "which returns a synthetic bootstrap 0-100 price score."
    ),
)
def predict_demand(
    features: DemandFeatureInput,
    request: Request,
) -> DemandPredictionResponse:
    prediction = float(_run_demand_prediction(request, _demand_frame(features))[0])
    metadata = request.app.state.demand_metadata
    return DemandPredictionResponse(
        predicted_units=round(prediction, 6),
        model_version=metadata["model_version"],
        model_source=metadata["model_source"],
        training_scope=_training_scope(metadata),
        warning=DEMAND_WARNING,
    )


@app.post(
    "/demand/simulate-prices",
    response_model=DemandPriceSimulationResponse,
    summary="Simulate guarded candidate prices",
    description=(
        "Evaluate 1-25 explicit price scenarios with the saved real M5 demand "
        "model while holding historical demand, historical prices, and calendar "
        "context fixed. No candidate is selected or applied automatically."
    ),
)
def simulate_demand_prices(
    simulation: DemandPriceSimulationRequest,
    request: Request,
) -> DemandPriceSimulationResponse:
    base_row = _demand_frame(simulation.features).iloc[0]
    try:
        candidate_rows = [
            update_candidate_price(base_row, candidate)
            for candidate in simulation.candidate_prices
        ]
        candidate_frame = pd.DataFrame(
            candidate_rows, columns=list(MODEL_FEATURE_COLUMNS)
        )
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Demand inference failed.",
        ) from None
    predictions = _run_demand_prediction(request, candidate_frame)

    current_price = simulation.features.sell_price
    results = []
    for candidate, raw_prediction in zip(simulation.candidate_prices, predictions):
        predicted_units = round(float(raw_prediction), 6)
        results.append(
            DemandPriceSimulationResult(
                candidate_price=candidate,
                predicted_units=predicted_units,
                expected_revenue=round(candidate * predicted_units, 6),
                expected_gross_profit=round(
                    (candidate - simulation.cost_price) * predicted_units, 6
                ),
                price_change_ratio=round(
                    (candidate - current_price) / current_price, 6
                ),
            )
        )

    metadata = request.app.state.demand_metadata
    return DemandPriceSimulationResponse(
        current_price=current_price,
        cost_price=simulation.cost_price,
        min_price=simulation.min_price,
        max_price=simulation.max_price,
        max_change_ratio=simulation.max_change_ratio,
        results=results,
        model_version=metadata["model_version"],
        model_source=metadata["model_source"],
        training_scope=_training_scope(metadata),
        warning=SIMULATION_WARNING,
    )
