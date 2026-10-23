const config = require('../config');

function calculateSafeBuyQuantity(availableToman, currentPrice) {
  if (!Number.isFinite(availableToman) || availableToman < config.MIN_TRADE_TOMAN) {
    return 0;
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;

  const invest = Math.min(availableToman, config.MAX_TRADE_TOMAN);
  if (invest < config.MIN_TRADE_TOMAN) return 0;

  const qty = invest / currentPrice;
  // Wallex typically supports 6 decimals for crypto quantity
  return parseFloat(qty.toFixed(6));
}

function calculateSafeSellQuantity(availableCrypto) {
  if (!Number.isFinite(availableCrypto) || availableCrypto <= 0) return 0;
  return parseFloat(availableCrypto.toFixed(6));
}

module.exports = { calculateSafeBuyQuantity, calculateSafeSellQuantity };
