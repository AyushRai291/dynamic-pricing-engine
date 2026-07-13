from fastapi import FastAPI

from app.features import build_pricing_features
from app.schemas import FeatureBuildResponse, HealthResponse, PricingContext


app = FastAPI(
    title="Dynamic Pricing ML Service",
    version="0.1.0",
    description="Deterministic feature engineering for dynamic pricing inputs.",
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
