// ============================================================================
// Pure functions that turn a list of trade records into the numbers the
// dashboard (and later, the full Statistics page) displays. No I/O here —
// everything takes plain data in and returns plain data out, so it's easy
// to unit test and reuse across pages.
// ============================================================================

function isClosed(trade) {
  return !trade.deleted_at && trade.trade_status === 'closed' && typeof trade.net_profit === 'number';
}

function tradeSortKey(trade) {
  return `${trade.exit_date || trade.entry_date || ''}T${trade.exit_time || trade.entry_time || '00:00:00'}`;
}

export function computeAdvancedStats(trades) {
  const closed = trades.filter(isClosed).sort((a, b) => tradeSortKey(a).localeCompare(tradeSortKey(b)));
  if (closed.length === 0) return null;

  const wins = closed.filter((t) => t.net_profit > 0);
  const losses = closed.filter((t) => t.net_profit < 0);
  const grossProfit = wins.reduce((s, t) => s + t.net_profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.net_profit, 0));
  const netProfit = grossProfit - grossLoss;

  const winRate = (wins.length / closed.length) * 100;
  const lossRate = (losses.length / closed.length) * 100;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const largestWin = wins.reduce((max, t) => Math.max(max, t.net_profit), 0);
  const largestLoss = losses.reduce((min, t) => Math.min(min, t.net_profit), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const rrValues = closed.map((t) => t.rr).filter((v) => typeof v === 'number');
  const avgRR = rrValues.length > 0 ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : 0;
  const expectancy = (winRate / 100) * avgWin - (lossRate / 100) * avgLoss;

  // Max drawdown in dollars, for recovery factor.
  let running = 0, peak = 0, maxDDAmount = 0;
  for (const t of closed) {
    running += t.net_profit;
    peak = Math.max(peak, running);
    maxDDAmount = Math.max(maxDDAmount, peak - running);
  }
  const recoveryFactor = maxDDAmount > 0 ? netProfit / maxDDAmount : (netProfit > 0 ? Infinity : 0);

  // Sharpe / Sortino, computed on daily aggregated P&L (annualized, 252 trading days).
  const dailyMap = new Map();
  for (const t of closed) {
    const day = t.exit_date || t.entry_date;
    dailyMap.set(day, (dailyMap.get(day) || 0) + t.net_profit);
  }
  const dailyReturns = [...dailyMap.values()];
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);
  const downsideReturns = dailyReturns.filter((r) => r < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((sum, r) => sum + r ** 2, 0) / downsideReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVariance);
  const sharpeRatio = stdDev > 0 ? (mean / stdDev) * Math.sqrt(252) : 0;
  const sortinoRatio = downsideDev > 0 ? (mean / downsideDev) * Math.sqrt(252) : 0;

  // Streaks, walked chronologically. Breakeven trades (net_profit === 0) break a streak without starting a new one.
  let longestWinStreak = 0, longestLossStreak = 0, winRun = 0, lossRun = 0;
  for (const t of closed) {
    if (t.net_profit > 0) { winRun++; lossRun = 0; }
    else if (t.net_profit < 0) { lossRun++; winRun = 0; }
    else { winRun = 0; lossRun = 0; }
    longestWinStreak = Math.max(longestWinStreak, winRun);
    longestLossStreak = Math.max(longestLossStreak, lossRun);
  }
  let currentStreak = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const t = closed[i];
    if (i === closed.length - 1) { currentStreak = t.net_profit > 0 ? 1 : t.net_profit < 0 ? -1 : 0; continue; }
    if (currentStreak > 0 && t.net_profit > 0) currentStreak++;
    else if (currentStreak < 0 && t.net_profit < 0) currentStreak--;
    else break;
  }

  const bestWorst = (keyFn) => {
    const map = new Map();
    for (const t of closed) {
      const key = keyFn(t) || 'Unspecified';
      map.set(key, (map.get(key) || 0) + t.net_profit);
    }
    const entries = [...map.entries()];
    if (entries.length === 0) return { best: null, worst: null };
    entries.sort((a, b) => b[1] - a[1]);
    return { best: entries[0], worst: entries[entries.length - 1] };
  };

  const pairBW = bestWorst((t) => t.pair);
  const strategyBW = bestWorst((t) => t.strategy);
  const sessionBW = bestWorst((t) => t.session);
  const monthBW = bestWorst((t) => (t.entry_date || '').slice(0, 7));

  const holdingTimes = closed
    .filter((t) => t.entry_date && t.exit_date)
    .map((t) => {
      const start = new Date(`${t.entry_date}T${t.entry_time || '00:00:00'}`);
      const end = new Date(`${t.exit_date}T${t.exit_time || '00:00:00'}`);
      const hours = (end - start) / (1000 * 60 * 60);
      return hours >= 0 ? hours : null;
    })
    .filter((h) => h !== null);
  const avgHoldingHours = holdingTimes.length > 0 ? holdingTimes.reduce((a, b) => a + b, 0) / holdingTimes.length : null;

  return {
    winRate, lossRate, avgRR, largestWin, largestLoss, avgWin, avgLoss, profitFactor,
    recoveryFactor, expectancy, sharpeRatio, sortinoRatio,
    longestWinStreak, longestLossStreak, currentStreak,
    bestPair: pairBW.best, worstPair: pairBW.worst,
    bestStrategy: strategyBW.best, worstStrategy: strategyBW.worst,
    bestSession: sessionBW.best, worstSession: sessionBW.worst,
    bestMonth: monthBW.best, worstMonth: monthBW.worst,
    avgHoldingHours,
    totalTrades: closed.length,
  };
}

export function computeDashboardStats(trades, startingBalance = 0) {
  const closed = trades.filter(isClosed).sort((a, b) => tradeSortKey(a).localeCompare(tradeSortKey(b)));

  const wins = closed.filter((t) => t.net_profit > 0);
  const losses = closed.filter((t) => t.net_profit < 0);
  const breakeven = closed.filter((t) => t.net_profit === 0);

  const grossProfit = wins.reduce((sum, t) => sum + t.net_profit, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.net_profit, 0));
  const netProfit = grossProfit - grossLoss;
  const currentBalance = startingBalance + netProfit;

  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const largestWin = wins.reduce((max, t) => Math.max(max, t.net_profit), 0);
  const largestLoss = losses.reduce((min, t) => Math.min(min, t.net_profit), 0);
  const rrValues = closed.map((t) => t.rr).filter((v) => typeof v === 'number');
  const avgRR = rrValues.length > 0 ? rrValues.reduce((a, b) => a + b, 0) / rrValues.length : 0;

  // Equity curve + drawdown, walked chronologically from the starting balance.
  const equityCurve = [{ date: null, balance: startingBalance }];
  let runningBalance = startingBalance;
  let peak = startingBalance;
  let maxDrawdownPct = 0;
  for (const trade of closed) {
    runningBalance += trade.net_profit;
    peak = Math.max(peak, runningBalance);
    const drawdownPct = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
    equityCurve.push({ date: trade.exit_date || trade.entry_date, balance: runningBalance });
  }
  const currentDrawdownPct = peak > 0 ? ((peak - runningBalance) / peak) * 100 : 0;

  // Grouped breakdowns for the pair/session charts.
  const groupSum = (keyFn) => {
    const map = new Map();
    for (const trade of closed) {
      const key = keyFn(trade) || 'Unspecified';
      map.set(key, (map.get(key) || 0) + trade.net_profit);
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setDate(startOfDay.getDate() - startOfDay.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const sumSince = (cutoff) =>
    closed
      .filter((t) => new Date(t.exit_date || t.entry_date) >= cutoff)
      .reduce((sum, t) => sum + t.net_profit, 0);

  const recentTrades = [...closed].reverse().slice(0, 8);

  return {
    startingBalance,
    currentBalance,
    netProfit,
    grossProfit,
    grossLoss,
    todayProfit: sumSince(startOfDay),
    weeklyProfit: sumSince(startOfWeek),
    monthlyProfit: sumSince(startOfMonth),
    yearlyProfit: sumSince(startOfYear),
    winRate,
    profitFactor,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    avgRR,
    maxDrawdownPct,
    currentDrawdownPct,
    totalTrades: closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    breakevenTrades: breakeven.length,
    equityCurve,
    profitByPair: groupSum((t) => t.pair),
    profitBySession: groupSum((t) => t.session),
    recentTrades,
  };
}
