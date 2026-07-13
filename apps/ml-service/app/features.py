from app.schemas import PricingContext, PricingFeatures


def build_pricing_features(context: PricingContext) -> PricingFeatures:
    """Build deterministic features, using neutral market values when none exist."""
    available_prices = tuple(
        competitor.price
        for competitor in context.competitors
        if competitor.is_available
    )
    competitor_count = len(context.competitors)
    available_competitor_count = len(available_prices)

    if available_prices:
        competitor_average_price = sum(available_prices) / available_competitor_count
        price_gap_ratio = (
            context.current_price - competitor_average_price
        ) / competitor_average_price
        competitor_price_spread_ratio = (
            max(available_prices) - min(available_prices)
        ) / competitor_average_price
        has_competitor_data = 1
    else:
        competitor_average_price = context.current_price
        price_gap_ratio = 0.0
        competitor_price_spread_ratio = 0.0
        has_competitor_data = 0

    price_range = context.max_price - context.min_price
    price_position_ratio = (
        (context.current_price - context.min_price) / price_range
        if price_range > 0
        else 0.5
    )

    return PricingFeatures(
        price_gap_ratio=price_gap_ratio,
        gross_margin_ratio=(
            context.current_price - context.cost_price
        ) / context.current_price,
        markdown_headroom_ratio=(
            context.current_price - context.min_price
        ) / context.current_price,
        markup_headroom_ratio=(
            context.max_price - context.current_price
        ) / context.current_price,
        price_position_ratio=price_position_ratio,
        inventory_count=context.inventory_count,
        competitor_count=competitor_count,
        available_competitor_count=available_competitor_count,
        competitor_available_ratio=(
            available_competitor_count / competitor_count
            if competitor_count > 0
            else 0.0
        ),
        competitor_price_spread_ratio=competitor_price_spread_ratio,
        has_competitor_data=has_competitor_data,
    )
