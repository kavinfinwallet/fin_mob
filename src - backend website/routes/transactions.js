const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const authenticate = require('../middleware/auth');
const { parsePDF, detectColumns } = require('../utils/pdfParser');
const { parsePDFWithFastAPI, tabulaExtractData } = require('../utils/fastApiPdfParser');
const { categorizeTransactions } = require('../utils/categorizer');
const { transformTransactions } = require('../utils/transactionTransformer');

const router = express.Router();

/**
 * Normalize date string to ISO (YYYY-MM-DD) for PostgreSQL.
 * Accepts any parseable date format: YYYY-MM-DD, DD/MM/YY, DD.MM.YYYY, DD-MM-YY,
 * DD-MMM-YYYY, ISO with time, and native Date parse. Returns null only when
 * the value is not parseable as a valid date.
 */
function toISODate(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  // Already ISO (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YY, DD-MM-YY, or DD.MM.YYYY (slash, dash, or dot)
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (!m) m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (m) {
    const [, d, month, year] = m;
    const y = year.length === 2 ? `20${year}` : year;
    const dd = d.padStart(2, '0');
    const mm = month.padStart(2, '0');
    const iso = `${y}-${mm}-${dd}`;
    if (isValidISODate(iso)) return iso;
  }
  // ISO with time (e.g. 2025-12-13T00:00:00.000Z)
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch && isValidISODate(isoMatch[0])) return isoMatch[0];
  // DD-MMM-YYYY or DD-MMM-YY (e.g. 01-Dec-2025, 1-Jan-25)
  const mmmMonths = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mmmMatch = s.match(/^(\d{1,2})-([a-z]{3})-(\d{2,4})$/i);
  if (mmmMatch) {
    const [, day, mmm, year] = mmmMatch;
    const monthNum = mmmMonths[mmm.toLowerCase()];
    if (monthNum) {
      const y = year.length === 2 ? `20${year}` : year;
      const dd = day.padStart(2, '0');
      const mm = String(monthNum).padStart(2, '0');
      const iso = `${y}-${mm}-${dd}`;
      if (isValidISODate(iso)) return iso;
    }
  }
  // Fallback: try native Date parse (handles DD MMM YYYY, MMM DD YYYY, etc.)
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const iso = `${y}-${mm}-${dd}`;
    if (isValidISODate(iso)) return iso;
  }
  return null;
}

function isValidISODate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(iso + 'T12:00:00Z');
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() === parseInt(iso.slice(0, 4), 10) && d.getUTCMonth() + 1 === parseInt(iso.slice(5, 7), 10) && d.getUTCDate() === parseInt(iso.slice(8, 10), 10);
}

/** Return calendar date as YYYY-MM-DD so clients never get timezone-shifted dates. */
function toCalendarDateString(val) {
  if (val == null) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return val.trim();
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  // Use local calendar components to avoid UTC day-shift for DATE columns.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Get one upload's detail + transactions for review (Admin / Team Lead)
// Uses /approval-detail/:id to avoid any conflict with GET /approvals
router.get('/approval-detail/:uploadId', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const isAdmin =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      req.user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only Admin or Team Lead can view approvals' });
    }
    const uploadId = parseInt(req.params.uploadId, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }
    const uploadRow = await pool.query(
      `SELECT u.id, u.user_id, u.status, c.name AS customer_name
       FROM uploads u
       LEFT JOIN customers c ON c.id = u.customer_id
       WHERE u.id = $1`,
      [uploadId]
    );
    if (uploadRow.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found', code: 'UPLOAD_NOT_FOUND' });
    }
    const upload = uploadRow.rows[0];
    const txnStatus = upload.status === 'completed' ? 'approved' : 'pending';
    const txResult = await pool.query(
      `SELECT t.id, t.date::text AS date, t.description, t.amount, t.type, t.category_id, t.category_name,
              c.name AS category_name_from_cat
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.user_id = $1 AND t.file_name = $2 AND t.status = $3
       ORDER BY (t.date::date) ASC NULLS LAST, t.id ASC`,
      [upload.user_id, `upload_${uploadId}`, txnStatus]
    );
    const transactions = txResult.rows.map((t) => ({
      id: t.id,
      date: toCalendarDateString(t.date) ?? t.date,
      description: t.description,
      amount: t.amount,
      type: t.type,
      categoryId: t.category_id,
      // Prefer master-joined name — it always matches availableCategories for correct group lookups
      categoryName: t.category_name_from_cat || t.category_name || 'Uncategorized',
    }));
    res.json({
      uploadId: upload.id,
      customerName: upload.customer_name || null,
      status: upload.status,
      transactions,
    });
  } catch (error) {
    console.error('Get approval detail error:', error);
    res.status(500).json({ message: 'Error fetching approval detail' });
  }
});

// Get transactions for one or more uploads. Same request flow for RM and TL: GET /uploads/transactions?upload_ids=...&status=approved
// (Analytics when specific uploads selected). TL (as Admin) can pass upload_ids from their dropdown (assigned RMs’ uploads).
router.get('/uploads/transactions', authenticate, async (req, res) => {
  try {
    const raw = req.query.upload_ids;
    const list = Array.isArray(raw) ? raw : (raw != null ? String(raw).split(',') : []);
    const ids = Array.from(
      new Set(
        list
          .map((v) => parseInt(String(v).trim(), 10))
          .filter((n) => Number.isFinite(n) && n > 0)
      )
    );

    if (ids.length === 0) {
      return res.status(400).json({ message: 'upload_ids is required', transactions: [] });
    }
    if (ids.length > 50) {
      return res.status(400).json({ message: 'Too many upload ids (max 50)', transactions: [] });
    }

    const statusRaw = (req.query.status || 'pending').toString().trim().toLowerCase();
    const status =
      statusRaw === 'approved' ? 'approved' :
      statusRaw === 'all' ? 'all' :
      'pending';

    const role = req.user.role;
    const isAdmin =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      req.user.is_super_admin;

    const uploadRows = await pool.query(
      isAdmin
        ? 'SELECT id, user_id FROM uploads WHERE id = ANY($1::int[])'
        : 'SELECT id, user_id FROM uploads WHERE id = ANY($1::int[]) AND user_id = $2',
      isAdmin ? [ids] : [ids, req.user.id]
    );

    const allowedIds = uploadRows.rows.map((r) => parseInt(r.id, 10)).filter(Boolean);
    if (allowedIds.length === 0) {
      return res.json({ transactions: [] });
    }

    const fileNames = allowedIds.map((id) => `upload_${id}`);
    const params = [fileNames];
    let where = 'WHERE t.file_name = ANY($1)';
    if (!isAdmin) {
      where += ' AND t.user_id = $2';
      params.push(req.user.id);
    }
    if (status !== 'all') {
      const pos = params.length + 1;
      where += ` AND t.status = $${pos}`;
      params.push(status);
    }

    const txResult = await pool.query(
      `SELECT 
         t.id,
         t.date::text AS date,
         t.description,
         t.amount,
         t.type,
         t.status,
         t.category_id,
         t.category_name,
         substring(t.file_name from 'upload_(\\d+)')::int as upload_id,
         c.name AS category_name_from_cat
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       ${where}
       ORDER BY (t.date::date) ASC NULLS LAST, t.id ASC`,
      params
    );

    const transactions = txResult.rows.map((t) => {
      const dateStr = toCalendarDateString(t.date);
      return {
        id: t.id,
        date: dateStr != null ? dateStr : t.date,
        description: t.description,
        amount: t.amount,
        type: t.type,
        status: t.status,
        uploadId: t.upload_id,
        category_id: t.category_id,
        category_name: t.category_name_from_cat || t.category_name || 'Uncategorized',
        categoryId: t.category_id,
        categoryName: t.category_name_from_cat || t.category_name || 'Uncategorized',
      };
    });

    // Date range of combined data (for analytics) — use calendar dates only
    let date_range = { min_date: null, max_date: null };
    if (transactions.length > 0) {
      const dateStrings = transactions
        .map((t) => t.date)
        .filter(Boolean)
        .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s).trim()));
      if (dateStrings.length > 0) {
        dateStrings.sort();
        date_range = {
          min_date: dateStrings[0],
          max_date: dateStrings[dateStrings.length - 1],
        };
      }
    }

    res.json({ transactions, date_range });
  } catch (error) {
    console.error('Get upload transactions error:', error);
    res.status(500).json({ message: 'Error fetching upload transactions', transactions: [] });
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

const excelUpload = multer({
  storage: storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv'
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PDF, Excel (.xlsx, .xls) or CSV allowed'));
  }
});

// Helper: parse period + income/goal safely from request body (PDF & Excel flows)
function extractUploadMeta(body) {
  const getInt = (val) => {
    if (val === undefined || val === null || val === '') return null;
    const n = parseInt(val, 10);
    return Number.isNaN(n) ? null : n;
  };
  const getDecimal = (val) => {
    if (val === undefined || val === null || val === '') return null;
    const n = parseFloat(val);
    return Number.isNaN(n) ? null : n;
  };

  const periodMonth = getInt(body.periodMonth ?? body.month);
  const periodYear = getInt(body.periodYear ?? body.year);
  const declaredIncome = getDecimal(body.declaredIncome ?? body.income);
  const goalAmount = getDecimal(body.goalAmount ?? body.goal);

  return { periodMonth, periodYear, declaredIncome, goalAmount };
}

// Upload PDF (now linked to a customer)
router.post('/upload', authenticate, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Get password from request body (multer puts multipart form fields in req.body)
    const passwordRaw = req.body.password != null ? req.body.password : (req.body.pdf_password != null ? req.body.pdf_password : null);
    const password = (passwordRaw !== '' && passwordRaw != null) ? String(passwordRaw).trim() : null;

    // Parse PDF using FastAPI service
    let parsedData;
    try {
      parsedData = await parsePDFWithFastAPI(req.file.path, password);
    } catch (fastApiError) {
      const isPasswordError = fastApiError.message && (
        fastApiError.message.toLowerCase().includes('password') ||
        fastApiError.message.toLowerCase().includes('encrypted') ||
        fastApiError.message.toLowerCase().includes('protected')
      );
      if (isPasswordError) {
        const message = password
          ? 'Invalid PDF password or could not decrypt. Please check the password and try again.'
          : 'This PDF is password protected. Please provide the password.';
        return res.status(400).json({
          message,
          requiresPassword: !password
        });
      }

      // Fallback to original parser if FastAPI fails
      console.warn('FastAPI parsing failed, falling back to original parser:', fastApiError.message);
      try {
        parsedData = await parsePDF(req.file.path, password);
      } catch (parseError) {
        const isPasswordErrorFallback = parseError.message && (
          parseError.message.toLowerCase().includes('password') ||
          parseError.message.toLowerCase().includes('encrypted') ||
          parseError.message.toLowerCase().includes('protected')
        );
        if (isPasswordErrorFallback) {
          const message = password
            ? 'Invalid PDF password or could not decrypt. Please check the password and try again.'
            : 'This PDF is password protected. Please provide the password.';
          return res.status(400).json({
            message,
            requiresPassword: !password
          });
        }
        throw parseError;
      }
    }
    
    // Transform transactions using Gemini
    let transformedTransactions = [];
    try {
      if (parsedData.transactions && parsedData.transactions.length > 0) {
        console.log('Transforming transactions using Gemini...');
        transformedTransactions = await transformTransactions(parsedData.transactions, req.user?.id);
        console.log(`Successfully transformed ${transformedTransactions.length} transactions`);
      } else {
        transformedTransactions = parsedData.transactions || [];
      }
    } catch (transformError) {
      console.error('Error transforming transactions:', transformError);
      // Continue with original transactions if transformation fails
      transformedTransactions = parsedData.transactions || [];
    }
    
    // Detect columns (pass tableInfo if available)
    const detectedColumns = detectColumns(transformedTransactions, parsedData.tableInfo);
    
    // Save upload record (linked to customer and user)
    const { customerId } = req.body;

    if (!customerId) {
      return res.status(400).json({ message: 'Customer is required for upload' });
    }

    const custCheck = await pool.query(
      'SELECT id, status FROM customers WHERE id = $1',
      [customerId]
    );
    if (custCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    if ((custCheck.rows[0].status || 'Active') !== 'Active') {
      return res.status(403).json({ message: 'Customer is disabled. Please select an active customer.' });
    }

    const { periodMonth, periodYear, declaredIncome, goalAmount } = extractUploadMeta(req.body || {});

    const uploadResult = await pool.query(
      `INSERT INTO uploads (
         user_id,
         customer_id,
         file_name,
         file_path,
         status,
         column_mapping,
         period_month,
         period_year,
         declared_income,
         goal_amount
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        req.user.id,
        customerId,
        req.file.originalname,
        req.file.path,
        'processing',
        JSON.stringify(detectedColumns),
        periodMonth,
        periodYear,
        declaredIncome,
        goalAmount,
      ]
    );

    // Get column names from FastAPI response or fallback to tableInfo
    const columnNames = parsedData.columns || parsedData.tableInfo?.columns || [];
    
    res.json({
      message: 'PDF uploaded and parsed successfully',
      uploadId: uploadResult.rows[0].id,
      transactions: transformedTransactions,
      detectedColumns: detectedColumns,
      tableInfo: parsedData.tableInfo,
      columnNames: columnNames, // Available columns from FastAPI for dropdown mapping
      metadata: parsedData.metadata
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Error processing PDF: ' + error.message });
  }
});

// Create upload record for tabula flow; frontend then calls save-mapped (same as PDF flow after upload)
router.post('/save-tabula-upload', authenticate, async (req, res) => {
  try {
    const { customerId, fileName, columns_mapping } = req.body;
    if (!customerId) {
      return res.status(400).json({ message: 'Customer is required' });
    }
    const custCheck = await pool.query(
      'SELECT id, status FROM customers WHERE id = $1',
      [customerId]
    );
    if (custCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    if ((custCheck.rows[0].status || 'Active') !== 'Active') {
      return res.status(403).json({ message: 'Customer is disabled. Please select an active customer.' });
    }
    const columnNames = columns_mapping && typeof columns_mapping === 'object'
      ? Object.values(columns_mapping).filter(Boolean)
      : [];

    const { periodMonth, periodYear, declaredIncome, goalAmount } = extractUploadMeta(req.body || {});

    const uploadResult = await pool.query(
      `INSERT INTO uploads (
         user_id,
         customer_id,
         file_name,
         file_path,
         status,
         column_mapping,
         period_month,
         period_year,
         declared_income,
         goal_amount
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        req.user.id,
        customerId,
        fileName || 'tabula-export.csv',
        '',
        'processing',
        JSON.stringify(columns_mapping || {}),
        periodMonth,
        periodYear,
        declaredIncome,
        goalAmount,
      ]
    );
    const uploadId = uploadResult.rows[0].id;
    res.json({
      uploadId,
      detectedColumns: columns_mapping || {},
      columnNames,
    });
  } catch (error) {
    console.error('Save tabula upload error:', error);
    res.status(500).json({ message: error.message || 'Error saving tabula upload' });
  }
});

// Upload Excel/CSV via FastAPI tabula-extract-data (Bank Statement Sheet flow via Node)
router.post('/upload-tabula', authenticate, excelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const { customerId } = req.body;
    if (!customerId) {
      return res.status(400).json({ message: 'Customer is required for upload' });
    }
    const custCheck = await pool.query(
      'SELECT id, status FROM customers WHERE id = $1',
      [customerId]
    );
    if (custCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    if ((custCheck.rows[0].status || 'Active') !== 'Active') {
      return res.status(403).json({ message: 'Customer is disabled. Please select an active customer.' });
    }

    const tabulaData = await tabulaExtractData(req.file.path, req.body.sheet_name || null);
    const rawTransactions = tabulaData.transactions || [];
    const columnsMapping = tabulaData.columns_mapping || {};

    const transformedTransactions = rawTransactions.map((txn) => {
      const amountNum = typeof txn.amount === 'number' ? txn.amount : parseFloat(txn.amount) || 0;
      const typeRaw = (txn.type || '').toString().toLowerCase();
      const isCredit = typeRaw === 'credit';
      const isDebit = typeRaw === 'debit';
      const creditAmount = isCredit ? amountNum : null;
      const debitAmount = isDebit ? amountNum : null;
      let transactionType = isCredit ? 'credit' : isDebit ? 'debit' : (amountNum >= 0 ? 'credit' : 'debit');
      return {
        date: txn.date,
        description: txn.description || '',
        amount: amountNum,
        type: transactionType,
        credit: creditAmount,
        debit: debitAmount,
        rawData: { ...txn },
      };
    });

    const columnNames = Object.values(columnsMapping).filter(Boolean);
    const detectedColumns = detectColumns(transformedTransactions, { columns: columnNames });

    const { periodMonth, periodYear, declaredIncome, goalAmount } = extractUploadMeta(req.body || {});

    const uploadResult = await pool.query(
      `INSERT INTO uploads (
         user_id,
         customer_id,
         file_name,
         file_path,
         status,
         column_mapping,
         period_month,
         period_year,
         declared_income,
         goal_amount
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        req.user.id,
        customerId,
        req.file.originalname,
        req.file.path,
        'processing',
        JSON.stringify(detectedColumns),
        periodMonth,
        periodYear,
        declaredIncome,
        goalAmount,
      ]
    );
    const uploadId = uploadResult.rows[0].id;

    res.json({
      message: 'File uploaded and extracted successfully',
      uploadId,
      transactions: transformedTransactions,
      detectedColumns,
      columnNames,
      tableInfo: { columns: columnNames },
      metadata: { totalTransactions: transformedTransactions.length },
    });
  } catch (error) {
    console.error('Upload tabula error:', error);
    const msg = error.response?.data?.detail || error.message;
    res.status(500).json({ message: msg || 'Error processing Excel/CSV file' });
  }
});

// Save column mapping
router.post('/column-mapping', authenticate, async (req, res) => {
  try {
    const { uploadId, columnMapping } = req.body;

    if (!uploadId || !columnMapping) {
      return res.status(400).json({ message: 'Upload ID and column mapping are required' });
    }

    // Update upload with column mapping and status
    await pool.query(
      'UPDATE uploads SET column_mapping = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4',
      [JSON.stringify(columnMapping), 'mapped', uploadId, req.user.id]
    );

    res.json({ message: 'Column mapping saved successfully' });
  } catch (error) {
    console.error('Column mapping error:', error);
    res.status(500).json({ message: 'Error saving column mapping' });
  }
});

// Map transactions using column mapping (without categorization)
router.post('/map-transactions', authenticate, async (req, res) => {
  try {
    const { uploadId, transactions, columnMapping } = req.body;

    if (!uploadId || !transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }

    // Map transactions using column mapping
    const mappedTransactions = transactions.map(t => {
      // Helper function to get value from transaction (check rawData first, then direct properties)
      const getValue = (key) => {
        if (!key) return null;
        // Check rawData first (for column_0, column_1, etc.)
        if (t.rawData && t.rawData[key]) {
          return t.rawData[key];
        }
        // Check direct properties
        if (t[key]) {
          return t[key];
        }
        return null;
      };
      
      // Get credit and debit values from mapped columns
      const creditValue = columnMapping.credit ? getValue(columnMapping.credit) : null;
      const debitValue = columnMapping.debit ? getValue(columnMapping.debit) : null;
      
      // Determine transaction type from credit/debit columns or amount
      let transactionType = '';
      if (creditValue && parseFloat(creditValue) > 0) {
        transactionType = 'credit';
      } else if (debitValue && parseFloat(debitValue) > 0) {
        transactionType = 'debit';
      } else {
        // Fallback: use old type column if available
        transactionType = getValue(columnMapping.type) || t.type || '';
        // If still no type, determine from amount
        if (!transactionType) {
          const amount = parseFloat(getValue(columnMapping.amount) || t.amount || 0);
          transactionType = amount >= 0 ? 'credit' : 'debit';
        }
      }
      
      const mapped = {
        date: getValue(columnMapping.date) || t.date || '',
        description: getValue(columnMapping.description) || t.description || t.remarks || '',
        amount: parseFloat(getValue(columnMapping.amount) || t.amount || 0),
        type: transactionType,
        credit: creditValue ? parseFloat(creditValue) : null,
        debit: debitValue ? parseFloat(debitValue) : null
      };
      
      // Preserve raw data for reference - keep original transaction structure
      // This preserves all original column names like "Transaction\nDate", "Particulars", etc.
      mapped.rawData = {};
      
      // First, copy existing rawData if it exists
      if (t.rawData) {
        Object.assign(mapped.rawData, t.rawData);
      }
      
      // Also preserve all original properties that aren't already mapped
      // This captures column names from API JSON like "Transaction\nDate", "Particulars", etc.
      Object.keys(t).forEach(key => {
        if (!['date', 'description', 'amount', 'type', 'credit', 'debit', 'raw', 'rawData', 'id', 'categoryId', 'categoryName', 'page'].includes(key)) {
          // Only add if not already in rawData
          if (!mapped.rawData[key]) {
            mapped.rawData[key] = t[key];
          }
        }
      });
      
      // If raw is a string, try to parse and merge it
      if (t.raw && typeof t.raw === 'string') {
        try {
          const parsedRaw = JSON.parse(t.raw);
          Object.assign(mapped.rawData, parsedRaw);
        } catch {
          // If parsing fails, ignore
        }
      } else if (t.raw && typeof t.raw === 'object') {
        Object.assign(mapped.rawData, t.raw);
      }
      
      // Also preserve raw as string for backward compatibility
      mapped.raw = t.raw || JSON.stringify(mapped.rawData || {});
      
      return mapped;
    });

    res.json({
      message: 'Transactions mapped successfully',
      transactions: mappedTransactions
    });
  } catch (error) {
    console.error('Map transactions error:', error);
    res.status(500).json({ message: 'Error mapping transactions' });
  }
});

// Save mapped transactions to database (after column mapping)
// Supports batching: when batchIndex is 0 or omitted, deletes existing pending for this upload then inserts.
// When batchIndex >= 1 (e.g. second/third batch), only inserts to avoid payload-too-large for 100+ transactions.
router.post('/save-mapped', authenticate, async (req, res) => {
  try {
    const { uploadId, transactions, batchIndex } = req.body;

    if (!uploadId || !transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }

    const isFirstBatch = batchIndex === undefined || batchIndex === 0;

    // Start transaction
    await pool.query('BEGIN');

    try {
      // Only on first batch: delete any existing pending transactions for this upload
      if (isFirstBatch) {
        await pool.query(
          'DELETE FROM transactions WHERE user_id = $1 AND status = $2 AND file_name = $3',
          [req.user.id, 'pending', `upload_${uploadId}`]
        );
      }

      // Insert mapped transactions with pending status
      for (const txn of transactions) {
        // Preserve rawData properly - prioritize rawData, then raw, then empty object
        let rawDataToStore = {};
        if (txn.rawData) {
          rawDataToStore = txn.rawData;
        } else if (txn.raw) {
          try {
            rawDataToStore = typeof txn.raw === 'string' ? JSON.parse(txn.raw) : txn.raw;
          } catch {
            rawDataToStore = {};
          }
        }
        // Normalize date to ISO (YYYY-MM-DD) so it works regardless of server DateStyle (MDY/DMY)
        const dateValue = toISODate(txn.date);
        if (!dateValue) {
          await pool.query('ROLLBACK');
          return res.status(400).json({
            message: 'Invalid date in transaction. The date could not be parsed.',
            invalidDate: txn.date
          });
        }

        await pool.query(
          `INSERT INTO transactions 
           (user_id, date, description, amount, type, status, file_name, raw_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            req.user.id,
            dateValue,
            txn.description,
            txn.amount,
            txn.type,
            'pending',
            `upload_${uploadId}`,
            JSON.stringify(rawDataToStore)
          ]
        );
      }

      await pool.query('COMMIT');

      res.json({ 
        message: 'Mapped transactions saved successfully',
        count: transactions.length
      });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Save mapped error:', error.message || error);
    if (error.code) console.error('Save mapped error code:', error.code);
    res.status(500).json({
      message: 'Error saving mapped transactions',
      ...(process.env.NODE_ENV !== 'production' && { detail: error.message })
    });
  }
});

// Helper to process a categorization job asynchronously
async function processCategorizationJob(jobId, userId, uploadId) {
  try {
    // Mark job as processing
    await pool.query(
      `UPDATE categorization_jobs
       SET status = $1, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      ['processing', jobId, userId]
    );

    // Load pending transactions for this upload
    const txResult = await pool.query(
      `SELECT *
       FROM transactions
       WHERE user_id = $1
         AND file_name = $2
         AND status = $3`,
      [userId, `upload_${uploadId}`, 'pending']
    );

    const dbTransactions = txResult.rows;

    if (!dbTransactions.length) {
      // Nothing to categorize, mark job as completed
      await pool.query(
        `UPDATE categorization_jobs
         SET status = $1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND user_id = $3`,
        ['completed', jobId, userId]
      );
      return;
    }

    const { categorizeTransactionsWithGemini, createCategoryIfNotExists } = require('../utils/geminiCategorizer');
    const { assignCategoriesFromExisting } = require('../utils/descriptionCategoryLookup');

    // Prepare transaction objects (same shape as before)
    const transactionsForGemini = dbTransactions.map((t) => {
      let rawDataObj = {};
      if (t.raw_data) {
        try {
          rawDataObj = typeof t.raw_data === 'string' ? JSON.parse(t.raw_data) : t.raw_data;
        } catch {
          rawDataObj = {};
        }
      }

      return {
        date: t.date,
        description: t.description,
        amount: t.amount,
        type: t.type,
        rawData: rawDataObj,
        raw: JSON.stringify(rawDataObj),
        categoryId: t.category_id,
        categoryName: t.category_name,
      };
    });

    // 1) Assign categories from existing DB descriptions; skip credit transactions (leave Uncategorized).
    //    Only debit transactions that don't match any existing description go to Gemini.
    const { categorized: fromDb, needGemini, needGeminiIndices } = await assignCategoriesFromExisting(
      transactionsForGemini,
      userId
    );

    // 2) Run Gemini only for debits that had no DB match
    let categorized = fromDb.slice();
    if (needGemini.length > 0) {
      const geminiResults = await categorizeTransactionsWithGemini(needGemini, userId);
      if (!geminiResults || geminiResults.length !== needGemini.length) {
        const got = (geminiResults && geminiResults.length) || 0;
        throw new Error(
          `Categorization incomplete: Gemini returned ${got} of ${needGemini.length} transactions.`
        );
      }
      for (let j = 0; j < needGeminiIndices.length; j++) {
        categorized[needGeminiIndices[j]] = geminiResults[j];
      }
    }

    // Defensive: replace any remaining nulls with Uncategorized (should not happen if Gemini returned correct count)
    const creditCount = transactionsForGemini.filter((t) => {
      const type = (t.type || '').toString().trim().toLowerCase();
      return ['credit', 'cr', 'deposit', 'incoming', 'refund', 'interest'].some((x) => type === x || type.includes(x));
    }).length;
    const fromDbCount = transactionsForGemini.length - creditCount - needGemini.length;
    console.log(
      `Categorization: ${transactionsForGemini.length} total, ${creditCount} credits (skipped), ${fromDbCount} matched (keyword/fuzzy), ${needGemini.length} sent to Gemini`
    );
    for (let i = 0; i < categorized.length; i++) {
      if (categorized[i] == null) {
        categorized[i] = {
          ...transactionsForGemini[i],
          category_name: 'Uncategorized',
          categoryName: 'Uncategorized',
          category_id: null,
          categoryId: null,
        };
      }
    }

    // Ensure rawData is preserved (same order as dbTransactions)
    const categorizedWithRawData = categorized.map((catTxn, index) => {
      const originalTxn = transactionsForGemini[index];
      const rawData = (catTxn && catTxn.rawData) || (originalTxn && originalTxn.rawData) || {};
      return {
        ...catTxn,
        rawData,
        raw: (catTxn && catTxn.raw) || (originalTxn && originalTxn.raw) || JSON.stringify(rawData),
      };
    });

    // Persist categorized data (support both camelCase from Gemini and snake_case from DB lookup)
    await pool.query('BEGIN');
    try {
      for (const txn of categorizedWithRawData) {
        let categoryId = txn.categoryId ?? txn.category_id ?? null;
        const categoryName = (txn.categoryName ?? txn.category_name ?? 'Uncategorized').trim() || 'Uncategorized';

        if (categoryName && categoryName !== 'Uncategorized' && !categoryId) {
          categoryId = await createCategoryIfNotExists(categoryName, userId);
        }

        await pool.query(
          `UPDATE transactions 
           SET category_id = $1,
               category_name = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $3 
             AND file_name = $4 
             AND date = $5 
             AND description = $6 
             AND amount = $7
             AND status = $8`,
          [
            categoryId,
            categoryName,
            userId,
            `upload_${uploadId}`,
            txn.date,
            txn.description,
            txn.amount,
            'pending',
          ]
        );
      }

      // Update upload status to categorized
      await pool.query(
        'UPDATE uploads SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
        ['categorized', uploadId, userId]
      );

      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }

    // Verify all transactions for this upload are categorized (have category_name set)
    const uncategorizedResult = await pool.query(
      `SELECT COUNT(*) AS count
       FROM transactions
       WHERE user_id = $1 AND file_name = $2
         AND (category_name IS NULL OR TRIM(COALESCE(category_name, '')) = '')`,
      [userId, `upload_${uploadId}`]
    );
    const uncategorizedCount = parseInt(uncategorizedResult.rows[0].count || '0', 10);
    if (uncategorizedCount > 0) {
      await pool.query(
        `UPDATE categorization_jobs
         SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND user_id = $4`,
        ['failed', `${uncategorizedCount} transaction(s) were not categorized. Consider the job failed.`, jobId, userId]
      );
      return;
    }

    // Mark job as completed only when all transactions are processed
    await pool.query(
      `UPDATE categorization_jobs
       SET status = $1, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      ['completed', jobId, userId]
    );
  } catch (error) {
    console.error('Categorization job error:', error);
    // Build a safe, truncated error message for the job (max 2000 chars)
    const rawMessage = error && (error.message || (error.response && error.response.data && error.response.data.message) || String(error));
    const errorMessage = (typeof rawMessage === 'string' ? rawMessage : String(error))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2000);
    try {
      await pool.query(
        `UPDATE categorization_jobs
         SET status = $1, error_message = $2, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3 AND user_id = $4`,
        ['failed', errorMessage || 'Categorization failed (Gemini or processing error).', jobId, userId]
      );
    } catch (updateErr) {
      console.error('Failed to update job status to failed:', updateErr);
      try {
        await pool.query(
          `UPDATE categorization_jobs
           SET status = $1, error_message = $2, updated_at = CURRENT_TIMESTAMP
           WHERE id = $3 AND user_id = $4`,
          ['failed', 'Categorization failed. See server logs.', jobId, userId]
        );
      } catch (e) {
        console.error('Could not mark categorization job as failed:', e);
      }
    }
  }
}

// Queue a categorization job for an upload
// If an existing job for this upload is in 'failed' status, resume it instead of creating a new one.
router.post('/categorize/queue', authenticate, async (req, res) => {
  try {
    const { uploadId } = req.body;

    if (!uploadId) {
      return res.status(400).json({ message: 'Upload ID is required' });
    }

    // Ensure upload exists and belongs to user
    const uploadResult = await pool.query(
      'SELECT id, file_name FROM uploads WHERE id = $1 AND user_id = $2',
      [uploadId, req.user.id]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }

    // Check for existing job for this upload (most recent first)
    const existingJobResult = await pool.query(
      `SELECT id, upload_id, user_id, status FROM categorization_jobs
       WHERE upload_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [uploadId, req.user.id]
    );

    if (existingJobResult.rows.length > 0) {
      const existing = existingJobResult.rows[0];

      if (existing.status === 'failed') {
        // Resume the failed job instead of creating a new one
        await pool.query(
          `UPDATE categorization_jobs
           SET status = $1, error_message = NULL, started_at = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND user_id = $3`,
          ['queued', existing.id, req.user.id]
        );

        setImmediate(() => {
          processCategorizationJob(existing.id, req.user.id, uploadId).catch((err) => {
            console.error('Background categorization job (resumed) failed:', err);
          });
        });

        return res.json({
          message: 'Resumed existing failed job for this upload',
          jobId: existing.id,
          resumed: true,
        });
      }

      if (existing.status === 'queued' || existing.status === 'processing') {
        return res.json({
          message: 'A job for this upload is already queued or in progress',
          jobId: existing.id,
          alreadyInProgress: true,
        });
      }
      // existing.status === 'completed' → fall through to create new job if needed (or we could disallow; for now allow new run)
    }

    // Count pending transactions for this upload
    const txCountResult = await pool.query(
      `SELECT COUNT(*) AS count
       FROM transactions
       WHERE user_id = $1
         AND file_name = $2
         AND status = $3`,
      [req.user.id, `upload_${uploadId}`, 'pending']
    );

    const totalTransactions = parseInt(txCountResult.rows[0].count || '0', 10);

    // Insert new job
    const jobInsert = await pool.query(
      `INSERT INTO categorization_jobs (upload_id, user_id, status, total_transactions)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [uploadId, req.user.id, 'queued', totalTransactions]
    );

    const jobId = jobInsert.rows[0].id;

    setImmediate(() => {
      processCategorizationJob(jobId, req.user.id, uploadId).catch((err) => {
        console.error('Background categorization job failed:', err);
      });
    });

    res.json({
      message: 'Categorization job queued',
      jobId,
    });
  } catch (error) {
    console.error('Queue categorization error:', error);
    res.status(500).json({ message: 'Error queueing categorization job' });
  }
});

// List categorization jobs for current user; REQUIRES ?customer_id= (customer-scoped, no unfiltered list)
router.get('/categorize/jobs', authenticate, async (req, res) => {
  try {
    const rawCustomerId = req.query.customer_id != null ? String(req.query.customer_id).trim() : null;
    const customerId = rawCustomerId ? parseInt(rawCustomerId, 10) : null;
    if (!rawCustomerId || Number.isNaN(customerId) || customerId <= 0) {
      return res.status(400).json({ message: 'customer_id is required', jobs: [] });
    }
    const custRow = await pool.query('SELECT id, status FROM customers WHERE id = $1', [customerId]);
    if (custRow.rows.length === 0 || (custRow.rows[0].status || 'Active') !== 'Active') {
      return res.status(403).json({ message: 'Customer is disabled or not found', jobs: [] });
    }

    const result = await pool.query(
      `SELECT 
        j.id,
        j.upload_id,
        j.status,
        j.total_transactions,
        j.created_at,
        j.started_at,
        j.completed_at,
        j.error_message,
        u.file_name,
        u.status AS upload_status
       FROM categorization_jobs j
       JOIN uploads u ON u.id = j.upload_id AND u.customer_id = $2
       WHERE j.user_id = $1
       ORDER BY j.created_at DESC`,
      [req.user.id, customerId]
    );

    res.json({ jobs: result.rows });
  } catch (error) {
    console.error('Get categorization jobs error:', error);
    res.status(500).json({ message: 'Error fetching categorization jobs' });
  }
});

// Retry a failed categorization job (same job, no new queue entry)
router.post('/categorize/jobs/:id/retry', authenticate, async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    if (Number.isNaN(jobId)) {
      return res.status(400).json({ message: 'Invalid job id' });
    }

    const result = await pool.query(
      `SELECT id, upload_id, user_id, status FROM categorization_jobs
       WHERE id = $1 AND user_id = $2`,
      [jobId, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Job not found' });
    }
    const job = result.rows[0];
    if (job.status !== 'failed') {
      return res.status(400).json({ message: 'Only failed jobs can be retried' });
    }

    await pool.query(
      `UPDATE categorization_jobs
       SET status = $1, error_message = NULL, started_at = NULL, completed_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3`,
      ['queued', jobId, req.user.id]
    );

    setImmediate(() => {
      processCategorizationJob(jobId, req.user.id, job.upload_id).catch((err) => {
        console.error('Background categorization job retry failed:', err);
      });
    });

    res.json({ message: 'Categorization restarted for this job', jobId });
  } catch (error) {
    console.error('Retry categorization job error:', error);
    res.status(500).json({ message: 'Error retrying categorization job' });
  }
});

// Get single categorization job
router.get('/categorize/jobs/:id', authenticate, async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);

    const result = await pool.query(
      `SELECT 
        j.id,
        j.upload_id,
        j.status,
        j.total_transactions,
        j.created_at,
        j.started_at,
        j.completed_at,
        j.error_message,
        u.file_name,
        u.status AS upload_status
       FROM categorization_jobs j
       JOIN uploads u ON u.id = j.upload_id
       WHERE j.user_id = $1 AND j.id = $2`,
      [req.user.id, jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Job not found' });
    }

    res.json({ job: result.rows[0] });
  } catch (error) {
    console.error('Get categorization job error:', error);
    res.status(500).json({ message: 'Error fetching categorization job' });
  }
});

// Save transactions (after approval) - Admin / Team Lead only
router.post('/save', authenticate, async (req, res) => {
  try {
    const { uploadId, transactions, keyObservation } = req.body;

    if (!uploadId || !transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }

    // Only Admin / Team Lead / Super Admin can perform final approval
    const role = req.user.role;
    const isAdmin =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      req.user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only Admin or Team Lead can approve transactions' });
    }

    const keyObsTrimmed = keyObservation != null ? String(keyObservation).trim().replace(/<[^>]*>/g, '').trim() : '';
    if (!keyObsTrimmed) {
      return res.status(400).json({ message: 'Key observation is required to approve' });
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      const { createCategoryIfNotExists } = require('../utils/geminiCategorizer');
      
      // Update existing pending transactions to approved status
      // Transactions should already exist from save-mapped step
      for (const txn of transactions) {
        let categoryId = txn.categoryId || null;
        const categoryName = txn.categoryName || 'Uncategorized';
        
        // If category name is provided but no ID, create or find category
        if (categoryName && categoryName !== 'Uncategorized' && !categoryId) {
          categoryId = await createCategoryIfNotExists(categoryName, req.user.id);
        }
        
        // Update existing transaction to approved status
        const updateResult = await pool.query(
          `UPDATE transactions 
           SET category_id = $1, 
               category_name = $2, 
               status = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $4 
             AND file_name = $5 
             AND date = $6 
             AND description = $7 
             AND amount = $8
             AND status = $9`,
          [
            categoryId,
            categoryName,
            'approved',
            req.user.id,
            `upload_${uploadId}`,
            txn.date,
            txn.description,
            txn.amount,
            'pending'
          ]
        );

        // If no transaction was updated, insert it (fallback)
        if (updateResult.rowCount === 0) {
          await pool.query(
            `INSERT INTO transactions 
             (user_id, date, description, amount, type, category_id, category_name, status, file_name, raw_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              req.user.id,
              txn.date,
              txn.description,
              txn.amount,
              txn.type,
              categoryId,
              categoryName,
              'approved',
              `upload_${uploadId}`,
              JSON.stringify(txn.raw || txn.rawData || {})
            ]
          );
        }
      }

      // Update upload status, key observation, clear rejection
      await pool.query(
        `UPDATE uploads 
         SET status = $1, approved_by = $2, 
             key_observation = COALESCE($4, key_observation),
             rejection_comment = NULL, rejected_at = NULL, rejected_by = NULL,
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $3`,
        ['completed', req.user.id, uploadId, keyObservation != null ? String(keyObservation).trim() : '']
      );

      await pool.query(
        `INSERT INTO upload_approval_audit (upload_id, action, by_user_id, comment) VALUES ($1, 'approved', $2, NULL)`,
        [uploadId, req.user.id]
      );

      await pool.query('COMMIT');

      res.json({ message: 'Transactions saved successfully' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ message: 'Error saving transactions' });
  }
});

// Submit transactions for approval (Relationship Manager)
router.post('/submit', authenticate, async (req, res) => {
  try {
    const { uploadId, transactions } = req.body;

    if (!uploadId || !transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ message: 'Invalid request data' });
    }

    // Start transaction
    await pool.query('BEGIN');

    try {
      const { createCategoryIfNotExists } = require('../utils/geminiCategorizer');

      // Update pending transactions with latest categories but keep status pending
      for (const txn of transactions) {
        let categoryId = txn.categoryId || null;
        const categoryName = txn.categoryName || 'Uncategorized';

        if (categoryName && categoryName !== 'Uncategorized' && !categoryId) {
          categoryId = await createCategoryIfNotExists(categoryName, req.user.id);
        }

        await pool.query(
          `UPDATE transactions 
           SET category_id = $1, 
               category_name = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $3 
             AND file_name = $4 
             AND date = $5 
             AND description = $6 
             AND amount = $7
             AND status = $8`,
          [
            categoryId,
            categoryName,
            req.user.id,
            `upload_${uploadId}`,
            txn.date,
            txn.description,
            txn.amount,
            'pending'
          ]
        );
      }

      // Check if resubmitting after rejection (for audit) – must read before updating status
      let wasRejected = false;
      try {
        const prev = await pool.query('SELECT status FROM uploads WHERE id = $1 AND user_id = $2', [uploadId, req.user.id]);
        wasRejected = prev.rows[0] && prev.rows[0].status === 'rejected';
      } catch (e) { /* ignore */ }

      // Mark upload as submitted for approval (minimal UPDATE so it works without optional columns)
      const updateResult = await pool.query(
        `UPDATE uploads 
         SET status = $1,
             submitted_for_approval = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND user_id = $3`,
        ['submitted', uploadId, req.user.id]
      );

      if (updateResult.rowCount === 0) {
        await pool.query('ROLLBACK');
        return res.status(404).json({ message: 'Upload not found or not owned by you' });
      }

      // Clear previous rejection when resubmitting (optional columns – may not exist on older DB)
      try {
        await pool.query(
          `UPDATE uploads 
           SET rejection_comment = NULL, rejected_at = NULL, rejected_by = NULL
           WHERE id = $1`,
          [uploadId]
        );
      } catch (e) {
        // Ignore if columns don't exist yet (run init.js to add them)
      }

      // Log to approval audit (optional table – may not exist on older DB)
      try {
        const action = wasRejected ? 'resubmitted' : 'submitted';
        const comment = wasRejected ? 'Resubmitted after rejection' : null;
        await pool.query(
          `INSERT INTO upload_approval_audit (upload_id, action, by_user_id, comment) VALUES ($1, $2, $3, $4)`,
          [uploadId, action, req.user.id, comment]
        );
      } catch (e) {
        // Ignore if table doesn't exist yet (run init.js to add it)
      }

      await pool.query('COMMIT');

      res.json({ message: 'Transactions submitted for approval' });
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Submit for approval error:', error);
    res.status(500).json({ message: 'Error submitting transactions for approval' });
  }
});

// Count uploads waiting for approval (Admin / Team Lead). Uses same logic as GET /approvals.
// Optional: customer_id (filter by customer). Count matches the "Wait for approval" list.
router.get('/approvals/waiting-count', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const isAdmin =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      req.user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only Admin or Team Lead can view approvals' });
    }
    const customerIdRaw = req.query.customer_id != null ? String(req.query.customer_id).trim() : null;
    const conditions = [];
    const params = [];
    let paramIndex = 1;
    if (customerIdRaw) {
      conditions.push(`u.customer_id = $${paramIndex}`);
      params.push(customerIdRaw);
      paramIndex += 1;
    }
    conditions.push(`u.status = 'submitted'`);
    const isTL = role === 'TEAM_LEAD';
    if (isTL) {
      conditions.push(`EXISTS (SELECT 1 FROM rm_tl_assignments a WHERE a.tl_id = $${paramIndex} AND a.rm_id = u.user_id)`);
      params.push(req.user.id);
      paramIndex += 1;
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // Same FROM/JOIN/GROUP BY/HAVING as GET /approvals so count matches the list
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM (
        SELECT u.id
        FROM uploads u
        LEFT JOIN transactions t ON t.file_name LIKE '%' || u.id || '%' AND t.user_id = u.user_id
        LEFT JOIN customers c ON c.id = u.customer_id
        LEFT JOIN users rm_user ON rm_user.id = u.user_id
        ${whereClause}
        GROUP BY u.id, u.file_name, u.status, u.column_mapping, u.period_month, u.period_year, u.declared_income, u.goal_amount, u.created_at, u.updated_at, u.customer_id, u.user_id, c.name, rm_user.name, rm_user.email
        HAVING COUNT(DISTINCT t.id) > 0 OR u.status IN ('completed', 'rejected')
      ) sub`,
      params
    );
    const count = countResult.rows[0]?.count ?? 0;
    res.json({ count });
  } catch (error) {
    console.error('Get waiting approval count error:', error);
    res.status(500).json({ message: 'Error fetching waiting approval count' });
  }
});

// Get one upload's detail + transactions for review (Admin / Team Lead)
router.get('/approvals/:uploadId', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const isAdmin =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      req.user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only Admin or Team Lead can view approvals' });
    }
    const uploadId = parseInt(req.params.uploadId, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }
    const uploadRow = await pool.query(
      `SELECT u.id, u.user_id, u.status, c.name AS customer_name
       FROM uploads u
       LEFT JOIN customers c ON c.id = u.customer_id
       WHERE u.id = $1`,
      [uploadId]
    );
    if (uploadRow.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found', code: 'UPLOAD_NOT_FOUND' });
    }
    const upload = uploadRow.rows[0];
    const txResult = await pool.query(
      `SELECT t.id, t.date::text AS date, t.description, t.amount, t.type, t.category_id, t.category_name,
              c.name AS category_name_from_cat
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = $1 AND t.file_name = $2 AND t.status = $3
       ORDER BY t.id`,
      [upload.user_id, `upload_${uploadId}`, 'pending']
    );
    const transactions = txResult.rows.map((t) => ({
      id: t.id,
      date: toCalendarDateString(t.date) ?? t.date,
      description: t.description,
      amount: t.amount,
      type: t.type,
      categoryId: t.category_id,
      categoryName: t.category_name || t.category_name_from_cat || 'Uncategorized',
    }));
    res.json({
      uploadId: upload.id,
      customerName: upload.customer_name || null,
      transactions,
    });
  } catch (error) {
    console.error('Get approval detail error:', error);
    res.status(500).json({ message: 'Error fetching approval detail' });
  }
});

// List uploads for approval (Admin / Team Lead). Optional: customer_id, period_month, period_year, tab (all|wait_for_approval|approved|rejected), page, limit, search
router.get('/approvals', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const isAdmin =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      req.user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only Admin or Team Lead can view approvals' });
    }

    const customerIdRaw = req.query.customer_id != null ? String(req.query.customer_id).trim() : null;
    const periodMonthRaw = req.query.period_month ?? req.query.periodMonth ?? req.query.month;
    const periodYearRaw = req.query.period_year ?? req.query.periodYear ?? req.query.year;
    const tab = (req.query.tab || 'wait_for_approval').toLowerCase();
    const groupByMonth = (req.query.group_by_month || req.query.groupByMonth || '').toString().toLowerCase() === 'true';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const search = req.query.search != null ? String(req.query.search).trim() : '';

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    if (customerIdRaw) {
      conditions.push(`u.customer_id = $${paramIndex}`);
      params.push(customerIdRaw);
      paramIndex += 1;
    }
    if (periodMonthRaw != null && periodMonthRaw !== '') {
      const pm = parseInt(periodMonthRaw, 10);
      if (!Number.isNaN(pm)) {
        conditions.push(`u.period_month = $${paramIndex}`);
        params.push(pm);
        paramIndex += 1;
      }
    }
    if (periodYearRaw != null && periodYearRaw !== '') {
      const py = parseInt(periodYearRaw, 10);
      if (!Number.isNaN(py)) {
        conditions.push(`u.period_year = $${paramIndex}`);
        params.push(py);
        paramIndex += 1;
      }
    }
    if (tab === 'wait_for_approval') {
      conditions.push(`u.status = 'submitted'`);
    } else if (tab === 'approved') {
      conditions.push(`u.status = 'completed'`);
    } else if (tab === 'rejected') {
      conditions.push(`u.status = 'rejected'`);
    } else if (tab === 'all') {
      conditions.push(`u.status IN ('submitted', 'completed', 'rejected')`);
    }

    if (search) {
      conditions.push(`(u.file_name ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex += 1;
    }

    // TL: only budgets submitted by RMs assigned to this TL
    const isTL = role === 'TEAM_LEAD';
    if (isTL) {
      conditions.push(`EXISTS (SELECT 1 FROM rm_tl_assignments a WHERE a.tl_id = $${paramIndex} AND a.rm_id = u.user_id)`);
      params.push(req.user.id);
      paramIndex += 1;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // When group_by_month=true: fetch all matching uploads (no LIMIT/OFFSET) so each month group has every upload for that month (same idea as upload API grouping).
    // When group_by_month=false: paginate with LIMIT/OFFSET.
    const useGroupByMonthFetch = groupByMonth;
    let result;
    if (useGroupByMonthFetch) {
      result = await pool.query(
        `SELECT 
          u.id,
          u.file_name,
          u.status,
          u.column_mapping,
          u.period_month,
          u.period_year,
          u.declared_income,
          u.goal_amount,
          u.created_at,
          u.updated_at,
          u.customer_id,
          u.user_id AS submitted_by_user_id,
          c.name AS customer_name,
          rm_user.name AS submitted_by_name,
          rm_user.email AS submitted_by_email,
          COUNT(DISTINCT CASE WHEN t.status = 'pending' THEN t.id END) as pending_count,
          COUNT(DISTINCT CASE WHEN t.status = 'approved' THEN t.id END) as approved_count,
          COUNT(DISTINCT t.id) as total_transactions
         FROM uploads u
         LEFT JOIN transactions t ON t.file_name LIKE '%' || u.id || '%' AND t.user_id = u.user_id
         LEFT JOIN customers c ON c.id = u.customer_id
         LEFT JOIN users rm_user ON rm_user.id = u.user_id
         ${whereClause}
         GROUP BY u.id, u.file_name, u.status, u.column_mapping, u.period_month, u.period_year, u.declared_income, u.goal_amount, u.created_at, u.updated_at, u.customer_id, u.user_id, c.name, rm_user.name, rm_user.email
         HAVING COUNT(DISTINCT t.id) > 0 OR u.status IN ('completed', 'rejected')
         ORDER BY u.created_at DESC`,
        params
      );
    } else {
      const offset = (page - 1) * limit;
      const paramsPaginated = [...params, limit, offset];
      const limitParam = `$${paramsPaginated.length - 1}`;
      const offsetParam = `$${paramsPaginated.length}`;
      result = await pool.query(
        `SELECT 
          u.id,
          u.file_name,
          u.status,
          u.column_mapping,
          u.period_month,
          u.period_year,
          u.declared_income,
          u.goal_amount,
          u.created_at,
          u.updated_at,
          u.customer_id,
          u.user_id AS submitted_by_user_id,
          c.name AS customer_name,
          rm_user.name AS submitted_by_name,
          rm_user.email AS submitted_by_email,
          COUNT(DISTINCT CASE WHEN t.status = 'pending' THEN t.id END) as pending_count,
          COUNT(DISTINCT CASE WHEN t.status = 'approved' THEN t.id END) as approved_count,
          COUNT(DISTINCT t.id) as total_transactions,
          COUNT(*) OVER() as total_count
         FROM uploads u
         LEFT JOIN transactions t ON t.file_name LIKE '%' || u.id || '%' AND t.user_id = u.user_id
         LEFT JOIN customers c ON c.id = u.customer_id
         LEFT JOIN users rm_user ON rm_user.id = u.user_id
         ${whereClause}
         GROUP BY u.id, u.file_name, u.status, u.column_mapping, u.period_month, u.period_year, u.declared_income, u.goal_amount, u.created_at, u.updated_at, u.customer_id, u.user_id, c.name, rm_user.name, rm_user.email
         HAVING COUNT(DISTINCT t.id) > 0 OR u.status IN ('completed', 'rejected')
         ORDER BY u.created_at DESC
         LIMIT ${limitParam} OFFSET ${offsetParam}`,
        paramsPaginated
      );
    }

    const list = result.rows;
    const totalCount = useGroupByMonthFetch
      ? list.length
      : (list.length > 0 ? parseInt(list[0].total_count, 10) : 0);
    const totalPages = useGroupByMonthFetch ? 1 : Math.max(1, Math.ceil(totalCount / limit));

    // Map to same shape as Budget History: currentStep, stepStatus, declaredIncome, goalAmount
    const uploads = list.map((upload) => {
      const { total_count: _tc, ...rest } = upload;
      let currentStep = 'upload';
      let stepStatus = 'pending';
      if (rest.status === 'completed') {
        currentStep = 'completed';
        stepStatus = 'completed';
      } else if (rest.status === 'rejected') {
        currentStep = 'rejected';
        stepStatus = 'rejected';
      } else if (rest.approved_count > 0) {
        currentStep = 'review';
        stepStatus = 'in_progress';
      } else if (rest.pending_count > 0) {
        currentStep = 'categorize';
        stepStatus = 'in_progress';
      } else if (rest.status === 'processing') {
        currentStep = 'upload';
        stepStatus = 'completed';
      }
      return {
        ...rest,
        declaredIncome: rest.declared_income,
        goalAmount: rest.goal_amount,
        currentStep,
        stepStatus,
      };
    });

    // For group_by_month (e.g. TL view): same shape as Budget History uploads endpoint
    if (groupByMonth && uploads.length > 0) {
      const grouped_by_month = buildGroupedByMonthForApprovals(uploads);
      return res.json({
        grouped_by_month,
        total: totalCount,
        total_pages: totalPages,
      });
    }

    res.json({
      uploads,
      total: totalCount,
      total_pages: totalPages,
    });
  } catch (error) {
    console.error('Get approvals error:', error);
    res.status(500).json({ message: 'Error fetching approvals' });
  }
});

// Update a single transaction's category (on dropdown change in review)
// Update a transaction's category.
// RM: own transactions only; blocked when upload is submitted or completed.
// Admin/TL: any transaction; can edit even on submitted uploads (they review before approving).
router.patch('/:id/category', authenticate, async (req, res) => {
  try {
    const transactionId = parseInt(req.params.id, 10);
    if (Number.isNaN(transactionId)) {
      return res.status(400).json({ message: 'Invalid transaction id' });
    }
    let categoryId = req.body.categoryId != null ? parseInt(req.body.categoryId, 10) : null;
    if (Number.isNaN(categoryId)) categoryId = null;
    const categoryNameVal = req.body.categoryName != null ? String(req.body.categoryName).trim() : 'Uncategorized';

    const role = req.user.role;
    const isAdminUser =
      role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'TEAM_LEAD' || req.user.is_super_admin;

    // Fetch the transaction — no user_id filter for admin so they can find any transaction
    const txnRow = await pool.query(
      isAdminUser
        ? 'SELECT id, file_name, user_id FROM transactions WHERE id = $1'
        : 'SELECT id, file_name, user_id FROM transactions WHERE id = $1 AND user_id = $2',
      isAdminUser ? [transactionId] : [transactionId, req.user.id]
    );
    if (txnRow.rows.length === 0) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    const txn = txnRow.rows[0];

    // For RM: block editing when upload is submitted or completed
    if (!isAdminUser) {
      const file_name = txn.file_name || '';
      const uploadIdMatch = file_name.match(/upload_(\d+)/);
      if (uploadIdMatch) {
        const uploadId = parseInt(uploadIdMatch[1], 10);
        const uploadStatusRow = await pool.query(
          'SELECT status FROM uploads WHERE id = $1 AND user_id = $2',
          [uploadId, req.user.id]
        );
        if (uploadStatusRow.rows.length > 0) {
          const uploadStatus = uploadStatusRow.rows[0].status;
          if (uploadStatus === 'submitted' || uploadStatus === 'completed') {
            return res.status(403).json({
              message: uploadStatus === 'completed'
                ? 'Cannot edit: this upload has been approved.'
                : 'Cannot edit while submitted for approval.',
            });
          }
        }
      }
    }

    // For Admin/TL: block only when approved (completed). TL/Admin may edit categories while reviewing submitted.
    if (isAdminUser) {
      const file_name = txn.file_name || '';
      const uploadIdMatch = file_name.match(/upload_(\d+)/);
      if (uploadIdMatch) {
        const uploadId = parseInt(uploadIdMatch[1], 10);
        const uploadStatusRow = await pool.query(
          'SELECT status FROM uploads WHERE id = $1',
          [uploadId]
        );
        if (uploadStatusRow.rows.length > 0) {
          const uploadStatus = uploadStatusRow.rows[0].status;
          if (uploadStatus === 'completed') {
            return res.status(403).json({ message: 'Cannot edit: this upload has been approved.' });
          }
        }
      }
    }

    // When categoryId is null but category name is provided, resolve id from categories (global) by name
    let resolvedCategoryId = categoryId;
    if ((resolvedCategoryId == null || resolvedCategoryId === '') && categoryNameVal && categoryNameVal !== 'Uncategorized') {
      const catRow = await pool.query(
        `SELECT id FROM categories WHERE user_id IS NULL AND TRIM(LOWER(name)) = TRIM(LOWER($1)) LIMIT 1`,
        [categoryNameVal]
      );
      if (catRow.rows.length > 0) {
        resolvedCategoryId = catRow.rows[0].id;
      }
    }

    const result = await pool.query(
      `UPDATE transactions
       SET category_id = $1, category_name = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND status = $4
       RETURNING id, category_id, category_name`,
      [resolvedCategoryId || null, categoryNameVal, transactionId, 'pending']
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Transaction not found or not pending' });
    }

    res.json({
      id: result.rows[0].id,
      categoryId: result.rows[0].category_id,
      categoryName: result.rows[0].category_name,
    });
  } catch (error) {
    console.error('Update category error:', error);
    res.status(500).json({ message: 'Error updating category' });
  }
});

// Helper: check if transaction can be edited (upload not submitted/completed)
async function canEditTransaction(pool, transactionId, userId) {
  const txnRow = await pool.query(
    'SELECT id, file_name FROM transactions WHERE id = $1 AND user_id = $2',
    [transactionId, userId]
  );
  if (txnRow.rows.length === 0) return { allowed: false, message: 'Transaction not found' };
  const file_name = txnRow.rows[0].file_name || '';
  const uploadIdMatch = file_name.match(/upload_(\d+)/);
  if (uploadIdMatch) {
    const uploadId = parseInt(uploadIdMatch[1], 10);
    const uploadStatusRow = await pool.query(
      'SELECT status FROM uploads WHERE id = $1 AND user_id = $2',
      [uploadId, userId]
    );
    if (uploadStatusRow.rows.length > 0) {
      const status = uploadStatusRow.rows[0].status;
      if (status === 'submitted') {
        return {
          allowed: false,
          message: 'Cannot edit while submitted for approval.',
        };
      }
    }
  }
  return { allowed: true };
}

// Update a single transaction's date, description, amount, type (review page row edit)
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const transactionId = parseInt(req.params.id, 10);
    if (Number.isNaN(transactionId)) {
      return res.status(400).json({ message: 'Invalid transaction id' });
    }
    const { date, description, amount, type } = req.body;

    const editCheck = await canEditTransaction(pool, transactionId, req.user.id);
    if (!editCheck.allowed) {
      return res.status(403).json({ message: editCheck.message });
    }

    const updates = [];
    const values = [];
    let pos = 1;
    if (date != null) {
      updates.push(`date = $${pos}`);
      values.push(date);
      pos += 1;
    }
    if (description != null) {
      updates.push(`description = $${pos}`);
      values.push(String(description).trim() || '');
      pos += 1;
    }
    if (amount != null) {
      const num = parseFloat(amount);
      if (Number.isNaN(num)) {
        return res.status(400).json({ message: 'Invalid amount' });
      }
      updates.push(`amount = $${pos}`);
      values.push(num);
      pos += 1;
    }
    if (type != null) {
      const t = String(type).trim().toLowerCase();
      if (t !== 'credit' && t !== 'debit') {
        return res.status(400).json({ message: 'Type must be Credit or Debit' });
      }
      updates.push(`type = $${pos}`);
      values.push(t === 'credit' ? 'Credit' : 'Debit');
      pos += 1;
    }
    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(transactionId, req.user.id, 'pending');

    const result = await pool.query(
      `UPDATE transactions SET ${updates.join(', ')}
       WHERE id = $${pos} AND user_id = $${pos + 1} AND status = $${pos + 2}
       RETURNING id, date::text AS date, description, amount, type, category_id, category_name`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Transaction not found or not pending' });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      date: row.date,
      description: row.description,
      amount: parseFloat(row.amount),
      type: row.type,
      categoryId: row.category_id,
      categoryName: row.category_name || 'Uncategorized',
    });
  } catch (error) {
    console.error('Update transaction error:', error);
    res.status(500).json({ message: 'Error updating transaction' });
  }
});

// Delete a single transaction (review page)
router.delete('/bulk', authenticate, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'ids array is required' });
    }
    const numericIds = ids.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id));
    if (numericIds.length === 0) {
      return res.status(400).json({ message: 'No valid transaction ids provided' });
    }

    const result = await pool.query(
      'DELETE FROM transactions WHERE id = ANY($1::int[]) AND user_id = $2 AND status = $3 RETURNING id',
      [numericIds, req.user.id, 'pending']
    );

    res.json({ deleted: result.rows.map((r) => r.id), count: result.rowCount });
  } catch (error) {
    console.error('Bulk delete transactions error:', error);
    res.status(500).json({ message: 'Error deleting transactions' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const transactionId = parseInt(req.params.id, 10);
    if (Number.isNaN(transactionId)) {
      return res.status(400).json({ message: 'Invalid transaction id' });
    }

    const editCheck = await canEditTransaction(pool, transactionId, req.user.id);
    if (!editCheck.allowed) {
      return res.status(403).json({ message: editCheck.message });
    }

    const result = await pool.query(
      'DELETE FROM transactions WHERE id = $1 AND user_id = $2 AND status = $3 RETURNING id',
      [transactionId, req.user.id, 'pending']
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Transaction not found or not pending' });
    }

    res.json({ id: transactionId, message: 'Transaction deleted' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    res.status(500).json({ message: 'Error deleting transaction' });
  }
});

// Create a single transaction for an upload (review page "Add new record")
router.post('/', authenticate, async (req, res) => {
  try {
    const { uploadId, date, description, amount, type, categoryId, categoryName } = req.body;

    const uploadIdNum = uploadId != null ? parseInt(uploadId, 10) : NaN;
    if (Number.isNaN(uploadIdNum) || uploadIdNum <= 0) {
      return res.status(400).json({ message: 'Valid uploadId is required' });
    }

    const uploadRow = await pool.query(
      'SELECT id, user_id, customer_id, status FROM uploads WHERE id = $1 AND user_id = $2',
      [uploadIdNum, req.user.id]
    );
    if (uploadRow.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }
    const upload = uploadRow.rows[0];
    if (upload.status === 'completed') {
      return res.status(403).json({
        message: 'Cannot edit: this upload has been approved.',
      });
    }
    if (upload.status === 'submitted') {
      return res.status(403).json({
        message: 'Cannot add transaction while submitted for approval.',
      });
    }

    const descTrimmed = description != null ? String(description).trim() : '';
    if (!descTrimmed) {
      return res.status(400).json({ message: 'Description is required' });
    }
    const numAmount = parseFloat(amount);
    if (Number.isNaN(numAmount)) {
      return res.status(400).json({ message: 'Invalid amount' });
    }
    const typeVal = type != null ? String(type).trim().toLowerCase() : 'debit';
    const typeFinal = typeVal === 'credit' ? 'Credit' : 'Debit';
    const catName = (categoryName != null && String(categoryName).trim()) ? String(categoryName).trim() : 'Uncategorized';

    const insertResult = await pool.query(
      `INSERT INTO transactions
       (user_id, customer_id, date, description, amount, type, category_id, category_name, status, file_name, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, '{}')
       RETURNING id, date::text AS date, description, amount, type, category_id, category_name`,
      [
        req.user.id,
        upload.customer_id || null,
        date || new Date().toISOString().slice(0, 10),
        descTrimmed,
        numAmount,
        typeFinal,
        categoryId || null,
        catName,
        `upload_${uploadIdNum}`,
      ]
    );

    const row = insertResult.rows[0];
    res.status(201).json({
      id: row.id,
      date: row.date,
      description: row.description,
      amount: parseFloat(row.amount),
      type: row.type,
      categoryId: row.category_id,
      categoryName: row.category_name || 'Uncategorized',
    });
  } catch (error) {
    console.error('Create transaction error:', error);
    res.status(500).json({ message: 'Error creating transaction' });
  }
});

// Get all transactions. Same request flow for RM and TL: GET /transactions?customer_id=X
// (Analytics uses this for dashboard). Response shape identical; scope by role:
// RM: own transactions for that customer. TL: transactions from assigned RMs’ uploads for that customer. Admin: all for customer.
router.get('/', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || req.user.is_super_admin;
    const isTL = role === 'TEAM_LEAD';
    const customerIdRaw = req.query.customer_id != null ? String(req.query.customer_id).trim() : null;
    const customerId = customerIdRaw ? parseInt(customerIdRaw, 10) : null;
    const hasCustomer = Number.isFinite(customerId) && customerId > 0;

    let result;
    if (hasCustomer && (isAdmin || isTL)) {
      // Same data shape as RM: t.* + category_name for Analytics (TL: assigned RMs; Admin: all)
      if (isTL) {
        result = await pool.query(
          `SELECT t.*, t.date::text AS date, c.name as category_name
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           INNER JOIN uploads u ON t.file_name = 'upload_' || u.id AND t.user_id = u.user_id
           WHERE u.customer_id = $1 AND EXISTS (SELECT 1 FROM rm_tl_assignments a WHERE a.tl_id = $2 AND a.rm_id = u.user_id)
           ORDER BY t.date DESC, t.created_at DESC`,
          [customerId, req.user.id]
        );
      } else {
        result = await pool.query(
          `SELECT t.*, t.date::text AS date, c.name as category_name
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           INNER JOIN uploads u ON t.file_name = 'upload_' || u.id AND t.user_id = u.user_id
           WHERE u.customer_id = $1
           ORDER BY t.date DESC, t.created_at DESC`,
          [customerId]
        );
      }
    } else if (hasCustomer && role === 'RELATIONSHIP_MANAGER') {
      // RM with customer_id: only own uploads for that customer
      result = await pool.query(
        `SELECT t.*, t.date::text AS date, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         INNER JOIN uploads u ON t.file_name = 'upload_' || u.id AND t.user_id = u.user_id
         WHERE u.customer_id = $1 AND u.user_id = $2
         ORDER BY t.date DESC, t.created_at DESC`,
        [customerId, req.user.id]
      );
    } else {
      // No customer_id or RM without customer: current user's transactions only
      result = await pool.query(
        `SELECT t.*, t.date::text AS date, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.user_id = $1
         ORDER BY t.date DESC, t.created_at DESC`,
        [req.user.id]
      );
    }

    res.json({ transactions: result.rows });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ message: 'Error fetching transactions' });
  }
});

// Helpers for budget history: month grouping and overall status (used when group_by_month=true)
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isUploadInProcess(upload) {
  return upload.status === 'processing' || upload.currentStep === 'upload';
}

function canResumeUpload(upload) {
  if (upload.status === 'completed') return false;
  if (upload.status === 'submitted') return false;
  return true;
}

function getMonthOverallStatus(list) {
  if (!list || list.length === 0) return { label: '—', badgeClass: 'upload-status-badge' };
  const anyInProcess = list.some((u) => isUploadInProcess(u));
  if (anyInProcess) return { label: 'In progress', badgeClass: 'upload-status-badge upload' };
  // Any approved upload makes the whole month approved
  const anyCompleted = list.some((u) => u.status === 'completed');
  if (anyCompleted) return { label: 'Approved', badgeClass: 'upload-status-badge completed' };
  // Any rejected upload makes the whole month rejected
  const anyRejected = list.some((u) => u.status === 'rejected');
  if (anyRejected) return { label: 'Rejected', badgeClass: 'upload-status-badge rejected' };
  const anySubmitted = list.some((u) => u.status === 'submitted');
  if (anySubmitted) return { label: 'Submitted for approval', badgeClass: 'upload-status-badge submitted' };
  return { label: 'Ready for review', badgeClass: 'upload-status-badge review' };
}

function getSuggestedAction(monthGroup) {
  const list = monthGroup.uploads || [];
  // Any approved upload → show report
  const anyCompleted = list.some((u) => u.status === 'completed');
  if (anyCompleted) return 'view_report';
  // Any rejected upload → RM must view rejection and re-submit
  const anyRejected = list.some((u) => u.status === 'rejected');
  if (anyRejected) return 'rejected';
  const allProcessed = list.length > 0 && list.every((u) => !isUploadInProcess(u));
  if (allProcessed) return 'review';
  const resumable = list.find((u) => canResumeUpload(u));
  if (resumable) return 'resume';
  return 'in_progress';
}

// Approval list: same grouping, but labels/actions for TL (Approved, Review & Approve, View Report, View)
function getMonthOverallStatusForApprovals(list) {
  if (!list || list.length === 0) return { label: '—', badgeClass: 'upload-status-badge' };
  const anyInProcess = list.some((u) => isUploadInProcess(u));
  if (anyInProcess) return { label: 'In progress', badgeClass: 'upload-status-badge upload' };
  // Any approved upload makes the whole month approved
  const anyCompleted = list.some((u) => u.status === 'completed');
  if (anyCompleted) return { label: 'Approved', badgeClass: 'upload-status-badge completed' };
  // Any rejected upload makes the whole month rejected
  const anyRejected = list.some((u) => u.status === 'rejected');
  if (anyRejected) return { label: 'Rejected', badgeClass: 'upload-status-badge rejected' };
  const anySubmitted = list.some((u) => u.status === 'submitted');
  if (anySubmitted) return { label: 'Submitted for approval', badgeClass: 'upload-status-badge submitted' };
  return { label: 'Ready for review', badgeClass: 'upload-status-badge review' };
}

function getSuggestedActionForApprovals(monthGroup) {
  const list = monthGroup.uploads || [];
  const hasSubmitted = list.some((u) => u.status === 'submitted');
  if (hasSubmitted) return 'review_approve';
  const hasCompleted = list.some((u) => u.status === 'completed');
  if (hasCompleted) return 'view_report';
  const hasRejected = list.some((u) => u.status === 'rejected');
  if (hasRejected) return 'view';
  return null;
}

// Same shape as buildGroupedByMonth (upload API): allProcessedForMonth, and uploads have column_mapping, declared_income, goal_amount, declaredIncome, goalAmount, currentStep, stepStatus
function buildGroupedByMonthForApprovals(uploads) {
  const map = new Map();
  (uploads || []).forEach((u) => {
    const month = u.period_month != null ? Number(u.period_month) : new Date(u.created_at).getMonth() + 1;
    const year = u.period_year != null ? Number(u.period_year) : new Date(u.created_at).getFullYear();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, { periodMonth: month, periodYear: year, uploads: [] });
    map.get(key).uploads.push(u);
  });
  return Array.from(map.entries())
    .map(([key, { periodMonth, periodYear, uploads: list }]) => {
      const sorted = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const latestDate = sorted.length
        ? sorted.reduce((max, u) => (new Date(u.created_at) > max ? new Date(u.created_at) : max), new Date(0))
        : null;
      const status = getMonthOverallStatusForApprovals(sorted);
      const allProcessedForMonth = list.length > 0 && list.every((u) => !isUploadInProcess(u));
      const suggestedAction = getSuggestedActionForApprovals({ uploads: sorted });
      return {
        key,
        periodMonth,
        periodYear,
        monthLabel: `${MONTH_NAMES[periodMonth - 1] || periodMonth} ${periodYear}`,
        uploads: sorted,
        latestDate: latestDate ? latestDate.toISOString() : null,
        overallStatus: status.label,
        overallStatusBadgeClass: status.badgeClass,
        allProcessedForMonth,
        suggestedAction: suggestedAction || '—',
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}

function buildGroupedByMonth(uploads) {
  const map = new Map();
  (uploads || []).forEach((u) => {
    const month = u.period_month != null ? Number(u.period_month) : new Date(u.created_at).getMonth() + 1;
    const year = u.period_year != null ? Number(u.period_year) : new Date(u.created_at).getFullYear();
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!map.has(key)) map.set(key, { periodMonth: month, periodYear: year, uploads: [] });
    map.get(key).uploads.push(u);
  });
  return Array.from(map.entries())
    .map(([key, { periodMonth, periodYear, uploads: list }]) => {
      const sorted = list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const latestDate = sorted.length
        ? sorted.reduce((max, u) => (new Date(u.created_at) > max ? new Date(u.created_at) : max), new Date(0))
        : null;
      const status = getMonthOverallStatus(sorted);
      const allProcessedForMonth = list.length > 0 && list.every((u) => !isUploadInProcess(u));
      const suggestedAction = getSuggestedAction({ uploads: sorted });
      return {
        key,
        periodMonth,
        periodYear,
        monthLabel: `${MONTH_NAMES[periodMonth - 1] || periodMonth} ${periodYear}`,
        uploads: sorted,
        latestDate: latestDate ? latestDate.toISOString() : null,
        overallStatus: status.label,
        overallStatusBadgeClass: status.badgeClass,
        allProcessedForMonth,
        suggestedAction,
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}

// Get upload history. Same request flow for RM and TL: GET /uploads?customer_id=X&tab=...&page=...&limit=...
// (Analytics upload dropdown, Budget History). Response shape identical; scope by role:
// RM: own uploads for customer. TL: uploads from assigned RMs for customer. Admin: all for customer.
// Optional ?group_by_month=true for Budget History UI.
router.get('/uploads', authenticate, async (req, res) => {
  try {
    const tab = (req.query.tab || 'all').toLowerCase();
    const groupByMonth = (req.query.group_by_month || req.query.groupByMonth || '').toString().toLowerCase() === 'true';
    const rawCustomerId = req.query.customer_id != null ? String(req.query.customer_id).trim() : null;
    const customerId = rawCustomerId ? parseInt(rawCustomerId, 10) : null;
    if (!rawCustomerId || Number.isNaN(customerId) || customerId <= 0) {
      return res.status(400).json({ message: 'customer_id is required', uploads: [] });
    }
    const custRow = await pool.query('SELECT id, status FROM customers WHERE id = $1', [customerId]);
    if (custRow.rows.length === 0 || (custRow.rows[0].status || 'Active') !== 'Active') {
      return res.status(403).json({ message: 'Customer is disabled or not found', uploads: [] });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = (req.query.search || req.query.q || '').trim();
    const periodMonthRaw = req.query.period_month ?? req.query.periodMonth ?? req.query.month;
    const periodYearRaw = req.query.period_year ?? req.query.periodYear ?? req.query.year;
    const periodMonth = periodMonthRaw != null && String(periodMonthRaw).trim() !== '' ? parseInt(String(periodMonthRaw).trim(), 10) : null;
    const periodYear = periodYearRaw != null && String(periodYearRaw).trim() !== '' ? parseInt(String(periodYearRaw).trim(), 10) : null;
    const hasPeriodMonth = periodMonth != null && Number.isFinite(periodMonth) && periodMonth >= 1 && periodMonth <= 12;
    const hasPeriodYear = periodYear != null && Number.isFinite(periodYear) && periodYear >= 2000 && periodYear <= 2100;

    let statusFilter = '';
    if (tab === 'approved') {
      statusFilter = " AND u.status = 'completed'";
    } else if (tab === 'wait_for_approval') {
      statusFilter = " AND u.status IN ('submitted', 'processing', 'mapped', 'categorized')";
    } else if (tab === 'rejected') {
      statusFilter = " AND u.status = 'rejected'";
    }
    // tab === 'all' or anything else: no status filter

    const role = req.user.role;
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || req.user.is_super_admin;
    const isTL = role === 'TEAM_LEAD';
    // RM: own uploads for customer. TL: uploads from assigned RMs for customer. Admin: all uploads for customer.
    let userWhere = 'u.customer_id = $1';
    const params = [customerId];
    if (!isAdmin && !isTL) {
      userWhere += ' AND u.user_id = $2';
      params.push(req.user.id);
    } else if (isTL) {
      userWhere += ' AND EXISTS (SELECT 1 FROM rm_tl_assignments a WHERE a.tl_id = $2 AND a.rm_id = u.user_id)';
      params.push(req.user.id);
    }
    let searchFilter = '';
    if (search) {
      params.push('%' + search + '%');
      searchFilter = ` AND u.file_name ILIKE $${params.length}`;
    }
    let periodFilter = '';
    if (hasPeriodMonth) {
      params.push(periodMonth);
      periodFilter += ` AND u.period_month = $${params.length}`;
    }
    if (hasPeriodYear) {
      params.push(periodYear);
      periodFilter += ` AND u.period_year = $${params.length}`;
    }
    params.push(limit, offset);
    const limitParam = `$${params.length - 1}`;
    const offsetParam = `$${params.length}`;

    // Exclude "Upload" status records: only show uploads that have transactions or are completed/rejected
    const result = await pool.query(
      `SELECT 
        u.id,
        u.file_name,
        u.status,
        u.column_mapping,
        u.period_month,
        u.period_year,
        u.declared_income,
        u.goal_amount,
        u.created_at,
        u.updated_at,
        u.customer_id,
        c.name AS customer_name,
        COUNT(DISTINCT CASE WHEN t.status = 'pending' THEN t.id END) as pending_count,
        COUNT(DISTINCT CASE WHEN t.status = 'approved' THEN t.id END) as approved_count,
        COUNT(DISTINCT t.id) as total_transactions,
        COUNT(*) OVER() as total_count
       FROM uploads u
       LEFT JOIN transactions t ON t.file_name LIKE '%' || u.id || '%' AND t.user_id = u.user_id
       LEFT JOIN customers c ON c.id = u.customer_id
       WHERE ${userWhere} ${statusFilter}${searchFilter}${periodFilter}
       GROUP BY u.id, u.file_name, u.status, u.column_mapping, u.period_month, u.period_year, u.declared_income, u.goal_amount, u.created_at, u.updated_at, u.customer_id, c.name
       HAVING COUNT(DISTINCT t.id) > 0 OR u.status IN ('completed', 'rejected')
       ORDER BY u.created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params
    );

    const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count, 10) : 0;
    const totalPages = Math.ceil(totalCount / limit);

    // Determine current step (no column mapping step); include camelCase for income/goal so frontend can prefill
    const uploads = result.rows.map(upload => {
      const { total_count: _tc, ...rest } = upload;
      let currentStep = 'upload';
      let stepStatus = 'pending';
      if (rest.status === 'completed') {
        currentStep = 'completed';
        stepStatus = 'completed';
      } else if (rest.status === 'rejected') {
        currentStep = 'rejected';
        stepStatus = 'rejected';
      } else if (rest.approved_count > 0) {
        currentStep = 'review';
        stepStatus = 'in_progress';
      } else if (rest.pending_count > 0) {
        currentStep = 'categorize';
        stepStatus = 'in_progress';
      } else if (rest.status === 'processing') {
        currentStep = 'upload';
        stepStatus = 'completed';
      }
      return {
        ...rest,
        declaredIncome: rest.declared_income,
        goalAmount: rest.goal_amount,
        currentStep,
        stepStatus
      };
    });

    if (groupByMonth) {
      const grouped_by_month = buildGroupedByMonth(uploads);
      return res.json({
        grouped_by_month,
        total: totalCount,
        page,
        limit,
        total_pages: totalPages
      });
    }
    res.json({
      uploads,
      total: totalCount,
      page,
      limit,
      total_pages: totalPages
    });
  } catch (error) {
    console.error('Get uploads error:', error);
    res.status(500).json({ message: 'Error fetching upload history' });
  }
});

// Get executive summary for an upload (RM: own upload; Admin/TL: any upload)
router.get('/uploads/:id/executive-summary', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }
    const role = req.user.role;
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'TEAM_LEAD' || req.user.is_super_admin;

    const result = await pool.query(
      `SELECT
         u.key_observation,
         u.key_observation_at,
         u.key_observation_by,
         u.rm_observation,
         u.rm_observation_at,
         u.rm_observation_by,
         u.rejection_comment,
         u.rejected_at,
         u.status,
         u.user_id,
         u.period_month,
         u.period_year,
         u.declared_income,
         u.goal_amount,
         kob.name  AS key_observation_by_name,
         kob.role  AS key_observation_by_role,
         rmb.name  AS rm_observation_by_name,
         rmb.role  AS rm_observation_by_role,
         uploader.name  AS uploader_name,
         uploader.email AS uploader_email
       FROM uploads u
       LEFT JOIN users kob      ON kob.id      = u.key_observation_by
       LEFT JOIN users rmb      ON rmb.id      = u.rm_observation_by
       LEFT JOIN users uploader ON uploader.id = u.user_id
       WHERE u.id = $1`,
      [uploadId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }
    const row = result.rows[0];
    if (row.user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ message: 'Not allowed to view this upload' });
    }

    const dateRangeResult = await pool.query(
      `SELECT MIN(date)::date AS date_from, MAX(date)::date AS date_to
       FROM transactions
       WHERE user_id = $1 AND file_name = $2 AND status = $3`,
      [row.user_id, `upload_${uploadId}`, 'pending']
    );
    const dr = dateRangeResult.rows[0];
    const toDateStr = (v) => {
      if (v == null) return null;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
      if (v instanceof Date) return v.toISOString().split('T')[0];
      return String(v).slice(0, 10);
    };
    const dateFrom = dr ? toDateStr(dr.date_from) : null;
    const dateTo = dr ? toDateStr(dr.date_to) : null;

    res.json({
      keyObservation: row.key_observation || '',
      keyObservationAt: row.key_observation_at || null,
      keyObservationByName: row.key_observation_by_name || null,
      keyObservationByRole: row.key_observation_by_role || null,
      rmObservation: row.rm_observation || '',
      rmObservationAt: row.rm_observation_at || null,
      rmObservationByName: row.rm_observation_by_name || null,
      rmObservationByRole: row.rm_observation_by_role || null,
      rejectionComment: row.rejection_comment || '',
      rejectedAt: row.rejected_at,
      status: row.status,
      periodMonth: row.period_month,
      periodYear: row.period_year,
      dateFrom,
      dateTo,
      declaredIncome: row.declared_income,
      goalAmount: row.goal_amount,
      uploaderName: row.uploader_name || row.uploader_email || null,
    });
  } catch (error) {
    console.error('Get executive summary error:', error);
    res.status(500).json({ message: 'Error fetching executive summary' });
  }
});

// Update key observation (Team Lead / Admin only)
router.patch('/uploads/:id/executive-summary', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }
    const role = req.user.role;
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'TEAM_LEAD' || req.user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only Admin or Team Lead can update key observation' });
    }
    const uploadStatusRow = await pool.query('SELECT status FROM uploads WHERE id = $1', [uploadId]);
    if (uploadStatusRow.rows.length > 0 && uploadStatusRow.rows[0].status === 'completed') {
      return res.status(403).json({ message: 'Cannot edit: this upload has been approved.' });
    }
    const { keyObservation, declaredIncome, goalAmount, periodMonth, periodYear } = req.body;

    const parseIntOrNull = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const n = parseInt(val, 10);
      return Number.isNaN(n) ? null : n;
    };
    const parseDecimalOrNull = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const n = parseFloat(val);
      return Number.isNaN(n) ? null : n;
    };

    const monthVal = parseIntOrNull(periodMonth);
    const yearVal = parseIntOrNull(periodYear);
    const incomeVal = parseDecimalOrNull(declaredIncome);
    const goalVal = parseDecimalOrNull(goalAmount);
    const obsVal = keyObservation != null ? String(keyObservation).trim() : '';

    await pool.query(
      `UPDATE uploads
       SET key_observation    = $1,
           key_observation_by = $2,
           key_observation_at = CURRENT_TIMESTAMP,
           period_month       = COALESCE($3, period_month),
           period_year        = COALESCE($4, period_year),
           declared_income    = COALESCE($5, declared_income),
           goal_amount        = COALESCE($6, goal_amount),
           updated_at         = CURRENT_TIMESTAMP
       WHERE id = $7`,
      [obsVal, req.user.id, monthVal, yearVal, incomeVal, goalVal, uploadId]
    );
    res.json({ message: 'Executive summary updated' });
  } catch (error) {
    console.error('Update executive summary error:', error);
    res.status(500).json({ message: 'Error updating key observation' });
  }
});

// Save / update RM observation (Relationship Manager or Admin)
router.patch('/uploads/:id/rm-observation', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }
    const role = req.user.role;
    const allowed =
      role === 'RELATIONSHIP_MANAGER' ||
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      req.user.is_super_admin;
    if (!allowed) {
      return res.status(403).json({ message: 'Not authorised to update RM observation' });
    }

    const uploadCheck = await pool.query('SELECT id, user_id, status FROM uploads WHERE id = $1', [uploadId]);
    if (uploadCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }
    const status = uploadCheck.rows[0].status;
    if (status === 'completed') {
      return res.status(403).json({ message: 'Cannot edit: this upload has been approved.' });
    }
    const isAdminOrTL = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'TEAM_LEAD' || req.user.is_super_admin;
    if (status === 'submitted' && !isAdminOrTL) {
      return res.status(403).json({ message: 'Cannot edit RM observation while submitted for approval.' });
    }

    const { rmObservation } = req.body;
    const obsVal = rmObservation != null ? String(rmObservation).trim() : '';

    const result = await pool.query(
      `UPDATE uploads
         SET rm_observation    = $1,
             rm_observation_by = $2,
             rm_observation_at = CURRENT_TIMESTAMP,
             updated_at        = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING rm_observation, rm_observation_at`,
      [obsVal, req.user.id, uploadId]
    );

    res.json({
      message: 'RM observation saved',
      rmObservation: result.rows[0].rm_observation,
      rmObservationAt: result.rows[0].rm_observation_at,
      rmObservationByName: req.user.name,
    });
  } catch (error) {
    console.error('Update RM observation error:', error);
    res.status(500).json({ message: 'Error saving RM observation' });
  }
});

// Update declared income for an upload (Admin, TL, or RM)
router.patch('/uploads/:id/income', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }

    const role = req.user.role;
    const allowed =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      role === 'RELATIONSHIP_MANAGER' ||
      req.user.is_super_admin;
    if (!allowed) {
      return res.status(403).json({ message: 'Not authorised to update income' });
    }

    const uploadStatusRow = await pool.query('SELECT status FROM uploads WHERE id = $1', [uploadId]);
    if (uploadStatusRow.rows.length > 0 && uploadStatusRow.rows[0].status === 'completed') {
      return res.status(403).json({ message: 'Cannot edit: this upload has been approved.' });
    }

    const { declaredIncome } = req.body;
    const parseDecimalOrNull = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const n = parseFloat(val);
      return Number.isNaN(n) ? null : n;
    };
    const incomeVal = parseDecimalOrNull(declaredIncome);

    const result = await pool.query(
      `UPDATE uploads
         SET declared_income = $1,
             updated_at      = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING declared_income`,
      [incomeVal, uploadId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }

    res.json({
      message: 'Income updated',
      declaredIncome: result.rows[0].declared_income,
    });
  } catch (error) {
    console.error('Update income error:', error);
    res.status(500).json({ message: 'Error updating income' });
  }
});

// Update monthly goal for an upload (Admin, TL, or RM)
router.patch('/uploads/:id/goal', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }

    const role = req.user.role;
    const allowed =
      role === 'SUPER_ADMIN' ||
      role === 'ADMIN' ||
      role === 'TEAM_LEAD' ||
      role === 'RELATIONSHIP_MANAGER' ||
      req.user.is_super_admin;
    if (!allowed) {
      return res.status(403).json({ message: 'Not authorised to update goal' });
    }

    const uploadStatusRow = await pool.query('SELECT status FROM uploads WHERE id = $1', [uploadId]);
    if (uploadStatusRow.rows.length > 0 && uploadStatusRow.rows[0].status === 'completed') {
      return res.status(403).json({ message: 'Cannot edit: this upload has been approved.' });
    }

    const { goalAmount } = req.body;
    const parseDecimalOrNull = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const n = parseFloat(val);
      return Number.isNaN(n) ? null : n;
    };
    const goalVal = parseDecimalOrNull(goalAmount);

    const result = await pool.query(
      `UPDATE uploads
         SET goal_amount  = $1,
             updated_at   = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING goal_amount`,
      [goalVal, uploadId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }

    res.json({
      message: 'Goal updated',
      goalAmount: result.rows[0].goal_amount,
    });
  } catch (error) {
    console.error('Update goal error:', error);
    res.status(500).json({ message: 'Error updating goal' });
  }
});

// Reject upload (Team Lead / Admin only); comment required, logged for RM
router.post('/uploads/:id/reject', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }
    const role = req.user.role;
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'TEAM_LEAD' || req.user.is_super_admin;
    if (!isAdmin) {
      return res.status(403).json({ message: 'Only Admin or Team Lead can reject' });
    }
    const { comment } = req.body;
    const commentStr = comment != null ? String(comment).trim() : '';
    if (!commentStr) {
      return res.status(400).json({ message: 'Comment is required when rejecting' });
    }
    const check = await pool.query('SELECT id, user_id FROM uploads WHERE id = $1', [uploadId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }
    await pool.query(
      `UPDATE uploads 
       SET status = 'rejected', rejection_comment = $1, rejected_at = CURRENT_TIMESTAMP, rejected_by = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3`,
      [commentStr, req.user.id, uploadId]
    );
    await pool.query(
      `INSERT INTO upload_approval_audit (upload_id, action, by_user_id, comment) VALUES ($1, 'rejected', $2, $3)`,
      [uploadId, req.user.id, commentStr]
    );
    res.json({ message: 'Upload rejected; comment is visible to the RM' });
  } catch (error) {
    console.error('Reject upload error:', error);
    res.status(500).json({ message: 'Error rejecting upload' });
  }
});

// Get approval history for an upload (every action until approval)
router.get('/uploads/:id/approval-history', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }
    const role = req.user.role;
    const isAdmin = role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'TEAM_LEAD' || req.user.is_super_admin;

    const uploadCheck = await pool.query('SELECT id, user_id FROM uploads WHERE id = $1', [uploadId]);
    if (uploadCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }
    const upload = uploadCheck.rows[0];
    if (upload.user_id !== req.user.id && !isAdmin) {
      return res.status(403).json({ message: 'Not allowed to view this upload' });
    }

    const result = await pool.query(
      `SELECT a.id, a.upload_id, a.action, a.by_user_id, a.comment, a.created_at,
              u.name AS by_user_name, u.email AS by_user_email, u.role AS by_user_role
       FROM upload_approval_audit a
       LEFT JOIN users u ON u.id = a.by_user_id
       WHERE a.upload_id = $1
       ORDER BY a.created_at ASC`,
      [uploadId]
    );

    res.json({ history: result.rows });
  } catch (error) {
    console.error('Get approval history error:', error);
    res.status(500).json({ message: 'Error fetching approval history' });
  }
});

// Get upload details for resuming
router.get('/uploads/:id/resume', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id);
    
    // Get upload info
    const uploadResult = await pool.query(
      'SELECT * FROM uploads WHERE id = $1 AND user_id = $2',
      [uploadId, req.user.id]
    );

    if (uploadResult.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }

    const upload = uploadResult.rows[0];
    
    // Get transactions for this upload (sorted by date ascending)
    const transactionsResult = await pool.query(
      `SELECT t.*, t.date::text AS date, c.name as category_name 
       FROM transactions t 
       LEFT JOIN categories c ON t.category_id = c.id 
       WHERE t.user_id = $1 AND t.file_name LIKE $2
       ORDER BY (t.date::date) ASC NULLS LAST, t.id ASC`,
      [req.user.id, `%${uploadId}%`]
    );

    // Determine current step (no column mapping step)
    let currentStep = 'upload';
    if (upload.status === 'completed') {
      currentStep = 'completed';
    } else if (upload.status === 'rejected') {
      currentStep = 'rejected';
    } else if (transactionsResult.rows.some(t => t.status === 'approved')) {
      currentStep = 'review';
    } else if (transactionsResult.rows.some(t => t.status === 'pending' && t.category_name)) {
      currentStep = 'review';
    } else if (transactionsResult.rows.some(t => t.status === 'pending')) {
      currentStep = 'categorize';
    } else if (upload.status === 'processing') {
      currentStep = 'upload';
    }

    res.json({
      uploadId: upload.id,
      fileName: upload.file_name,
      columnMapping: upload.column_mapping,
      transactions: transactionsResult.rows,
      currentStep,
      status: upload.status,
      periodMonth: upload.period_month,
      periodYear: upload.period_year,
      declaredIncome: upload.declared_income,
      goalAmount: upload.goal_amount,
      key_observation: upload.key_observation || '',
      rejection_comment: upload.rejection_comment || ''
    });
  } catch (error) {
    console.error('Resume upload error:', error);
    res.status(500).json({ message: 'Error resuming upload' });
  }
});

// Delete an upload (and its transactions) – allowed only when not submitted/completed
router.delete('/uploads/:id', authenticate, async (req, res) => {
  try {
    const uploadId = parseInt(req.params.id, 10);
    if (Number.isNaN(uploadId)) {
      return res.status(400).json({ message: 'Invalid upload id' });
    }

    const uploadRow = await pool.query(
      'SELECT id, user_id, status, file_path FROM uploads WHERE id = $1 AND user_id = $2',
      [uploadId, req.user.id]
    );
    if (uploadRow.rows.length === 0) {
      return res.status(404).json({ message: 'Upload not found' });
    }
    const upload = uploadRow.rows[0];
    if (upload.status === 'submitted') {
      return res.status(403).json({ message: 'Cannot delete while submitted for approval.' });
    }
    if (upload.status === 'completed') {
      return res.status(403).json({ message: 'Cannot delete: this upload has been approved.' });
    }

    await pool.query('BEGIN');
    try {
      await pool.query('DELETE FROM categorization_jobs WHERE upload_id = $1 AND user_id = $2', [uploadId, req.user.id]);
      await pool.query('DELETE FROM upload_approval_audit WHERE upload_id = $1', [uploadId]);
      await pool.query('DELETE FROM transactions WHERE user_id = $1 AND file_name = $2', [req.user.id, `upload_${uploadId}`]);
      await pool.query('DELETE FROM uploads WHERE id = $1 AND user_id = $2', [uploadId, req.user.id]);
      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }

    const filePath = upload.file_path ? String(upload.file_path) : '';
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) {
        // ignore fs deletion errors
      }
    }

    res.json({ message: 'Upload deleted', uploadId });
  } catch (error) {
    console.error('Delete upload error:', error);
    res.status(500).json({ message: 'Error deleting upload' });
  }
});

module.exports = router;

