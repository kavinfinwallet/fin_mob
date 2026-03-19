const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { logGeminiUsage } = require('./geminiUsageLogger');
const { logGeminiResponseToFile } = require('./geminiResponseLogger');

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_USE_API = (process.env.GEMINI_USE_API || 'true').toLowerCase() === 'true';
const GEMINI_API_BASE_URL = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com').trim();
const GEMINI_API_VERSION = (process.env.GEMINI_API_VERSION || 'v1beta').trim();
const GEMINI_MODEL_DEFAULT = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();

if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY not set. Transaction transformation will not work.');
}

// Only initialise SDK client when explicitly using SDK mode
const genAI =
  !GEMINI_USE_API && GEMINI_API_KEY
    ? new GoogleGenerativeAI(GEMINI_API_KEY)
    : null;

/**
 * Call Gemini using the HTTP REST API.
 * Returns raw text response from the first candidate.
 */
const generateContentWithHttp = async (
  modelName,
  prompt,
  maxOutputTokens = 2048,
  logMeta
) => {
  const modelId = (modelName || GEMINI_MODEL_DEFAULT).replace(/^models\//, '').trim() || GEMINI_MODEL_DEFAULT;
  const url = `${GEMINI_API_BASE_URL}/${GEMINI_API_VERSION}/models/${modelId}:generateContent`;

  const response = await axios.post(
    url,
    {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: Math.min(maxOutputTokens, 8192),
        temperature: 0.2
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      timeout: 60000
    }
  );

  const candidates = response.data?.candidates || [];
  const first = candidates[0];
  if (!first || !first.content || !first.content.parts) {
    throw new Error('Gemini HTTP API returned no candidates');
  }

  const text = first.content.parts
    .map((p) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('Gemini HTTP API returned empty text');
  }

  const usage = response.data?.usageMetadata;
  const totalTokens =
    usage?.totalTokenCount != null
      ? Number(usage.totalTokenCount)
      : usage?.promptTokenCount != null && usage?.candidatesTokenCount != null
        ? Number(usage.promptTokenCount) + Number(usage.candidatesTokenCount)
        : null;
  const promptTokens = usage?.promptTokenCount != null ? Number(usage.promptTokenCount) : null;
  const outputTokens = usage?.candidatesTokenCount != null ? Number(usage.candidatesTokenCount) : null;

  if (logMeta) {
    logGeminiResponseToFile({
      feature: logMeta.feature || 'transformation',
      model: modelId,
      meta: logMeta.meta || null,
      rawResponse: response.data,
    });
  }

  return { text, totalTokens, promptTokens, outputTokens };
};

/**
 * Get transformation code from Gemini based on sample transactions
 * @param {Array} sampleTransactions - Array with at least 1 sample transaction
 * @returns {Promise<string>} JavaScript code to transform transactions
 */
const getTransformationCodeFromGemini = async (sampleTransactions) => {
  if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
    throw new Error('GEMINI_API_KEY is empty or not set');
  }

  const examples = sampleTransactions.slice(0, 3);
  const prompt = `Infer the transaction schema from these example JSON rows.
Identify exact key names for:
1) date
2) description
3) debit amount key(s)
4) credit amount key(s)
5) balance

Write ONLY one JavaScript statement in this format:
return transactions.map(txn => { ... });

Rules:
- Use the exact JSON key names seen in examples.
- Do NOT use keyword guessing on key names (no includes/regex over Object.keys() for credit/debit detection).
- Do NOT hardcode generic names like "debit", "credit", "withdrawal", "deposit" in matching logic.
- Determine type based on JSON key mapping:
  - if a debit/withdrawal key has a non-empty and non-zero value => type = 'debit'
  - else if a credit/deposit key has a non-empty and non-zero value => type = 'credit'
- amount must come from the same key used to decide type.
- Clean amount with: String(v).replace(/[^0-9.-]/g,'').replace(/,/g,'')
- date, description, amount, type, balance must all be strings.
- If balance key is missing, use ''.

Examples: ${JSON.stringify(examples)}
Return only: return transactions.map(txn=>{...});`;

  try {
    const modelNames = [
      process.env.GEMINI_MODEL,
      'gemini-2.5-flash-lite',
      'gemini-1.5-flash',
      'gemini-pro'
    ].filter(Boolean);
    if (modelNames.length === 0) modelNames.push('gemini-pro');
    let lastError = null;

    for (const modelName of modelNames) {
      try {
        console.log(
          `Trying model: ${modelName} with ${GEMINI_USE_API ? 'HTTP API' : 'SDK'} for transformation code generation`
        );

        let code;
        let tokensUsed = null;
        let promptTokens = null;
        let outputTokens = null;
        if (GEMINI_USE_API) {
          const out = await generateContentWithHttp(modelName, prompt, 1024, {
            feature: 'transformation',
            meta: { sampleCount: examples.length },
          });
          code = out.text;
          tokensUsed = out.totalTokens;
          promptTokens = out.promptTokens ?? null;
          outputTokens = out.outputTokens ?? null;
        } else {
          if (!genAI) {
            throw new Error('Gemini SDK client is not initialised');
          }
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(prompt);
          const response = await result.response;
          code = response.text().trim();
        }

        if (code.startsWith('```')) {
          code = code
            .replace(/```javascript\n?/g, '')
            .replace(/```js\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();
        }

        console.log(
          `Successfully got transformation code using model: ${modelName} with ${
            GEMINI_USE_API ? 'HTTP API' : 'SDK'
          }`
        );
        return { code, tokensUsed, promptTokens, outputTokens };
      } catch (modelError) {
        console.warn(
          `Failed to use model ${modelName} with ${
            GEMINI_USE_API ? 'HTTP API' : 'SDK'
          }:`,
          modelError.message
        );
        lastError = modelError;
        continue;
      }
    }

    // If all models failed
    const errorMessage = lastError
      ? `All Gemini models failed. Last error: ${lastError.message}`
      : 'No Gemini models available';

    throw new Error(errorMessage);
  } catch (error) {
    console.error('Gemini transformation code generation error:', error);
    throw error;
  }
};

/**
 * Helper function to clean amount values
 * Removes currency symbols, prefixes, and commas
 * Handles various formats: "INR 750.00", "₹1,234.56", "Rs. 500", etc.
 */
const cleanAmount = (amountValue) => {
  if (!amountValue) return '0';
  
  let cleaned = String(amountValue);
  
  // Remove currency prefixes (case-insensitive)
  cleaned = cleaned.replace(/INR/gi, '');
  cleaned = cleaned.replace(/Rs\.?/gi, '');
  cleaned = cleaned.replace(/Rupees?/gi, '');
  
  // Remove currency symbols
  cleaned = cleaned.replace(/₹/g, '');
  cleaned = cleaned.replace(/\$/g, '');
  cleaned = cleaned.replace(/€/g, '');
  cleaned = cleaned.replace(/£/g, '');
  cleaned = cleaned.replace(/¥/g, '');
  cleaned = cleaned.replace(/₽/g, '');
  
  // Remove commas (thousand separators)
  cleaned = cleaned.replace(/,/g, '');
  
  // Remove spaces
  cleaned = cleaned.replace(/\s+/g, '');
  
  // Remove parentheses (sometimes used for negative amounts)
  cleaned = cleaned.replace(/[()]/g, '');
  
  // Trim and return
  cleaned = cleaned.trim();
  
  // If empty after cleaning, return '0'
  return cleaned || '0';
};

/**
 * Helper function to find credit/debit amount fields in a transaction
 * Handles various field name formats including short forms (Cr, Dr, CR, DR, etc.)
 */
const findCreditDebitFields = (txn) => {
  const keys = Object.keys(txn);
  
  // Common credit field names (any format: Credits, Credit, Deposit Amount, etc.)
  const commonCreditFields = [
    'Credits', 'Credit', 'CR', 'Cr', 'credit', 'cr',
    'Deposit\nAmount(INR)', 'Deposit Amount(INR)', 'Deposit Amount', 'Deposit',
    'Credit Amount', 'Credit\nAmount', 'Credit (INR)', 'Deposit (INR)', 'C/D', 'CD',
    'Credit Amount(INR)', 'Deposit Amount\n(INR)', 'Credit\nAmount(INR)'
  ];
  
  // Common debit field names (any format: Debits, Debit, Withdrawal Amount, etc.)
  const commonDebitFields = [
    'Debits', 'Debit', 'DR', 'Dr', 'debit', 'dr',
    'Withdrawal\nAmount(INR)', 'Withdrawal Amount(INR)', 'Withdrawal Amount', 'Withdrawal',
    'Debit Amount', 'Debit\nAmount', 'Debit (INR)', 'Withdrawal (INR)', 'W/D', 'WD',
    'Debit Amount(INR)', 'Withdrawal Amount\n(INR)', 'Debit\nAmount(INR)'
  ];
  
  let creditValue = null;
  let debitValue = null;
  
  // First, try exact field name matches (case-sensitive)
  for (const field of commonCreditFields) {
    if (txn.hasOwnProperty(field)) {
      const value = txn[field];
      if (value !== null && value !== undefined && value !== '' && String(value).trim() !== '0') {
        creditValue = value;
        break;
      }
    }
  }
  
  for (const field of commonDebitFields) {
    if (txn.hasOwnProperty(field)) {
      const value = txn[field];
      if (value !== null && value !== undefined && value !== '' && String(value).trim() !== '0') {
        debitValue = value;
        break;
      }
    }
  }
  
  // If not found, try case-insensitive pattern matching on all keys
  if (!creditValue) {
    const creditPatterns = [
      /^deposit/i,
      /^credit/i,
      /^cr$/i,
      /^c\/d$/i,
      /^cd$/i,
      /deposit.*amount/i,
      /credit.*amount/i,
      /.*credit.*/i,
      /.*deposit.*/i
    ];
    
    for (const key of keys) {
      // Skip if it looks like a debit field
      if (/debit|withdrawal|dr|w\/d|wd/i.test(key)) continue;
      
      for (const pattern of creditPatterns) {
        if (pattern.test(key)) {
          const value = txn[key];
          if (value !== null && value !== undefined && value !== '' && String(value).trim() !== '0') {
            creditValue = value;
            break;
          }
        }
      }
      if (creditValue) break;
    }
  }
  
  if (!debitValue) {
    const debitPatterns = [
      /^withdrawal/i,
      /^debit/i,
      /^dr$/i,
      /^w\/d$/i,
      /^wd$/i,
      /withdrawal.*amount/i,
      /debit.*amount/i,
      /.*debit.*/i,
      /.*withdrawal.*/i
    ];
    
    for (const key of keys) {
      // Skip if it looks like a credit field
      if (/credit|deposit|cr|c\/d|cd/i.test(key)) continue;
      
      for (const pattern of debitPatterns) {
        if (pattern.test(key)) {
          const value = txn[key];
          if (value !== null && value !== undefined && value !== '' && String(value).trim() !== '0') {
            debitValue = value;
            break;
          }
        }
      }
      if (debitValue) break;
    }
  }
  
  // Final pass: any key containing debit/withdrawal or credit/deposit (normalize key for newlines)
  if (!debitValue || !creditValue) {
    for (const key of keys) {
      const norm = (key || '').replace(/\n/g, ' ').toLowerCase();
      const val = txn[key];
      const num = parseFloat(cleanAmount(val)) || 0;
      if (num <= 0) continue;
      if (!debitValue && /debit|withdrawal|dr|w\/d|wd/.test(norm) && !/credit|deposit|cr/.test(norm)) {
        debitValue = val;
      }
      if (!creditValue && /credit|deposit|cr|c\/d/.test(norm) && !/debit|withdrawal|dr/.test(norm)) {
        creditValue = val;
      }
    }
  }
  
  return { creditValue, debitValue };
};

/**
 * Get correct type (debit/credit) from raw transaction using withdrawal/deposit columns.
 * Withdrawal/Debit column has value → 'debit'; Deposit/Credit column has value → 'credit'.
 * Returns '' if neither has a positive value.
 */
const getCorrectTypeFromRaw = (txn) => {
  if (!txn || typeof txn !== 'object') return '';
  const { creditValue, debitValue } = findCreditDebitFields(txn);
  const debitNum = parseFloat(cleanAmount(debitValue)) || 0;
  const creditNum = parseFloat(cleanAmount(creditValue)) || 0;
  if (debitNum > 0) return 'debit';
  if (creditNum > 0) return 'credit';
  return '';
};

/** Get balance value from raw transaction (any key containing balance). Returns '' if not found. */
const getBalanceFromRaw = (txn) => {
  if (!txn || typeof txn !== 'object') return '';
  const keys = Object.keys(txn);
  const balanceKey = keys.find(k => /balance|running|closing/i.test((k || '').replace(/\n/g, ' ')));
  if (!balanceKey) return '';
  const v = txn[balanceKey];
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  return s !== '' && !isNaN(parseFloat(s.replace(/,/g, ''))) ? s : '';
};

/**
 * Map one raw transaction to { date, description, amount, type } using deterministic
 * rules. Handles keys with newlines (e.g. "Withdrawal\nAmount(INR)") and all common
 * bank column names. Used as fallback when Gemini output has empty amount/type.
 * @param {Object} txn - Raw transaction object from PDF extraction
 * @returns {{ date: string, description: string, amount: string, type: string }}
 */
const fallbackMapOneTransaction = (txn) => {
  const findField = (possibleNames) => {
    for (const name of possibleNames) {
      if (txn.hasOwnProperty(name) && txn[name] !== null && txn[name] !== undefined && txn[name] !== '') {
        return txn[name];
      }
      const keys = Object.keys(txn);
      for (const key of keys) {
        if (key.toLowerCase().replace(/\n/g, ' ') === name.toLowerCase().replace(/\n/g, ' ')) {
          return txn[key];
        }
      }
    }
    return '';
  };

  const date = findField([
    'Transaction Date', 'Transaction\nDate', 'Value Date', 'Value\nDate', 'Date',
    'Posting Date', 'Entry Date', 'Book Date', 'Txn Date', 'Trans Date', 'Val Date'
  ]) || '';
  const description = findField([
    'Transaction Remarks', 'Transaction\nRemarks', 'Description', 'Particulars',
    'Narration', 'Remarks', 'Details', 'Transaction Details', 'Transaction\nDescription'
  ]) || '';

  let amount = '';
  let type = '';
  const { creditValue, debitValue } = findCreditDebitFields(txn);
  const withdrawal = debitValue || findField([
    'Debits', 'Debit', 'Withdrawal\nAmount(INR)', 'Withdrawal Amount(INR)', 'Withdrawal Amount', 'Withdrawal',
    'DR', 'Dr', 'Debit Amount', 'Debit\nAmount', 'W/D', 'WD'
  ]) || '0';
  const deposit = creditValue || findField([
    'Credits', 'Credit', 'Deposit\nAmount(INR)', 'Deposit Amount(INR)', 'Deposit Amount', 'Deposit',
    'CR', 'Cr', 'Credit Amount', 'Credit\nAmount', 'C/D', 'CD'
  ]) || '0';

  const withdrawalNum = parseFloat(cleanAmount(withdrawal)) || 0;
  const depositNum = parseFloat(cleanAmount(deposit)) || 0;
  if (withdrawalNum > 0) {
    amount = String(withdrawalNum);
    type = 'debit';
  } else if (depositNum > 0) {
    amount = String(depositNum);
    type = 'credit';
  } else {
    const otherAmount = findField(['Amount(INR)', 'Amount', 'Transaction Amount', 'Amount\n(INR)']) || '0';
    const otherAmountNum = parseFloat(cleanAmount(otherAmount)) || 0;
    if (otherAmountNum !== 0) {
      amount = String(Math.abs(otherAmountNum));
      type = otherAmountNum >= 0 ? 'credit' : 'debit';
    }
  }

  const balance = findField([
    'Balance(INR)', 'Balance', 'Running Balance', 'Closing Balance', 'Balance\n(INR)'
  ]) || '';

  return {
    date: String(date),
    description: String(description),
    amount: String(amount || ''),
    type: type || '',
    balance: String(balance || '')
  };
};

/**
 * Transform transactions using code from Gemini
 * @param {Array} transactions - Array of transaction objects from Python service
 * @param {number} [userId] - Optional user id for usage logging
 * @returns {Promise<Array>} Transformed array of transactions
 */
const transformTransactions = async (transactions, userId) => {
  if (!transactions || transactions.length === 0) {
    return [];
  }

  // Filter out null/undefined transactions first
  let validTransactions = transactions.filter(txn => 
    txn !== null && 
    txn !== undefined && 
    typeof txn === 'object' &&
    Object.keys(txn).length > 0
  );

  if (validTransactions.length === 0) {
    console.warn('No valid transactions found after filtering');
    return [];
  }

  console.log(`Processing ${validTransactions.length} valid transactions out of ${transactions.length} total`);

  try {
    // Get transformation code from Gemini (first 3 samples for key inference)
    const sampleSize = Math.min(3, validTransactions.length);
    const sampleTransactions = validTransactions.slice(0, sampleSize);
    console.log(`Getting transformation code from Gemini using ${sampleSize} samples`);
    const { code: transformationCode, tokensUsed, promptTokens, outputTokens } = await getTransformationCodeFromGemini(sampleTransactions);

    if (userId != null) {
      const tokensToLog = tokensUsed != null ? tokensUsed : 1500;
      await logGeminiUsage({
        userId,
        feature: 'transformation',
        estimatedTokens: tokensToLog,
        promptTokens: promptTokens ?? undefined,
        outputTokens: outputTokens ?? undefined,
        model: process.env.GEMINI_MODEL || 'gemini-default',
        details: JSON.stringify({ sample_size: sampleSize, total_transactions: validTransactions.length, from_api: tokensUsed != null })
      });
    }

    // Execute the transformation code
    // Clean up the code - remove any markdown or extra text
    let cleanCode = transformationCode.trim();
    
    console.log('Raw transformation code from Gemini:', cleanCode.substring(0, 200) + '...');
    
    // Remove markdown code blocks if present
    if (cleanCode.startsWith('```')) {
      cleanCode = cleanCode.replace(/```javascript\n?/g, '').replace(/```js\n?/g, '').replace(/```\n?/g, '').trim();
    }
    
    // Extract code: support multi-step (var out = ...; for...; return out) or full function or single map
    let finalCode = cleanCode;
    const isBlockWithOut = /\b(?:var|let)\s+out\s*=/.test(cleanCode) && /\breturn\s+out\s*;?/.test(cleanCode);
    const isFullFunction = /function\s+(?:\w+\s*)?\(\s*transactions\s*\)\s*\{[\s\S]*return\s+transactions\.map/.test(cleanCode);

    if (isBlockWithOut) {
      finalCode = `return (function(transactions) { ${cleanCode} })(transactions);`;
    } else if (isFullFunction) {
      // Call the user's function with transactions; no regex extraction (avoids breaking for/break)
      finalCode = `return (${cleanCode})(transactions);`;
    } else {
      // Pattern 1: return transactions.map(txn => { ... });
      const returnMatch = cleanCode.match(/return\s+transactions\.map\s*\([^)]*\)\s*\{([\s\S]*)\}\s*;?/);
      if (returnMatch) {
        finalCode = `return transactions.map(txn => {${returnMatch[1]}});`;
      } else {
        // Pattern 2: transactions.map(txn => { ... })
        const mapMatch = cleanCode.match(/transactions\.map\s*\([^)]*\)\s*\{([\s\S]*)\}\s*;?/);
        if (mapMatch) {
          finalCode = `return transactions.map(txn => {${mapMatch[1]}});`;
        } else if (!cleanCode.includes('transactions.map')) {
          // Pattern 3: Just the return statement body
          const returnBodyMatch = cleanCode.match(/return\s*\{([\s\S]*)\}\s*;?/);
          if (returnBodyMatch) {
            finalCode = `return transactions.map(txn => { return ${returnBodyMatch[0]} });`;
          } else {
            // Pattern 4: Just the object body
            const objMatch = cleanCode.match(/\{([\s\S]*)\}\s*;?/);
            if (objMatch) {
              finalCode = `return transactions.map(txn => { return ${objMatch[0]} });`;
            } else {
              // Last resort: wrap the entire code
              finalCode = `return transactions.map(txn => { ${cleanCode} });`;
            }
          }
        }
      }
    }

    // Ensure it ends with semicolon
    if (!finalCode.endsWith(';')) {
      finalCode += ';';
    }

    console.log('Final transformation code:', finalCode.substring(0, 300) + '...');

    // Create a safe execution context
    let transformedTransactions;
    try {
      const transformFunction = new Function('transactions', finalCode);
      console.log('Executing transformation code on all transactions');
      transformedTransactions = transformFunction(validTransactions);
    } catch (execError) {
      console.error('Error executing transformation code:', execError);
      console.error('Code that failed:', finalCode);
      throw new Error(`Failed to execute transformation code: ${execError.message}`);
    }

    if (!Array.isArray(transformedTransactions)) {
      console.error('Transformation did not return an array. Got:', typeof transformedTransactions);
      throw new Error('Transformation code did not return an array');
    }

    // Keep Gemini-inferred type from mapped keys; do not override via keyword heuristics.
    // Only backfill balance when Gemini leaves it empty.
    for (let i = 0; i < transformedTransactions.length; i++) {
      const t = transformedTransactions[i];
      if (t != null && typeof t === 'object') {
        const raw = validTransactions[i];
        if (!(t.balance != null && String(t.balance).trim() !== '')) {
          const rawBal = getBalanceFromRaw(raw);
          if (rawBal) t.balance = rawBal;
        }
      }
    }

    // Filter out null/undefined results
    const validTransformed = transformedTransactions.filter(t => t !== null && t !== undefined);
    
    if (validTransformed.length === 0) {
      console.error('All transformed transactions are null/undefined. This indicates the transformation code is not working correctly.');
      throw new Error('Transformation code returned all null/undefined values');
    }

    // Ensure all required fields exist; include balance
    const fullyTransformed = validTransformed.map(t => ({
      date: String(t.date || ''),
      description: String(t.description || ''),
      amount: String(t.amount || ''),
      type: String(t.type || ''),
      balance: String(t.balance ?? '')
    }));

    console.log(`Successfully transformed ${fullyTransformed.length} transactions (${transformedTransactions.length - fullyTransformed.length} were null/undefined)`);
    return fullyTransformed;
  } catch (error) {
    console.error('Error transforming transactions:', error);
    // Fallback: return original transactions with basic structure
    console.warn('Falling back to original transaction format');
    
    // Use the already filtered valid transactions if available, otherwise filter again
    if (!validTransactions || validTransactions.length === 0) {
      validTransactions = transactions.filter(txn => txn !== null && txn !== undefined && typeof txn === 'object' && Object.keys(txn).length > 0);
    }
    
    const fallbackResult = validTransactions.map(txn => {
      // Helper function to find field by multiple possible names (case-insensitive, handles newlines)
      const findField = (possibleNames) => {
        for (const name of possibleNames) {
          // Try exact match first
          if (txn.hasOwnProperty(name) && txn[name] !== null && txn[name] !== undefined && txn[name] !== '') {
            return txn[name];
          }
          // Try case-insensitive match
          const keys = Object.keys(txn);
          for (const key of keys) {
            if (key.toLowerCase().replace(/\n/g, ' ') === name.toLowerCase().replace(/\n/g, ' ')) {
              return txn[key];
            }
          }
        }
        return '';
      };
      
      // Get date from various possible fields (comprehensive list; include "Tran Date" from common bank exports)
      const date = findField([
        'Transaction Date', 'Transaction\nDate', 'Tran Date', 'Tran\nDate',
        'Value Date', 'Value\nDate', 'Date', 'Posting Date', 'Entry Date', 'Book Date', 'Process Date',
        'Txn Date', 'Trans Date', 'Val Date', 'Transaction Date\n', 'Value Date\n'
      ]) || '';
      
      // Get description from various possible fields (comprehensive list)
      const description = findField([
        'Transaction Remarks', 'Transaction\nRemarks', 'Transaction Remark', 'Transaction\nRemark',
        'Description', 'Particulars', 'Narration', 'Details', 'Transaction Details',
        'Remarks', 'Narrative', 'Transaction Narrative', 'Memo', 'Reference',
        'Payee', 'Beneficiary', 'Party Name', 'Transaction Description',
        'Transaction\nDescription', 'Narration\n', 'Particulars\n'
      ]) || '';
      
      // Check for CR/DR type field (comprehensive list of possible field names)
      const crdrField = findField([
        'CR/DR', 'Cr/Dr', 'CR/DR', 'Type', 'Transaction Type', 'Dr/Cr', 'Debit/Credit',
        'Cr Dr', 'CR DR', 'Transaction Type\n', 'Type\n'
      ]) || '';
      const crdrValue = crdrField ? String(crdrField).toLowerCase().trim() : '';
      
      // Check for single Amount field (comprehensive list)
      const singleAmountField = findField([
        'Amount(INR)', 'Amount', 'Transaction Amount', 'Txn Amount', 'Amount\n',
        'Transaction Amount\n', 'Amount (INR)', 'Amount\n(INR)'
      ]) || '';
      
      // Determine amount and type
      let amount = '';
      let type = '';
      
      // FORMAT 1: Single Amount field with CR/DR type field
      if (singleAmountField && crdrValue) {
        // Clean the amount using helper function
        const cleanedAmount = cleanAmount(singleAmountField);
        const amountNum = parseFloat(cleanedAmount) || 0;
        
        if (amountNum > 0) {
          amount = String(amountNum);
          
          // Determine type from CR/DR field (handle all variations)
          const crdrLower = crdrValue.toLowerCase();
          // Debit indicators: Dr, DR, Dr., D, Debit, Withdrawal, W/D, WD, etc.
          if (crdrLower.includes('dr') || crdrLower.includes('debit') || 
              crdrLower.includes('withdrawal') || crdrLower.includes('w/d') ||
              crdrLower.startsWith('d') || crdrLower === 'd' || crdrLower === 'wd') {
            type = 'debit';
          } 
          // Credit indicators: Cr, CR, Cr., C, Credit, Deposit, C/D, CD, etc.
          else if (crdrLower.includes('cr') || crdrLower.includes('credit') || 
                   crdrLower.includes('deposit') || crdrLower.includes('c/d') ||
                   crdrLower.startsWith('c') || crdrLower === 'c' || crdrLower === 'cd') {
            type = 'credit';
          } 
          // If CR/DR field exists but doesn't match patterns, try to infer from first character
          else if (crdrValue) {
            type = crdrLower.charAt(0) === 'd' ? 'debit' : 'credit';
          }
        }
      }
      
      // FORMAT 2: Separate Credit/Debit fields (if not already handled)
      if (!amount || amount === '0') {
        // Find credit/debit fields using helper function (handles short forms)
        const { creditValue, debitValue } = findCreditDebitFields(txn);
        
        // Also try direct field access for common formats (comprehensive list)
        const withdrawal = debitValue || 
                          findField([
                            'Withdrawal\nAmount(INR)', 'Withdrawal Amount(INR)', 'Withdrawal Amount',
                            'Withdrawal', 'Debit', 'DR', 'Dr', 'debit', 'dr', 'Debit Amount',
                            'Debit\nAmount', 'Withdrawal\nAmount', 'W/D', 'WD'
                          ]) || '0';
        
        const deposit = creditValue || 
                       findField([
                         'Deposit\nAmount(INR)', 'Deposit Amount(INR)', 'Deposit Amount',
                         'Deposit', 'Credit', 'CR', 'Cr', 'credit', 'cr', 'Credit Amount',
                         'Credit\nAmount', 'Deposit\nAmount', 'C/D', 'CD'
                       ]) || '0';
        
        // Clean and parse amounts using helper function
        const withdrawalStr = cleanAmount(withdrawal);
        const depositStr = cleanAmount(deposit);
        
        const withdrawalNum = parseFloat(withdrawalStr) || 0;
        const depositNum = parseFloat(depositStr) || 0;
        
        if (withdrawalNum > 0) {
          amount = String(withdrawalNum);
          type = 'debit';
        } else if (depositNum > 0) {
          amount = String(depositNum);
          type = 'credit';
        } else {
          // FORMAT 3: Try to get amount from single amount field (positive/negative)
          const otherAmount = findField([
            'Amount', 'Amount(INR)', 'Transaction Amount', 'Txn Amount', 
            'Amount (INR)', 'Amount\n(INR)'
          ]) || '0';
          
          const otherAmountStr = cleanAmount(otherAmount);
          const otherAmountNum = parseFloat(otherAmountStr) || 0;
          
          if (otherAmountNum !== 0) {
            amount = String(Math.abs(otherAmountNum));
            // Positive = credit, Negative = debit
            type = otherAmountNum >= 0 ? 'credit' : 'debit';
          } else {
            // Last resort: try Balance field (but this is usually not the transaction amount)
            const balanceAmount = findField(['Balance(INR)', 'Balance', 'Running Balance']) || '0';
            const balanceStr = cleanAmount(balanceAmount);
            const balanceNum = parseFloat(balanceStr) || 0;
            if (balanceNum !== 0) {
              amount = String(Math.abs(balanceNum));
              type = balanceNum >= 0 ? 'credit' : 'debit';
            }
          }
        }
      }
      
      const balance = findField(['Balance(INR)', 'Balance', 'Running Balance', 'Closing Balance']) || '';
      return {
        date: String(date),
        description: String(description),
        amount: String(amount || ''),
        type: type || '',
        balance: String(balance || '')
      };
    });
    return fallbackResult;
  }
};

module.exports = {
  transformTransactions,
  getTransformationCodeFromGemini
};

