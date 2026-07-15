from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


PositiveFiniteFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]
NonNegativeFiniteFloat = Annotated[float, Field(ge=0, allow_inf_nan=False)]
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]
NullableFiniteFloat = Annotated[float | None, Field(allow_inf_nan=False)]
NullablePositiveFiniteFloat = Annotated[
    float | None, Field(gt=0, allow_inf_nan=False)
]
BinaryFlag = Literal[0, 1]

DEMAND_FEATURE_EXAMPLE = {
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


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["dynamic-pricing-ml"]
    version: Literal["0.1.0"]


class CompetitorInput(BaseModel):
    price: PositiveFiniteFloat
    is_available: bool


class PricingContext(BaseModel):
    current_price: PositiveFiniteFloat
    cost_price: NonNegativeFiniteFloat
    min_price: PositiveFiniteFloat
    max_price: PositiveFiniteFloat
    inventory_count: Annotated[int, Field(ge=0)]
    competitors: list[CompetitorInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_price_guardrails(self) -> "PricingContext":
        if self.cost_price > self.min_price:
            raise ValueError("cost_price must be less than or equal to min_price")
        if self.min_price > self.current_price:
            raise ValueError("min_price must be less than or equal to current_price")
        if self.current_price > self.max_price:
            raise ValueError("current_price must be less than or equal to max_price")
        return self


class PricingFeatures(BaseModel):
    price_gap_ratio: float
    gross_margin_ratio: float
    markdown_headroom_ratio: float
    markup_headroom_ratio: float
    price_position_ratio: float
    inventory_count: int
    competitor_count: int
    available_competitor_count: int
    competitor_available_ratio: float
    competitor_price_spread_ratio: float
    has_competitor_data: Literal[0, 1]


class FeatureBuildResponse(BaseModel):
    features: PricingFeatures


PriceAction = Literal["decrease", "hold", "increase"]


class PredictionResponse(BaseModel):
    price_score: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
    action: PriceAction
    model_version: str
    model_source: Literal["synthetic_rule_based"]
    features: PricingFeatures


class DemandFeatureInput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"examples": [DEMAND_FEATURE_EXAMPLE]}
    )

    sell_price: PositiveFiniteFloat
    sales_lag_1: NonNegativeFiniteFloat
    sales_lag_7: NonNegativeFiniteFloat
    sales_lag_28: NonNegativeFiniteFloat
    sales_rolling_mean_7: NonNegativeFiniteFloat
    sales_rolling_mean_28: NonNegativeFiniteFloat
    sales_rolling_std_28: NonNegativeFiniteFloat
    demand_trend_7_28: FiniteFloat
    price_lag_7: NullablePositiveFiniteFloat
    price_change_ratio_7: NullableFiniteFloat
    historical_price_mean_28: NullablePositiveFiniteFloat
    price_vs_history_ratio: NullablePositiveFiniteFloat
    day_of_week: Annotated[int, Field(ge=0, le=6)]
    month: Annotated[int, Field(ge=1, le=12)]
    week_of_year: Annotated[int, Field(ge=1, le=53)]
    is_weekend: BinaryFlag
    has_event: BinaryFlag
    snap_active: BinaryFlag
    item_id: str
    store_id: str
    dept_id: str
    cat_id: str
    state_id: str
    event_name_1: str
    event_type_1: str

    @field_validator(
        "item_id",
        "store_id",
        "dept_id",
        "cat_id",
        "state_id",
        "event_name_1",
        "event_type_1",
    )
    @classmethod
    def validate_non_empty_category(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("categorical values must not be empty")
        return value


class DemandPredictionResponse(BaseModel):
    predicted_units: NonNegativeFiniteFloat
    model_version: str
    model_source: Literal["real_m5_historical_data"]
    training_scope: str
    warning: str


class DemandPriceSimulationRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "examples": [
                {
                    "features": DEMAND_FEATURE_EXAMPLE,
                    "candidate_prices": [1.8, 2.0, 2.2],
                    "cost_price": 1.0,
                    "min_price": 1.5,
                    "max_price": 2.3,
                    "max_change_ratio": 0.15,
                }
            ]
        }
    )

    features: DemandFeatureInput
    candidate_prices: Annotated[
        list[PositiveFiniteFloat], Field(min_length=1, max_length=25)
    ]
    cost_price: PositiveFiniteFloat
    min_price: PositiveFiniteFloat
    max_price: PositiveFiniteFloat
    max_change_ratio: Annotated[
        float, Field(gt=0, le=0.15, allow_inf_nan=False)
    ] = 0.15

    @model_validator(mode="after")
    def validate_guardrails(self) -> "DemandPriceSimulationRequest":
        if self.min_price > self.max_price:
            raise ValueError("min_price must be less than or equal to max_price")
        if self.cost_price > self.max_price:
            raise ValueError("cost_price must be less than or equal to max_price")
        current_price = self.features.sell_price
        if not self.min_price <= current_price <= self.max_price:
            raise ValueError("current sell_price must be within min_price and max_price")
        if len(set(self.candidate_prices)) != len(self.candidate_prices):
            raise ValueError("candidate_prices must contain unique values")

        for candidate in self.candidate_prices:
            if not self.min_price <= candidate <= self.max_price:
                raise ValueError(
                    f"candidate price {candidate} must be within min_price and max_price"
                )
            if candidate < self.cost_price:
                raise ValueError(
                    f"candidate price {candidate} must be greater than or equal to cost_price"
                )
            change_ratio = abs(candidate - current_price) / current_price
            if change_ratio > self.max_change_ratio + 1e-12:
                raise ValueError(
                    f"candidate price {candidate} exceeds max_change_ratio"
                )
        return self


class DemandPriceSimulationResult(BaseModel):
    candidate_price: PositiveFiniteFloat
    predicted_units: NonNegativeFiniteFloat
    expected_revenue: NonNegativeFiniteFloat
    expected_gross_profit: NonNegativeFiniteFloat
    price_change_ratio: FiniteFloat


class DemandPriceSimulationResponse(BaseModel):
    current_price: PositiveFiniteFloat
    cost_price: PositiveFiniteFloat
    min_price: PositiveFiniteFloat
    max_price: PositiveFiniteFloat
    max_change_ratio: Annotated[float, Field(gt=0, le=0.15, allow_inf_nan=False)]
    results: list[DemandPriceSimulationResult]
    model_version: str
    model_source: Literal["real_m5_historical_data"]
    training_scope: str
    warning: str
