from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator


PositiveFiniteFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]
NonNegativeFiniteFloat = Annotated[float, Field(ge=0, allow_inf_nan=False)]


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
