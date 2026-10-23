const fs = require('fs');
const path = require('path');

const textLogPath = path.join(process.cwd(), 'trades_log.txt');
const jsonLogPath = path.join(process.cwd(), 'trades_log.jsonl');

function logDecision(symbol, action, reason, price, extra = {}) {
  const now = new Date();
  const tsFa = now.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });

  const entry = {
    ts: now.toISOString(),
    ts_fa: tsFa,
    symbol,
    action,
    price: Number.isFinite(price) ? price : null,
    reason,
    ...extra,
  };

  // JSON line for machine parsing
  try {
    fs.appendFileSync(jsonLogPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('logger json write failed:', e.message);
  }

  // Human readable
  const rsi = extra.rsi ?? '-';
  const macd = extra.macd ?? '-';
  const line = `[${tsFa}] ${symbol} | ${action} | price=${price} | RSI=${rsi} | MACD=${macd} | ${reason}\n`;
  try {
    fs.appendFileSync(textLogPath, line, 'utf8');
  } catch (e) {
    console.error('logger text write failed:', e.message);
  }

  console.log(`📝 ${action} ${symbol} — ${reason}`);
}

module.exports = { logDecision };
