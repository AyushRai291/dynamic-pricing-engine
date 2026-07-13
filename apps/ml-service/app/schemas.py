from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: Literal["dynamic-pricing-ml"]
    version: Literal["0.1.0"]
