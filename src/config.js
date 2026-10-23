require('dotenv').config();

function num(v, def) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
}

const config = {
  IS_LIVE: process.env.IS_LIVE_TRADING === 'true',
  SHADOW_MODE: process.env.SHADOW_MODE === 'true',

  SYMBOLS: (process.env.SYMBOLS || 'BTCTMN,ETHTMN,LTCTMN').split(',').map(s => s.trim()),

  MAX_TRADE_TOMAN: num(process.env.MAX_TRADE_TOMAN, 2500000),
  MIN_TRADE_TOMAN: num(process.env.MIN_TRADE_TOMAN, 100000),
  STOP_LOSS_PCT: num(process.env.STOP_LOSS_PCT, 0.02),
  TAKE_PROFIT_PCT: num(process.env.TAKE_PROFIT_PCT, 0.025),
  MAX_POSITIONS_PER_SYMBOL: num(process.env.MAX_POSITIONS_PER_SYMBOL, 1),

  CHALLENGE_END: process.env.CHALLENGE_END_ISO
    ? new Date(process.env.CHALLENGE_END_ISO)
    : null,
  FORCE_CLOSE_MIN_MS: num(process.env.FORCE_CLOSE_MINUTES_BEFORE_END, 10) * 60 * 1000,

  ORDER_MONITOR_RETRIES: num(process.env.ORDER_MONITOR_RETRIES, 10),
  ORDER_MONITOR_DELAY_MS: num(process.env.ORDER_MONITOR_DELAY_MS, 2000),

  AI_MODEL: process.env.AI_MODEL || 'gpt-4o-mini',

  CYCLE_INTERVAL_MS: 60000,
  PRICE_STALE_MS: 15000,
};

module.exports = config;