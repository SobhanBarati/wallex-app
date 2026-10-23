const path = require('path');
const { safeRead, safeWrite } = require('../utils/fileSafe');

const stateFilePath = path.join(process.cwd(), 'positions_state.json');
const EPS = 0.000001;

function getPosition(symbol) {
  return safeRead(stateFilePath)[symbol] || null;
}

function updatePosition(symbol, execPrice, execQty, side) {
  if (!Number.isFinite(execQty) || execQty <= 0 || !Number.isFinite(execPrice) || execPrice <= 0) {
    throw new Error(`Invalid exec values for ${symbol}: price=${execPrice}, qty=${execQty}`);
  }

  const positions = safeRead(stateFilePath);
  if (!positions[symbol]) positions[symbol] = { avgPrice: 0, totalQty: 0, status: 'TRACKED' };
  const cur = positions[symbol];

  if (side === 'BUY') {
    const newQty = cur.totalQty + execQty;
    const newAvg = (cur.avgPrice * cur.totalQty + execPrice * execQty) / newQty;
    positions[symbol] = { avgPrice: newAvg, totalQty: newQty, status: 'TRACKED' };
  } else if (side === 'SELL') {
    if (execQty > cur.totalQty + EPS) {
      throw new Error(`SELL qty ${execQty} > local ${cur.totalQty} for ${symbol}`);
    }
    const remaining = cur.totalQty - execQty;
    if (remaining <= EPS) delete positions[symbol];
    else positions[symbol].totalQty = remaining;
  }
  safeWrite(stateFilePath, positions);
}

function markReconciliationRequired(symbol) {
  const positions = safeRead(stateFilePath);
  if (!positions[symbol]) positions[symbol] = { avgPrice: 0, totalQty: 0 };
  positions[symbol].status = 'RECONCILIATION_REQUIRED';
  safeWrite(stateFilePath, positions);
}

function clearReconciliation(symbol) {
  const positions = safeRead(stateFilePath);
  if (positions[symbol]) {
    positions[symbol].status = 'TRACKED';
    safeWrite(stateFilePath, positions);
  }
}

/**
 * Reconcile local state with real exchange balance.
 * Auto-heal rules:
 *  - local > 0, real = 0   → mark RECONCILIATION_REQUIRED (human review)
 *  - local > 0, real > 0   → if diff > EPS, update totalQty to real (keep avg), status TRACKED
 *  - local = 0, real > 0   → create with avg=0, status RECONCILIATION_REQUIRED (unknown avg)
 */
function syncWithRealBalance(symbol, realCryptoBalance) {
  const positions = safeRead(stateFilePath);
  const cur = positions[symbol];
  const localQty = cur ? cur.totalQty : 0;
  const real = Number(realCryptoBalance) || 0;

  if (real <= EPS && localQty <= EPS) return { synced: true, mismatch: false };

  if (real <= EPS && localQty > EPS) {
    markReconciliationRequired(symbol);
    return { synced: false, mismatch: true, reason: 'local_has_but_exchange_empty' };
  }

  if (real > EPS && localQty <= EPS) {
    positions[symbol] = {
      avgPrice: cur?.avgPrice || 0,
      totalQty: real,
      status: 'RECONCILIATION_REQUIRED',
    };
    safeWrite(stateFilePath, positions);
    return { synced: false, mismatch: true, reason: 'exchange_has_but_local_empty' };
  }

  // both > 0
  if (Math.abs(real - localQty) > EPS) {
    const newAvg = cur.avgPrice > 0 ? cur.avgPrice : 0;
    positions[symbol] = { avgPrice: newAvg, totalQty: real, status: 'TRACKED' };
    safeWrite(stateFilePath, positions);
    return { synced: true, mismatch: true, reason: 'qty_corrected' };
  }

  return { synced: true, mismatch: false };
}

module.exports = {
  getPosition,
  updatePosition,
  markReconciliationRequired,
  clearReconciliation,
  syncWithRealBalance,
};
