const fs = require('fs');
const path = require('path');

const LOG_ENABLED = (process.env.GEMINI_LOG_RESPONSES || 'false').toLowerCase() === 'true';
const LOG_DIR =
  process.env.GEMINI_LOG_DIR || path.join(__dirname, '..', 'logs');

/**
 * Append a single Gemini API call (request/response summary) to a log file
 * when GEMINI_LOG_RESPONSES is enabled.
 *
 * @param {Object} options
 * @param {string} options.feature - e.g. 'categorization', 'transformation'
 * @param {string} options.model - model name used
 * @param {Object} [options.meta] - extra metadata (batch size, etc.)
 * @param {Object} options.rawResponse - raw response.data from Gemini API
 */
function logGeminiResponseToFile({ feature, model, meta, rawResponse }) {
  if (!LOG_ENABLED || !rawResponse) return;

  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    const filePath = path.join(LOG_DIR, 'gemini-responses.log');
    const entry = {
      ts: new Date().toISOString(),
      feature,
      model,
      meta: meta || null,
      usage: rawResponse.usageMetadata || null,
      // Avoid logging extremely large payloads; keep only candidates + prompt feedback
      candidates: rawResponse.candidates || null,
    };

    fs.appendFile(filePath, JSON.stringify(entry) + '\n', (err) => {
      if (err) {
        // Best-effort logging; never crash the main flow
        console.warn('Failed to write Gemini log entry:', err.message);
      }
    });
  } catch (e) {
    console.warn('Error while logging Gemini response:', e.message);
  }
}

module.exports = {
  logGeminiResponseToFile,
};

