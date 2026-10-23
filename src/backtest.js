/**
 * Simple backtest on historical klines from Wallex UDF endpoint.
 * Usage: node backtest.js [SYMBOL] [DAYS]
 *   e.g. node backtest.js BTCTMN 7
 *
 * Strategy mirrored from live engine: RSI(14) + MACD(12,26,9) with
 * hard stop-loss / take-profit. No AI in backtest (deterministic).
 */
const axios = require('axios');
const { RSI, MACD } = require('technicalindicators');
const config = require('./config');

const SYMBOL = process.argv[2] || 'BTCTMN';
const DAYS = parseInt(process.argv[3], 10) || 7;
const RESOLUTION = '15';

async function fetchKlines(symbol, days) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 24 * 3600;
  const url = `https://api.wallex.ir/v1/udf/history?symbol=${symbol}&resolution=${RESOLUTION}&from=${from}&to=${to}`;
  const r = await axios.get(url, { timeout: 15000 });
  return r.data;
}

function simulate(klines) {
  const closes = klines.c.map(Number);
  const times = klines.t;

  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const macdArr = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });

  const rsiOffset = closes.length - rsiArr.length;
  const macdOffset = closes.length - macdArr.length;

  let cash = 5_000_000;
  let qty = 0;
  let avgPrice = 0;
  let trades = 0;
  let wins = 0;
  let losses = 0;

  for (let i = 50; i < closes.length; i++) {
    const price = closes[i];
    const rsi = rsiArr[i - rsiOffset];
    const macd = macdArr[i - macdOffset]?.histogram;
    if (!Number.isFinite(rsi) || !Number.isFinite(macd)) continue;

    // SELL checks first (stop-loss / take-profit / signal)
    if (qty > 0) {
      const pnlPct = (price - avgPrice) / avgPrice;
      const stopHit = pnlPct <= -config.STOP_LOSS_PCT;
      const tp = pnlPct >= config.TAKE_PROFIT_PCT;
      if (stopHit || tp) {
        const proceeds = qty * price;
        cash += proceeds;
        if (pnlPct > 0) wins++; else losses++;
        trades++;
        qty = 0; avgPrice = 0;
        continue;
      }
    }

    // BUY signal
    if (qty === 0 && rsi < 50 && macd > 0) {
      const invest = Math.min(cash, config.MAX_TRADE_TOMAN);
      if (invest >= config.MIN_TRADE_TOMAN) {
        qty = invest / price;
        avgPrice = price;
        cash -= invest;
      }
    }
  }

  // Force close at last price
  if (qty > 0) {
    const price = closes[closes.length - 1];
    cash += qty * price;
    const pnlPct = (price - avgPrice) / avgPrice;
    if (pnlPct > 0) wins++; else losses++;
    trades++;
    qty = 0;
  }

  const finalValue = cash;
  const returnPct = ((finalValue - 5_000_000) / 5_000_000) * 100;

  return {
    symbol: SYMBOL,
    days: DAYS,
    resolution: RESOLUTION,
    bars: closes.length,
    trades,
    wins,
    losses,
    winRate: trades > 0 ? ((wins / trades) * 100).toFixed(1) + '%' : '-',
    finalValue: finalValue.toFixed(0),
    returnPct: returnPct.toFixed(2) + '%',
  };
}

(async () => {
  console.log(`📊 Backtesting ${SYMBOL} over ${DAYS} days @ ${RESOLUTION}m ...`);
  const klines = await fetchKlines(SYMBOL, DAYS);
  if (!klines || klines.s !== 'ok' || !klines.c?.length) {
    console.error('❌ Failed to fetch klines:', klines?.s);
    process.exit(1);
  }
  const result = simulate(klines);
  console.log(JSON.stringify(result, null, 2));
})();