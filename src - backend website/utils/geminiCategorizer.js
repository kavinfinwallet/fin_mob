const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const pool = require('../config/database');
const { logGeminiUsage } = require('./geminiUsageLogger');
const { logGeminiResponseToFile } = require('./geminiResponseLogger');
const { learnKeywords } = require('./keywordLearner');

const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const BATCH_SIZE = 20; // Process 20 transactions per API call
const DEFAULT_GEMINI_DAILY_LIMIT = parseInt(process.env.GEMINI_DAILY_LIMIT_TOKENS || '100000', 10);
const GEMINI_USE_API = (process.env.GEMINI_USE_API || 'true').toLowerCase() === 'true';
const GEMINI_API_BASE_URL = (process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com').trim();
const GEMINI_API_VERSION = (process.env.GEMINI_API_VERSION || 'v1beta').trim();
const GEMINI_MODEL_DEFAULT = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();

if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY not set. Gemini categorization will not work.');
}

// Only initialise SDK client when explicitly using SDK mode
const genAI =
  !GEMINI_USE_API && GEMINI_API_KEY
    ? new GoogleGenerativeAI(GEMINI_API_KEY)
    : null;

/**
 * Call Gemini using the HTTP REST API.
 * Returns raw text response from the first candidate.
 * @param {string} modelName
 * @param {string} prompt
 * @param {number} [maxOutputTokens=1024]
 */
const generateContentWithHttp = async (
  modelName,
  prompt,
  maxOutputTokens = 1024,
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
      feature: logMeta.feature || 'categorization',
      model: modelId,
      meta: logMeta.meta || null,
      rawResponse: response.data,
    });
  }

  return { text, totalTokens, promptTokens, outputTokens };
};

/**
 * List available models for debugging
 */
const listAvailableModels = async () => {
  if (!genAI) {
    console.warn('Gemini API key not configured');
    return [];
  }
  
  try {
    // Try to list models using the SDK if available
    // Note: The SDK might not have a direct listModels method, so we'll handle errors gracefully
    return [];
  } catch (error) {
    console.error('Error listing models:', error);
    return [];
  }
};

/**
 * Get category group id by name
 */
const getGroupIdByName = async (groupName) => {
  const r = await pool.query(
    'SELECT id FROM category_groups WHERE name = $1 LIMIT 1',
    [groupName]
  );
  return r.rows[0] ? r.rows[0].id : null;
};

/**
 * Ensure default (global) categories exist - no-op; common categories are seeded in initDb
 */
const ensureDefaultCategories = async () => {
  const existing = await pool.query(
    'SELECT 1 FROM categories WHERE user_id IS NULL LIMIT 1'
  );
  if (existing.rows.length > 0) {
    return; // Global categories already seeded
  }
  // If none, initDb likely not run; do nothing (Gemini will still get empty list)
};

/**
 * Get all categories (common/global - same list for all users)
 */
const getUserCategories = async () => {
  const result = await pool.query(
    `SELECT c.id, c.name, c.group_id, cg.name AS group_name
     FROM categories c
     LEFT JOIN category_groups cg ON c.group_id = cg.id
     WHERE c.user_id IS NULL
     ORDER BY cg.display_order NULLS LAST, c.name`
  );
  return result.rows;
};

/**
 * Create a new global category if it doesn't exist (common for all users)
 */
const createCategoryIfNotExists = async (categoryName, userId) => {
  if (!categoryName || categoryName.trim() === '' || categoryName === 'Uncategorized') {
    return null;
  }

  const existing = await pool.query(
    'SELECT id FROM categories WHERE user_id IS NULL AND LOWER(name) = LOWER($1)',
    [categoryName.trim()]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const result = await pool.query(
    'INSERT INTO categories (name, keywords, user_id, group_id) VALUES ($1, $2, NULL, NULL) RETURNING id',
    [categoryName.trim(), []]
  );

  return result.rows[0].id;
};

/**
 * Categorize a batch of transactions using Gemini API
 */
const categorizeBatchWithGemini = async (transactions, userId) => {
  // Validate API key by checking if it's set
  if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
    throw new Error('GEMINI_API_KEY is empty or not set');
  }

  // Get user's categories from database (with group for context)
  const userCategories = await getUserCategories();
  if (!userCategories.length) {
    throw new Error('No categories found for user. Please ensure category groups and categories exist in the database.');
  }
  const byGroup = {};
  for (const c of userCategories) {
    const g = c.group_name || 'Others';
    if (!byGroup[g]) byGroup[g] = [];
    byGroup[g].push(c.name);
  }
  const categoryList = Object.entries(byGroup)
    .map(([g, names]) => `${g}: ${names.join(', ')}`)
    .join('\n');

  const batchData = transactions.map((txn, i) => ({
    i: i + 1,
    d: (txn.description || '').slice(0, 200),
    a: txn.amount || 0,
    t: txn.type || ''
  }));

  const prompt = `Categories (use only these exact names, else "Uncategorized"):
${categoryList}

Transactions: ${JSON.stringify(batchData)}

Reply with ONLY a JSON array:
[{"index":1,"category":"Name","keyword":"key term"},...]

Rules:
- "index"   : transaction order (1-based)
- "category": exact name from the list above, else "Uncategorized"
- "keyword" : 1–3 word phrase taken directly from the description that best identifies the merchant or payment type (e.g. "swiggy", "apollo pharmacy", "irctc", "bigbasket"). Must be a substring of the description. Lowercase. Omit generic words like "upi", "payment", "transfer", "bank".`;

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
          `Trying model: ${modelName} with ${GEMINI_USE_API ? 'HTTP API' : 'SDK'}`
        );

        let text;
        let tokensUsed = null;
        let promptTokens = null;
        let outputTokens = null;
        if (GEMINI_USE_API) {
          const out = await generateContentWithHttp(modelName, prompt, 2048, {
            feature: 'categorization',
            meta: { batchSize: transactions.length },
          });
          text = out.text;
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
          text = response.text();
        }

        // Extract JSON from response (handle markdown code blocks if present)
        let jsonText = text.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();
        }

        const categorizations = JSON.parse(jsonText);

        // Map categorizations back to transactions (only allow category names from DB)
        const learnings = []; // collect for keyword learning
        const categorized = transactions.map((txn, index) => {
          const catResult = categorizations.find((c) => Number(c.index) === index + 1);
          const rawName = (catResult?.category || 'Uncategorized').trim();
          const geminiKeyword = (catResult?.keyword || '').trim().toLowerCase() || null;

          const existingCategory = userCategories.find(
            (c) => c.name.toLowerCase() === rawName.toLowerCase()
          );
          const categoryName = existingCategory
            ? existingCategory.name
            : 'Uncategorized';
          const categoryId =
            existingCategory
              ? existingCategory.id
              : (userCategories.find((c) => c.name === 'Uncategorized') || {})
                  .id || null;

          // Collect learning pair — persisted to DB after the batch returns
          learnings.push({
            description: txn.description || '',
            categoryName,
            categoryId,
            keyword: geminiKeyword,
          });

          return {
            ...txn,
            categoryName,
            categoryId
          };
        });

        // Persist new keywords in the background (non-blocking, never throws)
        learnKeywords(learnings).catch((e) =>
          console.warn('[keyword-learning] failed:', e.message)
        );

        console.log(
          `Successfully categorized using model: ${modelName} with ${
            GEMINI_USE_API ? 'HTTP API' : 'SDK'
          }`
        );
        return { categorized, tokensUsed, promptTokens, outputTokens };
      } catch (modelError) {
        console.warn(
          `Failed to use model ${modelName} with ${
            GEMINI_USE_API ? 'HTTP API' : 'SDK'
          }:`,
          modelError.message
        );
        lastError = modelError;
        // Try next model
        continue;
      }
    }
    
    // If all models failed, provide helpful error message
    const errorMessage = lastError 
      ? `All Gemini models failed. Last error: ${lastError.message}. Please check:\n` +
        `1. Your GEMINI_API_KEY is valid and has access to Gemini models\n` +
        `2. Gemini API is enabled in your Google Cloud Console\n` +
        `3. The API key has the necessary permissions\n` +
        `4. Try using a different model name in GEMINI_MODEL environment variable`
      : 'No Gemini models available';
    
    throw new Error(errorMessage);
  } catch (error) {
    console.error('Gemini categorization error:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      errorDetails: error.errorDetails
    });
    
    if (error.status === 401 || error.status === 403) {
      console.error('API Key authentication failed. Please verify your GEMINI_API_KEY is correct.');
    } else if (error.status === 404) {
      console.error('Model not found. This could mean:\n' +
        '- The model name is incorrect\n' +
        '- Your API key does not have access to this model\n' +
        '- The model is not available in your region\n' +
        '- Try using "gemini-pro" instead');
    }
    
    // Rethrow so the categorization job is marked failed (user can retry), instead of
    // returning all Uncategorized and marking the job completed.
    throw error;
  }
};

/**
 * Categorize transactions using Gemini API (batched)
 */
const categorizeTransactionsWithGemini = async (transactions, userId) => {
  // Ensure default categories exist
  await ensureDefaultCategories();

  // If no API key at all, we cannot call Gemini (HTTP or SDK)
  if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
    console.warn('GEMINI_API_KEY not configured, using Uncategorized for all transactions');
    return transactions.map((txn) => ({
      ...txn,
      categoryName: 'Uncategorized',
      categoryId: null
    }));
  }

  const categorized = [];
  
  // Process in batches
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    console.log(`Categorizing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} transactions)`);
    
    const { categorized: batchCategorized, tokensUsed, promptTokens, outputTokens } = await categorizeBatchWithGemini(batch, userId);
    categorized.push(...batchCategorized);

    const tokensToLog = tokensUsed != null ? tokensUsed : batch.length * 200;
    await logGeminiUsage({
      userId,
      feature: 'categorization',
      estimatedTokens: tokensToLog,
      promptTokens: promptTokens ?? undefined,
      outputTokens: outputTokens ?? undefined,
      model: process.env.GEMINI_MODEL || 'gemini-default',
      details: JSON.stringify({ batch_size: batch.length, batch_index: Math.floor(i / BATCH_SIZE) + 1, from_api: tokensUsed != null })
    });
    
    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < transactions.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Create categories that don't exist and update categoryId
  for (const txn of categorized) {
    if (txn.categoryName && txn.categoryName !== 'Uncategorized' && !txn.categoryId) {
      const categoryId = await createCategoryIfNotExists(txn.categoryName, userId);
      if (categoryId) {
        txn.categoryId = categoryId;
      }
    }
  }

  return categorized;
};

module.exports = {
  categorizeTransactionsWithGemini,
  ensureDefaultCategories,
  getUserCategories,
  createCategoryIfNotExists
};

