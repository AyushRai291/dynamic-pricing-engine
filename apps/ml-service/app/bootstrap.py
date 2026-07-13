from app.schemas import PricingFeatures


def _clip(value: float, lower: float, upper: float) -> float:
    return min(max(value, lower), upper)


def bootstrap_price_score(features: PricingFeatures) -> float:
    """Create a synthetic target from the documented bootstrap scoring policy."""
    market_signal = _clip(-features.price_gap_ratio / 0.30, -1.0, 1.0)
    range_signal = _clip(
        (0.5 - features.price_position_ratio) / 0.5,
        -1.0,
        1.0,
    )
    spread_penalty = min(features.competitor_price_spread_ratio, 1.0)
    market_reliability = features.competitor_available_ratio * (
        1.0 - 0.5 * spread_penalty
    )
    if features.has_competitor_data == 0:
        market_reliability = 0.0

    margin_protection = _clip(
        (0.20 - features.gross_margin_ratio) / 0.20,
        0.0,
        1.0,
    )
    return _clip(
        50.0
        + 30.0 * market_signal * market_reliability
        + 10.0 * range_signal
        + 10.0 * margin_protection,
        0.0,
        100.0,
    )
