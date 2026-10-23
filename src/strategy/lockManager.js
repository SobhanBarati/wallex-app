const path = require('path');
const { safeRead, safeWrite } = require('../utils/fileSafe');

const lockFilePath = path.join(process.cwd(), 'orders_lock.json');
const SUBMITTING_TTL_MS = 5 * 60 * 1000; // 5 minutes
const PENDING_STALE_MS = 60 * 60 * 1000; // 1 hour

function lockSymbol(symbol, status, orderId, side, reason) {
  const locks = safeRead(lockFilePath);
  locks[symbol] = { status, orderId, side, reason, timestamp: Date.now() };
  safeWrite(lockFilePath, locks);
  console.warn(`🔒 ${symbol} locked — status=${status} side=${side}`);
}

function unlockSymbol(symbol) {
  const locks = safeRead(lockFilePath);
  if (locks[symbol]) {
    delete locks[symbol];
    safeWrite(lockFilePath, locks);
    console.log(`🔓 ${symbol} unlocked`);
  }
}

function getLockInfo(symbol) {
  const locks = safeRead(lockFilePath);
  const info = locks[symbol] || null;
  if (!info) return null;

  const age = Date.now() - (info.timestamp || 0);
  if (info.status === 'SUBMITTING' && age > SUBMITTING_TTL_MS) {
    console.warn(`⏰ Stale SUBMITTING lock for ${symbol} (${Math.round(age / 1000)}s), auto-clearing`);
    delete locks[symbol];
    safeWrite(lockFilePath, locks);
    return null;
  }
  if (info.status === 'PENDING' && age > PENDING_STALE_MS) {
    console.warn(`⏰ Stale PENDING lock for ${symbol}, auto-clearing`);
    delete locks[symbol];
    safeWrite(lockFilePath, locks);
    return null;
  }
  return info;
}

function isLocked(symbol) {
  return getLockInfo(symbol) !== null;
}

module.exports = { lockSymbol, unlockSymbol, isLocked, getLockInfo };
