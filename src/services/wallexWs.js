const WebSocket = require('ws');
const config = require('../config');

const livePrices = {};
let ws = null;
let hbTimer = null;
const subscribedSymbols = [];

function connectToWallexWS(symbolsArray) {
  subscribedSymbols.length = 0;
  subscribedSymbols.push(...symbolsArray);

  const url = 'wss://api.wallex.ir/connection/websocket';
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('⚡ Wallex WebSocket connected');
    ws.send(JSON.stringify({ id: 1, connect: {} }));
    ws.send(JSON.stringify({ id: 2, subscribe: { channel: 'public:all@price' } }));

    clearInterval(hbTimer);
    hbTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('{}');
    }, 25000);
  });

  ws.on('message', (data) => {
    const s = data.toString();
    if (s === '{}') return;

    let msg;
    try { msg = JSON.parse(s); } catch { return; }

    if (msg.push?.channel === 'public:all@price') {
      const d = msg.push.pub?.data;
      if (!d) return;
      if (!subscribedSymbols.includes(d.symbol)) return;

      const p = parseFloat(d.price);
      if (!Number.isFinite(p) || p <= 0) return;

      livePrices[d.symbol] = { price: p, timestamp: Date.now() };
    }
  });

  ws.on('close', (code) => {
    console.log(`🔴 WebSocket closed (${code}) — reconnecting in 3s`);
    clearInterval(hbTimer);
    setTimeout(() => connectToWallexWS(subscribedSymbols), 3000);
  });

  ws.on('error', (err) => console.error('❌ WebSocket error:', err.message));
}

function getLivePrice(symbol) {
  const d = livePrices[symbol];
  if (!d) return null;
  if (Date.now() - d.timestamp > config.PRICE_STALE_MS) {
    console.warn(`⚠️ Stale price for ${symbol}`);
    return null;
  }
  return d.price;
}

module.exports = { connectToWallexWS, getLivePrice };