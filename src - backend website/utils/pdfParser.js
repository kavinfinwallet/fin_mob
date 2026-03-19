const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const fs = require('fs');

const parsePDF = async (filePath, password = null) => {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const options = password ? { password: password } : {};
    const data = await pdfParse(dataBuffer, options);
    
    // Extract text from PDF
    const text = data.text;
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // Find transaction table (S No. column optional; fallback to other common headers)
    const tableInfo = findTransactionTable(lines);
    
    if (!tableInfo) {
      throw new Error('Could not find transaction table in PDF');
    }
    
    // Extract transactions from the table
    const transactions = extractTransactionsFromTable(lines, tableInfo);
    
    return {
      text,
      transactions,
      tableInfo: {
        headerRow: tableInfo.headerRow,
        startIndex: tableInfo.startIndex,
        columns: tableInfo.columns
      },
      metadata: {
        pages: data.numpages,
        info: data.info
      }
    };
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to parse PDF: ' + error.message);
  }
};

// Common transaction table header keywords (S No. is optional)
const TRANSACTION_HEADER_KEYWORDS = [
  'date', 'value date', 'transaction date', 'value',
  'description', 'narration', 'remarks', 'particulars', 'details',
  'debit', 'credit', 'amount', 'balance', 'dr', 'cr',
  's.no', 's no', 'sno', 'serial no', 'sl no', 'sr no',
  'type', 'chq', 'ref', 'cheque', 'reference'
];

// Find the transaction table (S No. column optional)
const findTransactionTable = (lines) => {
  // Strategy 1: Look for header row containing S No. column
  const tableWithSNo = findTableBySNo(lines);
  if (tableWithSNo) return tableWithSNo;

  // Strategy 2: Look for header row with other common transaction columns (Date, Description, Amount, etc.)
  return findTableByCommonHeaders(lines);
};

// Find table by S No. column (optional)
const findTableBySNo = (lines) => {
  const sNoPatterns = [
    /^s\s*\.?\s*no\.?/i,
    /^sno\.?/i,
    /^serial\s+no\.?/i,
    /^sl\s*\.?\s*no\.?/i,
    /^sr\s*\.?\s*no\.?/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasSNo = sNoPatterns.some(pattern => pattern.test(line));
    if (hasSNo) {
      const columns = parseTableHeader(line);
      if (columns && columns.length > 0) {
        return { startIndex: i, headerRow: line, columns };
      }
    }
  }
  return null;
};

// Find table by common transaction column headers (no S No. required)
const findTableByCommonHeaders = (lines) => {
  const headerPattern = new RegExp(
    TRANSACTION_HEADER_KEYWORDS.filter(k => k.length > 2).join('|'),
    'i'
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const columns = parseTableHeader(line);
    if (!columns || columns.length < 2) continue;

    // Count how many columns look like transaction headers
    const matchCount = columns.filter(col => {
      const lower = col.toLowerCase().trim();
      return TRANSACTION_HEADER_KEYWORDS.some(kw => lower.includes(kw) || kw.includes(lower));
    }).length;

    // Require at least 2 matching columns (e.g. Date + Description, or Date + Amount)
    if (matchCount >= 2) {
      return { startIndex: i, headerRow: line, columns };
    }
  }
  return null;
};

// Parse table header to identify column names
const parseTableHeader = (headerLine) => {
  // Split by multiple spaces or tabs (typical table delimiter)
  const parts = headerLine.split(/\s{2,}|\t/).filter(p => p.trim().length > 0);
  
  if (parts.length < 2) {
    // Try splitting by single space and look for common patterns
    const words = headerLine.split(/\s+/);
    const columns = [];
    let currentColumn = '';
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i].toLowerCase();
      
      // Check if this word starts a new column (common column keywords)
      if (word.match(/^(s\.?no|sno|serial|sl\.?no|sr\.?no|date|value|transaction|description|narration|remarks|particulars|debit|credit|amount|balance|type|chq|ref|cheque|reference)/i)) {
        if (currentColumn) {
          columns.push(currentColumn.trim());
        }
        currentColumn = words[i];
      } else {
        currentColumn += ' ' + words[i];
      }
    }
    
    if (currentColumn) {
      columns.push(currentColumn.trim());
    }
    
    return columns.length > 0 ? columns : null;
  }
  
  return parts;
};

// Extract transactions from the identified table
const extractTransactionsFromTable = (lines, tableInfo) => {
  const transactions = [];
  const { startIndex, columns } = tableInfo;
  
  // Create column name mapping (column name -> column index)
  const columnNameMap = {};
  columns.forEach((colName, index) => {
    columnNameMap[colName] = `column_${index}`;
    // Also create a reverse mapping for lookup
    columnNameMap[`column_${index}`] = colName;
  });
  
  // Start from the row after header
  let currentRowIndex = startIndex + 1;
  
  // Patterns to identify end of table
  const endPatterns = [
    /^total/i,
    /^grand\s+total/i,
    /^balance\s+brought\s+forward/i,
    /^balance\s+carried\s+forward/i,
    /^page\s+\d+/i,
    /^statement\s+period/i
  ];
  
  while (currentRowIndex < lines.length) {
    const line = lines[currentRowIndex];
    
    // Check if we've reached the end of the table
    if (endPatterns.some(pattern => pattern.test(line))) {
      break;
    }
    
    // Skip empty lines or lines that don't look like transaction rows
    if (!line || line.length < 5) {
      currentRowIndex++;
      continue;
    }
    
    // Parse the transaction row with column names
    const transaction = parseTransactionRow(line, columns, columnNameMap);
    
    if (transaction && transaction.date) {
      transactions.push(transaction);
    }
    
    currentRowIndex++;
  }
  
  return transactions;
};

// Parse a single transaction row
const parseTransactionRow = (rowLine, columnNames, columnNameMap) => {
  // Try splitting by multiple spaces first (most common in PDF tables)
  let parts = rowLine.split(/\s{2,}|\t/).filter(p => p.trim().length > 0);
  
  // If that doesn't work well, try more sophisticated parsing
  if (parts.length < 3) {
    // Try to identify columns by looking for patterns
    parts = parseRowByPatterns(rowLine);
  }
  
  if (parts.length < 2) {
    return null;
  }
  
  // Map parts to transaction object - flat format (properties directly)
  const transaction = {};
  
  // Map each part to its corresponding column name - store directly as properties
  for (let i = 0; i < parts.length && i < columnNames.length; i++) {
    const part = parts[i].trim();
    const columnName = columnNames[i];
    
    // Store directly by column name (flat format)
    transaction[columnName] = part;
  }
  
  return transaction;
};

// Parse row by looking for common patterns
const parseRowByPatterns = (rowLine) => {
  const parts = [];
  let currentPart = '';
  let inNumber = false;
  
  // Date pattern
  const datePattern = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/;
  // Amount pattern (numbers with possible commas and decimal)
  const amountPattern = /[\d,]+\.?\d*/;
  
  // Find dates and amounts first
  const dates = [...rowLine.matchAll(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/g)];
  const amounts = [...rowLine.matchAll(/([\d,]+\.?\d*)/g)];
  
  // Split by dates and amounts
  let lastIndex = 0;
  const segments = [];
  
  // Add date segments
  dates.forEach(match => {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', start: lastIndex, end: match.index, content: rowLine.substring(lastIndex, match.index) });
    }
    segments.push({ type: 'date', start: match.index, end: match.index + match[0].length, content: match[0] });
    lastIndex = match.index + match[0].length;
  });
  
  // Add remaining text
  if (lastIndex < rowLine.length) {
    segments.push({ type: 'text', start: lastIndex, end: rowLine.length, content: rowLine.substring(lastIndex) });
  }
  
  // Extract parts from segments
  segments.forEach(segment => {
    if (segment.type === 'date') {
      parts.push(segment.content);
    } else {
      // Try to split text by amounts
      const textAmounts = [...segment.content.matchAll(/([\d,]+\.?\d*)/g)];
      let textStart = 0;
      
      textAmounts.forEach(amt => {
        const beforeAmount = segment.content.substring(textStart, amt.index).trim();
        if (beforeAmount) {
          parts.push(beforeAmount);
        }
        parts.push(amt[0]);
        textStart = amt.index + amt[0].length;
      });
      
      const remaining = segment.content.substring(textStart).trim();
      if (remaining) {
        parts.push(remaining);
      }
    }
  });
  
  return parts.filter(p => p.trim().length > 0);
};

const detectColumns = (transactions, tableInfo = null) => {
  if (transactions.length === 0) return null;
  
  const detectedColumns = {
    date: null,
    description: null,
    amount: null,
    type: null,
    credit: null,
    debit: null
  };
  
  // If we have table info with column names, use that
  if (tableInfo && tableInfo.columns && tableInfo.columns.length > 0) {
    const columns = tableInfo.columns.map(col => col.toLowerCase());
    
    // Map known column patterns
    columns.forEach((col, index) => {
      const colKey = `column_${index}`;
      
      // Date column
      if (!detectedColumns.date && /date|value\s+date|transaction\s+date/i.test(col)) {
        detectedColumns.date = colKey;
      }
      // Description column
      else if (!detectedColumns.description && /description|narration|remarks|particulars|details|transaction\s+details/i.test(col)) {
        detectedColumns.description = colKey;
      }
      // Amount column
      else if (!detectedColumns.amount && /amount|transaction\s+amount|balance/i.test(col)) {
        detectedColumns.amount = colKey;
      }
      // Credit column
      else if (!detectedColumns.credit && /credit|deposit|cr/i.test(col) && !/debit/i.test(col)) {
        detectedColumns.credit = colKey;
      }
      // Debit column
      else if (!detectedColumns.debit && /debit|withdrawal|dr/i.test(col) && !/credit/i.test(col)) {
        detectedColumns.debit = colKey;
      }
      // Type column (fallback for combined type columns)
      else if (!detectedColumns.type && /type|dr\/cr|debit\/credit/i.test(col)) {
        detectedColumns.type = colKey;
      }
    });
  }
  
  // Fallback: analyze transaction rawData
  if (!detectedColumns.date || !detectedColumns.description || !detectedColumns.amount) {
    const sample = transactions.slice(0, Math.min(5, transactions.length));
    const firstTransaction = sample[0];
    
    if (firstTransaction && firstTransaction.rawData) {
      // Find date column
      if (!detectedColumns.date) {
        for (const [key, value] of Object.entries(firstTransaction.rawData)) {
          if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(value)) {
            detectedColumns.date = key;
            break;
          }
        }
      }
      
      // Find amount column
      if (!detectedColumns.amount) {
        for (const [key, value] of Object.entries(firstTransaction.rawData)) {
          if (key !== 'date' && /^[\d,]+\.?\d*$/.test(String(value).replace(/[^\d,.]/g, ''))) {
            detectedColumns.amount = key;
            break;
          }
        }
      }
      
      // Find description column (usually the longest text field)
      if (!detectedColumns.description) {
        let longestKey = null;
        let longestLength = 0;
        for (const [key, value] of Object.entries(firstTransaction.rawData)) {
          if (key !== 'date' && key !== 'amount' && key !== 'sNo' && typeof value === 'string') {
            if (value.length > longestLength) {
              longestLength = value.length;
              longestKey = key;
            }
          }
        }
        if (longestKey) {
          detectedColumns.description = longestKey;
        }
      }
    }
    
    // Final fallback to direct properties
    if (!detectedColumns.date && firstTransaction.date) detectedColumns.date = 'date';
    if (!detectedColumns.description && firstTransaction.description) detectedColumns.description = 'description';
    if (!detectedColumns.amount && firstTransaction.amount) detectedColumns.amount = 'amount';
    if (!detectedColumns.type && firstTransaction.type) detectedColumns.type = 'type';
  }
  
  return detectedColumns;
};

module.exports = {
  parsePDF,
  detectColumns
};

