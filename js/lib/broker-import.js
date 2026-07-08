// ============================================================================
// Broker/platform-specific import parsers. Each broker exports trade history
// in its own shape; these functions normalize each into the app's canonical
// trade object (same shape tradesRepo.create() expects) so the rest of the
// import pipeline (dedupe, insert) never needs to know which broker a file
// came from.
//
// Add a new broker by adding a detector + parser here and wiring it into
// parseImportFile() at the bottom.
// ============================================================================

import { parseCSV, normalizeImportedTrade } from './csv.js';

function splitIsoDateTime(iso) {
  // "2025-09-05T15:12:13.924" -> { date: "2025-09-05", time: "15:12:13" }
  if (!iso) return { date: null, time: null };
  const [datePart, timePart = ''] = String(iso).split('T');
  const time = timePart.split('.')[0]; // drop milliseconds
  return { date: datePart || null, time: time || null };
}

function splitMt5DateTime(mt5dt) {
  // "2026.05.08 06:00:45" -> { date: "2026-05-08", time: "06:00:45" }
  if (!mt5dt) return { date: null, time: null };
  const [datePart, timePart] = String(mt5dt).split(' ');
  return { date: datePart ? datePart.replace(/\./g, '-') : null, time: timePart || null };
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// MatchTrader — "Closed Positions" CSV export
// Header: ID,Symbol,Open time,Volume,Side,Close time,Open price,Close Price,
//         Stop loss,Take profit,Swap,Commission,Profit,Reason
// ---------------------------------------------------------------------------
export function isMatchTraderCsv(headerLine) {
  const h = headerLine.toLowerCase();
  return h.includes('open time') && h.includes('close time') && h.includes('side') && h.includes('symbol');
}

export function parseMatchTraderCsv(csvText) {
  const rows = parseCSV(csvText);
  return rows
    .filter((r) => r['Symbol'] && r['Open time'])
    .map((r) => {
      const entry = splitIsoDateTime(r['Open time']);
      const exit = splitIsoDateTime(r['Close time']);
      const commission = toNumberOrNull(r['Commission']) || 0;
      const swap = toNumberOrNull(r['Swap']) || 0;
      const grossProfit = toNumberOrNull(r['Profit']) || 0;

      return {
        pair: (r['Symbol'] || '').trim().toUpperCase(),
        direction: (r['Side'] || 'buy').toLowerCase(),
        entry_date: entry.date,
        entry_time: entry.time,
        exit_date: exit.date,
        exit_time: exit.time,
        entry_price: toNumberOrNull(r['Open price']),
        exit_price: toNumberOrNull(r['Close Price']),
        stop_loss: toNumberOrNull(r['Stop loss']),
        take_profit: toNumberOrNull(r['Take profit']),
        lot_size: toNumberOrNull(r['Volume']),
        position_size: toNumberOrNull(r['Volume']),
        commission,
        swap,
        gross_profit: grossProfit,
        net_profit: grossProfit + commission + swap,
        trade_status: 'closed',
        notes: r['Reason'] ? `Close reason: ${r['Reason']}` : '',
        source: 'csv_import',
      };
    });
}

// ---------------------------------------------------------------------------
// MT5 — "Trade History Report" .xlsx export (Terminal -> History tab ->
// Report). Only the "Positions" section is imported — it already contains
// one row per closed position with entry+exit price/time and net profit,
// which is exactly what the journal needs (the Orders/Deals sections below
// it are more granular and not needed here).
// ---------------------------------------------------------------------------
export function parseMt5Xlsx(arrayBuffer) {
  if (typeof XLSX === 'undefined') {
    throw new Error('Spreadsheet reader failed to load. Check your internet connection and try again.');
  }
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

  const positionsHeaderIdx = rows.findIndex((r) => String(r[0]).trim() === 'Positions');
  if (positionsHeaderIdx === -1) {
    throw new Error('This doesn\'t look like an MT5 "Trade History Report" export — no "Positions" section found.');
  }

  const trades = [];
  // Data starts two rows after the "Positions" label (label row, then column header row, then data).
  for (let i = positionsHeaderIdx + 2; i < rows.length; i++) {
    const row = rows[i];
    const positionId = row[1];
    const symbol = row[2];
    // Stop at the first row that doesn't look like a position data row
    // (this is how we detect the end of the section, e.g. hitting "Orders").
    if (typeof positionId !== 'number' || !symbol || typeof symbol !== 'string') break;

    const openTime = splitMt5DateTime(row[0]);
    const closeTime = splitMt5DateTime(row[8]);
    const commission = toNumberOrNull(row[10]) || 0;
    const swap = toNumberOrNull(row[11]) || 0;
    const grossProfit = toNumberOrNull(row[12]) || 0;

    trades.push({
      mt5_ticket: String(positionId),
      pair: String(symbol).trim().toUpperCase(),
      direction: String(row[3] || 'buy').toLowerCase(),
      entry_date: openTime.date,
      entry_time: openTime.time,
      exit_date: closeTime.date,
      exit_time: closeTime.time,
      entry_price: toNumberOrNull(row[5]),
      exit_price: toNumberOrNull(row[9]),
      stop_loss: toNumberOrNull(row[6]),
      take_profit: toNumberOrNull(row[7]),
      lot_size: toNumberOrNull(row[4]),
      position_size: toNumberOrNull(row[4]),
      commission,
      swap,
      gross_profit: grossProfit,
      net_profit: grossProfit + commission + swap,
      trade_status: 'closed',
      source: 'csv_import',
    });
  }

  return trades;
}

// ---------------------------------------------------------------------------
// Unified entry point used by the Trade History import button.
// ---------------------------------------------------------------------------
export async function parseImportFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    return { format: 'MT5', trades: parseMt5Xlsx(buffer) };
  }

  if (name.endsWith('.json')) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const trades = Array.isArray(parsed) ? parsed : (parsed.trades || []);
    return { format: 'JSON', trades };
  }

  // .csv — sniff the header line to pick the right mapper.
  const text = await file.text();
  const firstLine = text.split(/\r?\n/, 1)[0] || '';

  if (isMatchTraderCsv(firstLine)) {
    return { format: 'MatchTrader', trades: parseMatchTraderCsv(text) };
  }

  // Fall back to the app's own export format.
  const trades = parseCSV(text).map(normalizeImportedTrade);
  return { format: 'Ledger CSV', trades };
}
