require('dotenv').config();
const express = require('express');
const { RSI, MACD } = require('technicalindicators');

const config = require('./config');
const {
  getBalance, getOrderBook, getKlines,
  submitOrderSafely, monitorOrderLifecycle,
} = require('./services/wallexApi');
const { getTradeSignal } = require('./services/aiBoxApi');
const { calculateSafeBuyQuantity, calculateSafeSellQuantity } = require('./strategy/riskManager');
const { connectToWallexWS, getLivePrice } = require('./services/wallexWs');
const {
  getPosition, updatePosition, markReconciliationRequired,
  clearReconciliation, syncWithRealBalance,
} = require('./strategy/positionManager');
const { lockSymbol, unlockSymbol, isLocked, getLockInfo } = require('./strategy/lockManager');
const { logDecision } = require('./utils/logger');

// ---------------- Express health ----------------
const app = express();
app.get('/', (req, res) => res.json({ status: 'Online', mode: config.SHADOW_MODE ? 'shadow' : config.IS_LIVE ? 'live' : 'dry' }));
app.listen(process.env.PORT || 8080, () => console.log('🌐 Health server up'));

// ---------------- Bootstrap ----------------
console.log(`🚀 Engine starting — mode=${config.SHADOW_MODE ? 'SHADOW' : config.IS_LIVE ? 'LIVE' : 'DRY'}`);
console.log(`Symbols: ${config.SYMBOLS.join(', ')}`);
connectToWallexWS(config.SYMBOLS);

// ---------------- Helpers ----------------
function isDeadlineApproaching() {
  if (!config.CHALLENGE_END) return false;
  const msLeft = config.CHALLENGE_END.getTime() - Date.now();
  return msLeft > 0 && msLeft <= config.FORCE_CLOSE_MIN_MS;
}

function isPastDeadline() {
  return config.CHALLENGE_END && Date.now() > config.CHALLENGE_END.getTime();
}

function parseBalances(balance) {
  const out = {};
  const list = balance?.result?.balances;
  if (!list) return out;
  for (const [k, v] of Object.entries(list)) {
    const free = parseFloat(v?.value ?? v?.free ?? 0) || 0;
    const locked = parseFloat(v?.locked ?? 0) || 0;
    out[k] = { free, locked, total: free + locked };
  }
  return out;
}

function computeIndicators(klines) {
  const closes = klines?.c?.map(Number) || [];
  if (closes.length < 35 || !closes.every(p => Number.isFinite(p) && p > 0)) return null;

  const rsiArr = RSI.calculate({ values: closes, period: 14 });
  const macdArr = MACD.calculate({
    values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
    SimpleMAOscillator: false, SimpleMASignal: false,
  });
  const rsi = rsiArr[rsiArr.length - 1];
  const macd = macdArr[macdArr.length - 1];

  if (!Number.isFinite(rsi) || !Number.isFinite(macd?.histogram)) return null;
  return {
    rsi,
    macdHist: macd.histogram,
    trend: rsi > 70 ? 'اشباع خرید' : rsi < 30 ? 'اشباع فروش' : 'خنثی',
  };
}

async function executeOrder({ symbol, side, qty, price, baseAsset, freeBase, freeQuote }) {
  if (!Number.isFinite(qty) || qty <= 0) return;

  lockSymbol(symbol, 'SUBMITTING', null, side, `submit ${side}`);
  const submit = await submitOrderSafely(symbol, side, qty, price, 'MARKET');

  if (submit.status === 'DEFINITIVE_REJECT') {
    unlockSymbol(symbol);
    return;
  }

  if (submit.status === 'AMBIGUOUS') {
    console.warn(`⚠️ ${symbol} order ambiguous — will reconcile next cycle`);
    return;
  }

  lockSymbol(symbol, 'PENDING', submit.orderId, side, `monitor ${side}`);

  if (submit.shadow) {
    try { updatePosition(symbol, price, qty, side); } catch (e) {}
    unlockSymbol(symbol);
    logDecision(symbol, side, `[SHADOW] simulated fill`, price, { shadow: true, qty });
    return;
  }

  const res = await monitorOrderLifecycle(submit.orderId);
  if ((res.status === 'SUCCESS' || res.status === 'PARTIAL_SUCCESS') && res.execQty > 0 && res.execPrice > 0) {
    try { updatePosition(symbol, res.execPrice, res.execQty, side); unlockSymbol(symbol); } catch (e) {}
  } else if (res.status === 'CANCELED_NO_FILL') {
    unlockSymbol(symbol);
  }
}

// ---------------- Main loop ----------------
let cycleRunning = false;

async function runTradingCycle() {
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    console.log(`\n--- cycle @ ${new Date().toISOString()} ---`);
    const balance = await getBalance();
    if (!balance) return;
    const balances = parseBalances(balance);

    const forceClose = isDeadlineApproaching();
    if (forceClose) {
      console.warn("🚨 DEADLINE APPROACHING: Force closing ALL positions to Toman!");
    }

    for (const symbol of config.SYMBOLS) {
      try {
        await processSymbol(symbol, balances, forceClose);
      } catch (e) {
        console.error(`❌ ${symbol} cycle error: ${e.message}`);
      }
    }
  } finally {
    cycleRunning = false;
    if (!isPastDeadline()) {
      setTimeout(runTradingCycle, config.CYCLE_INTERVAL_MS);
    } else {
      console.log('🛑 Deadline passed — engine stopping');
    }
  }
}

async function processSymbol(symbol, balances, forceClose) {
  const [depth, klines] = await Promise.all([ getOrderBook(symbol), getKlines(symbol, '15') ]);
  if (!depth || !klines || klines.s !== 'ok') return;

  let currentPrice = getLivePrice(symbol) || parseFloat(depth?.result?.bid?.[0]?.price);
  if (!currentPrice) return;

  const baseAsset = symbol.replace(/(TMN|USDT)$/, '');
  const quoteAsset = symbol.endsWith('TMN') ? 'TMN' : 'USDT';
  const freeBase = balances[baseAsset]?.free ?? 0;
  const totalBase = freeBase + (balances[baseAsset]?.locked ?? 0);
  const freeQuote = balances[quoteAsset]?.free ?? 0;

  syncWithRealBalance(symbol, totalBase);
  const pos = getPosition(symbol);
  if (pos?.status === 'RECONCILIATION_REQUIRED') return;

  const hasPosition = totalBase > 0.000001;

  if (isLocked(symbol)) {
    const info = getLockInfo(symbol);
    if (info?.status === 'PENDING' && info.orderId) {
      const res = await monitorOrderLifecycle(info.orderId);
      if ((res.status === 'SUCCESS' || res.status === 'PARTIAL_SUCCESS') && res.execQty > 0) {
        try { updatePosition(symbol, res.execPrice, res.execQty, info.side); unlockSymbol(symbol); } catch (e) {}
      } else if (res.status === 'CANCELED_NO_FILL') unlockSymbol(symbol);
    }
    return;
  }

  const ind = computeIndicators(klines);
  if (!ind) return;

  let decision = { action: 'HOLD', reason: 'default' };

  if (isPastDeadline()) return;

  if (forceClose && hasPosition) {
    decision = { action: 'SELL', reason: 'تصفیه اجباری پیش از پایان چالش' };
  } else if (hasPosition && ind.rsi > 70) {
    decision = { action: 'SELL', reason: 'RSI بالای 70 (اشباع خرید) — فروش برای حفظ سود' };
  } else if (hasPosition && currentPrice <= (pos?.avgPrice || 0) * (1 - config.STOP_LOSS_PCT)) {
    decision = { action: 'SELL', reason: 'فعال شدن حد ضرر' };
  } else if (hasPosition && currentPrice >= (pos?.avgPrice || 0) * (1 + config.TAKE_PROFIT_PCT)) {
    decision = { action: 'SELL', reason: 'فعال شدن حد سود' };
  } else {
    const ai = await getTradeSignal({
      symbol, bestBid: depth?.result?.bid?.[0]?.price ?? 0, bestAsk: depth?.result?.ask?.[0]?.price ?? 0,
      freeQuote, freeBase, techData: { rsi: ind.rsi.toFixed(2), macdHist: ind.macdHist.toFixed(2), trend: ind.trend },
      avgBuyPrice: pos?.avgPrice || 0, minNotional: config.MIN_TRADE_TOMAN,
    });
    decision = ai;

    if (decision.action === 'BUY' && (ind.rsi >= 50 || ind.macdHist <= 0)) {
      decision = { action: 'HOLD', reason: 'veto: RSI/MACD خرید را تایید نکرد' };
    }
    if (decision.action === 'BUY' && hasPosition) {
      decision = { action: 'HOLD', reason: 'veto: پوزیشن باز' };
    }
    if (decision.action === 'SELL' && !hasPosition) {
      decision = { action: 'HOLD', reason: 'veto: پوزیشنی برای فروش نیست' };
    }
  }

  logDecision(symbol, decision.action, decision.reason, currentPrice, {
    rsi: ind.rsi.toFixed(2), macd: ind.macdHist.toFixed(2), hasPosition, freeQuote, freeBase,
  });
  console.log(`[DEBUG] Decision for ${symbol}: ${decision.action} — ${decision.reason}`);

  if (!config.IS_LIVE && !config.SHADOW_MODE) return;

  if (decision.action === 'BUY' && !hasPosition) {
    const qty = calculateSafeBuyQuantity(freeQuote, currentPrice);
    if (qty > 0) await executeOrder({ symbol, side: 'BUY', qty, price: currentPrice, baseAsset, freeBase, freeQuote });
  } else if (decision.action === 'SELL' && hasPosition) {
    const qty = calculateSafeSellQuantity(freeBase);
    if (qty > 0) await executeOrder({ symbol, side: 'SELL', qty, price: currentPrice, baseAsset, freeBase, freeQuote });
    else console.warn(`⚠️ ${symbol} couldn't sell because freeBase=0 (maybe locked)`);
  }
}

// ---------------- Start ----------------
setTimeout(runTradingCycle, 5000);