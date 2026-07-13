from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from app.features import build_pricing_features
from app.model import load_model_artifacts, predict_price_score
from app.schemas import (
    FeatureBuildResponse,
    HealthResponse,
    PredictionResponse,
    PricingContext,
)


@asynccontextmanager
async def lifespan(application: FastAPI) -> AsyncIterator[None]:
    model, metadata = load_model_artifacts()
    application.state.price_score_model = model
    application.state.price_score_metadata = metadata
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
