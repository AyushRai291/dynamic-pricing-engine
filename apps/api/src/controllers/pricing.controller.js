import { getMlHealth } from '../services/ml.service.js';
import { scoreProductPricing } from '../services/pricing.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export const getPricingStatus = asyncHandler(async (req, res) => {
  const mlHealth = await getMlHealth();

  res.status(200).json({
    status: 'ok',
    ml_service: mlHealth,
  });
});

export const scoreProduct = asyncHandler(async (req, res) => {
  if (!UUID_REGEX.test(req.params.productId)) {
    throw createError('Invalid product id', 400);
  }

  const result = await scoreProductPricing(req.params.productId);

  res.status(200).json(result);
});
