const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { generalLimiter } = require('./middleware/rateLimit.middleware');
const routes = require('./routes/index');

const app = express();

// ── Enable CORS ───────────────────────────────
app.use(cors());

// ── Body parsing ──────────────────────────────
app.use((req, res, next) => {
  const log = `[${new Date().toISOString()}] ${req.method} ${req.url}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, '..', 'debug.log'), log);
  } catch (err) {
    console.error('Failed to write to debug log:', err.message);
  }
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ── Security headers (basic, add helmet for production) ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ── Global rate limit ─────────────────────────
app.use(generalLimiter);

// ── Health check ──────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API routes ────────────────────────────────
app.use('/api', routes);

// ── 404 handler ───────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ── Global error handler ──────────────────────
app.use((err, req, res, next) => {
  const errorLog = `[${new Date().toISOString()}] ${err.stack}\n\n`;
  try {
    fs.appendFileSync(path.join(__dirname, '..', 'error.log'), errorLog);
  } catch (e) {
    console.error('Failed to write to error log:', e.message);
  }
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
});

module.exports = app;
