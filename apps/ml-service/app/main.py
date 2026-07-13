from fastapi import FastAPI

from app.schemas import HealthResponse


app = FastAPI(
    title="Dynamic Pricing ML Service",
    version="0.1.0",
    description="Health foundation for the Dynamic Pricing Engine ML service.",
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="dynamic-pricing-ml",
        version="0.1.0",
    )
