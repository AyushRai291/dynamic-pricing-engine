const VALID_ACTIONS = new Set(['decrease', 'hold', 'increase']);

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function calculateGuardedCandidate({
  currentPrice,
  costPrice,
  minPrice,
  maxPrice,
  score,
  action,
}) {
  const values = [currentPrice, costPrice, minPrice, maxPrice, score];

  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('Candidate inputs must be finite numbers');
  }

  if (!VALID_ACTIONS.has(action) || score < 0 || score > 100) {
    throw new RangeError('Candidate score or action is invalid');
  }

  if (
    currentPrice <= 0
    || costPrice < 0
    || minPrice <= 0
    || maxPrice <= 0
    || minPrice > maxPrice
    || costPrice > maxPrice
  ) {
    throw new RangeError('Candidate price guardrails are invalid');
  }

  let changeRatio = 0;

  if (action === 'increase') {
    const strength = clamp((score - 60) / 40, 0, 1);
    changeRatio = strength * 0.10;
  } else if (action === 'decrease') {
    const strength = clamp((40 - score) / 40, 0, 1);
    changeRatio = -(strength * 0.10);
  }

  if (Object.is(changeRatio, -0)) {
    changeRatio = 0;
  }

  const rawCandidate = roundMoney(currentPrice * (1 + changeRatio));
  const appliedGuardrails = [];

  if (rawCandidate < minPrice) {
    appliedGuardrails.push('min_price');
  }

  if (rawCandidate > maxPrice) {
    appliedGuardrails.push('max_price');
  }

  if (rawCandidate < costPrice) {
    appliedGuardrails.push('cost_price');
  }

  const finalCandidate = roundMoney(
    Math.min(maxPrice, Math.max(rawCandidate, minPrice, costPrice))
  );

  return {
    changeRatio,
    rawCandidate,
    finalCandidate,
    appliedGuardrails,
  };
}

export function calculatePercentageChange(currentPrice, suggestedPrice) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(suggestedPrice)) {
    throw new TypeError('Percentage change inputs are invalid');
  }

  return roundMoney(((suggestedPrice - currentPrice) / currentPrice) * 100);
}
