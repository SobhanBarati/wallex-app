const axios = require('axios');
require('dotenv').config();
const config = require('../config');

const wallexClient = axios.create({
  baseURL: 'https://api.wallex.ir',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.WALLEX_API_KEY || '',
  },
  timeout: 8000,
});

async function getBalance() {
  try {
    const r = await wallexClient.get('/v1/account/balances');
    return r.data;
  } catch (e) {
    console.error('getBalance error:', e.message);
    return null;
  }
}

async function getOrderBook(symbol) {
  try {
    const r = await wallexClient.get(`/v1/depth?symbol=${symbol}`);
    return r.data;
  } catch (e) {
    console.error(`getOrderBook(${symbol}) error:`, e.message);
    return null;
  }
}

async function getKlines(symbol, resolution = '15', limit = 100) {
  try {
    const to = Math.floor(Date.now() / 1000);
    const from = to - limit * parseInt(resolution, 10) * 60;
    const r = await wallexClient.get(
      `/v1/udf/history?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}`
    );
    return r.data;
  } catch (e) {
    console.error(`getKlines(${symbol}) error:`, e.message);
    return null;
  }
}

// Returns { status: 'SUCCESS'|'DEFINITIVE_REJECT'|'AMBIGUOUS', orderId? }
async function submitOrderSafely(symbol, side, quantity, price, type = 'MARKET') {
  if (config.SHADOW_MODE) {
    console.log(`🧪 [SHADOW] ${side} ${symbol} qty=${quantity} type=${type}`);
    return { status: 'SUCCESS', orderId: `shadow-${Date.now()}`, shadow: true };
  }

  try {
    const payload = { symbol, side, quantity: String(quantity), type };
    if (type === 'LIMIT') payload.price = String(price);

    const r = await wallexClient.post('/v1/account/orders', payload);
    const body = r.data;

    if (body && body.success) {
      const orderId = body.result?.clientOrderId || body.result?.id;
      if (orderId) return { status: 'SUCCESS', orderId };
      return { status: 'AMBIGUOUS', raw: body };
    }
    return { status: 'AMBIGUOUS', raw: body };
  } catch (e) {
    const code = e.response?.status;
    if (code >= 400 && code < 500) {
      console.error(`⚠️ رد قطعی سفارش ${symbol}: ${e.response.data?.message || e.message}`);
      return { status: 'DEFINITIVE_REJECT', message: e.response.data?.message };
    }
    console.error(`⚠️ خطای نامعلوم سفارش ${symbol}: ${e.message}`);
    return { status: 'AMBIGUOUS' };
  }
}

// Returns { status, execPrice, execQty }
async function monitorOrderLifecycle(orderId, maxRetries, delayMs) {
  const retries = maxRetries ?? config.ORDER_MONITOR_RETRIES;
  const delay = delayMs ?? config.ORDER_MONITOR_DELAY_MS;

  if (String(orderId).startsWith('shadow-')) {
    return { status: 'UNKNOWN_SHADOW', execPrice: 0, execQty: 0 };
  }

  let lastExecQty = 0;
  let lastExecPrice = 0;

  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, delay));
    try {
      const r = await wallexClient.get(`/v1/account/orders/${orderId}`);
      const o = r.data?.result;
      if (!o) continue;

      lastExecQty = parseFloat(o.executedQty ?? o.executedQuantity ?? 0) || 0;
      lastExecPrice = parseFloat(o.executedPrice ?? o.averagePrice ?? 0) || 0;
      const st = o.status;

      if (st === 'FILLED' || st === 'PARTIALLY_FILLED_AND_CANCELED') {
        return {
          status: st === 'FILLED' ? 'SUCCESS' : 'PARTIAL_SUCCESS',
          execPrice: lastExecPrice,
          execQty: lastExecQty,
        };
      }
      if (['REJECTED', 'CANCELED', 'EXPIRED'].includes(st)) {
        return {
          status: lastExecQty > 0 ? 'PARTIAL_SUCCESS' : 'CANCELED_NO_FILL',
          execPrice: lastExecPrice,
          execQty: lastExecQty,
        };
      }
    } catch (_) {
      /* keep retrying */
    }
  }

  console.error(`🚨 سفارش ${orderId} معلق ماند. تلاش برای لغو...`);
  try {
    await wallexClient.delete(`/v1/account/orders/${orderId}`);
    await new Promise(r => setTimeout(r, 2000));
    const r = await wallexClient.get(`/v1/account/orders/${orderId}`);
    const o = r.data?.result;
    if (o) {
      const eq = parseFloat(o.executedQty ?? o.executedQuantity ?? 0) || 0;
      const ep = parseFloat(o.executedPrice ?? o.averagePrice ?? 0) || 0;
      if (['REJECTED', 'CANCELED', 'EXPIRED'].includes(o.status)) {
        return {
          status: eq > 0 ? 'PARTIAL_SUCCESS' : 'CANCELED_NO_FILL',
          execPrice: ep,
          execQty: eq,
        };
      }
    }
  } catch (_) {}

  return { status: 'UNKNOWN', execPrice: lastExecPrice, execQty: lastExecQty };
}

module.exports = {
  getBalance,
  getOrderBook,
  getKlines,
  submitOrderSafely,
  monitorOrderLifecycle,
};
