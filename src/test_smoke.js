/**
 * Smoke test — verifies core modules load and basic math works.
 * Run: npm test
 */
const assert = require('assert');
const { calculateSafeBuyQuantity, calculateSafeSellQuantity } = require('./strategy/riskManager');
const config = require('./config');

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.error(`❌ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

test('BUY qty respects MAX_TRADE_TOMAN', () => {
  const qty = calculateSafeBuyQuantity(10_000_000, 1000);
  const spent = qty * 1000;
  assert(spent <= config.MAX_TRADE_TOMAN + 1, `spent ${spent}`);
  assert(qty > 0);
});

test('BUY qty is 0 when balance below MIN', () => {
  const qty = calculateSafeBuyQuantity(config.MIN_TRADE_TOMAN - 1, 1000);
  assert.strictEqual(qty, 0);
});

test('SELL qty equals available', () => {
  const qty = calculateSafeSellQuantity(0.1234567);
  assert.strictEqual(qty, 0.123457);
});

test('SELL qty zero for invalid input', () => {
  assert.strictEqual(calculateSafeSellQuantity(0), 0);
  assert.strictEqual(calculateSafeSellQuantity(-1), 0);
});

test('Config loads', () => {
  assert(Array.isArray(config.SYMBOLS));
  assert(config.SYMBOLS.length > 0);
  assert(config.MAX_TRADE_TOMAN > 0);
});

console.log('\nSmoke test done.');