import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateGuardedCandidate,
  calculatePercentageChange,
} from '../src/utils/priceSuggestion.js';

function calculate(overrides = {}) {
  return calculateGuardedCandidate({
    currentPrice: 100,
    costPrice: 60,
    minPrice: 80,
    maxPrice: 130,
    score: 50,
    action: 'hold',
    ...overrides,
  });
}

test('hold, increase, and decrease use the transparent bounded formula', () => {
  assert.deepEqual(calculate(), {
    changeRatio: 0,
    rawCandidate: 100,
    finalCandidate: 100,
    appliedGuardrails: [],
  });
  assert.deepEqual(calculate({ score: 80, action: 'increase' }), {
    changeRatio: 0.05,
    rawCandidate: 105,
    finalCandidate: 105,
    appliedGuardrails: [],
  });
  assert.deepEqual(calculate({ score: 20, action: 'decrease' }), {
    changeRatio: -0.05,
    rawCandidate: 95,
    finalCandidate: 95,
    appliedGuardrails: [],
  });
});

test('candidate money and returned percentage changes are rounded to two decimals', () => {
  const result = calculate({
    currentPrice: 99.99,
    score: 80,
    action: 'increase',
  });

  assert.equal(result.rawCandidate, 104.99);
  assert.equal(result.finalCandidate, 104.99);
  assert.equal(calculatePercentageChange(99.99, 104.99), 5);
});

test('min, max, and cost guardrails clamp and identify the raw candidate changes', () => {
  assert.deepEqual(calculate({ score: 0, action: 'decrease', minPrice: 95 }), {
    changeRatio: -0.1,
    rawCandidate: 90,
    finalCandidate: 95,
    appliedGuardrails: ['min_price'],
  });
  assert.deepEqual(calculate({ score: 100, action: 'increase', maxPrice: 102 }), {
    changeRatio: 0.1,
    rawCandidate: 110,
    finalCandidate: 102,
    appliedGuardrails: ['max_price'],
  });
  assert.deepEqual(calculate({
    score: 0,
    action: 'decrease',
    minPrice: 80,
    costPrice: 93,
  }), {
    changeRatio: -0.1,
    rawCandidate: 90,
    finalCandidate: 93,
    appliedGuardrails: ['cost_price'],
  });
});

test('formula clamps inconsistent action strengths without exceeding ten percent', () => {
  assert.equal(calculate({ score: 50, action: 'increase' }).changeRatio, 0);
  assert.equal(calculate({ score: 50, action: 'decrease' }).changeRatio, 0);
  assert.equal(calculate({ score: 100, action: 'increase' }).changeRatio, 0.1);
  assert.equal(calculate({ score: 0, action: 'decrease' }).changeRatio, -0.1);
});
