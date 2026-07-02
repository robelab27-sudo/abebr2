// ============================================================================
// Minimal CSV encode/decode — no external dependency. Handles quoted fields
// containing commas, quotes, or newlines (RFC 4180 style).
// ============================================================================

export const TRADE_CSV_FIELDS = [
  'pair', 'direction', 'entry_date', 'exit_date', 'entry_price', 'exit_price',
  'stop_loss', 'take_profit', 'lot_size', 'rr', 'session', 'strategy',
  'net_profit', 'trade_status', 'notes',
];

function escapeCsvField(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function tradesToCSV(trades) {
  const header = TRADE_CSV_FIELDS.join(',');
  const rows = trades.map((trade) => TRADE_CSV_FIELDS.map((field) => escapeCsvField(trade[field])).join(','));
  return [header, ...rows].join('\n');
}

/** Parses CSV text into an array of plain objects keyed by the header row. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
    return obj;
  });
}

/** Coerces raw imported field strings into the right types for a trade record. */
export function normalizeImportedTrade(raw) {
  const numeric = ['entry_price', 'exit_price', 'stop_loss', 'take_profit', 'lot_size', 'rr', 'net_profit'];
  const trade = { ...raw };
  for (const field of numeric) {
    if (trade[field] === '' || trade[field] === undefined || trade[field] === null) trade[field] = null;
    else trade[field] = Number(trade[field]);
  }
  trade.pair = (trade.pair || '').toString().trim().toUpperCase();
  trade.direction = (trade.direction || 'buy').toString().toLowerCase();
  trade.trade_status = trade.trade_status || 'closed';
  trade.gross_profit = trade.gross_profit !== undefined ? trade.gross_profit : trade.net_profit;
  trade.source = 'csv_import';
  return trade;
}

export function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
