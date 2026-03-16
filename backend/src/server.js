require('dotenv').config();

const app = require('./app');
const { pool } = require('./config/db');
const { initFirebase } = require('./config/firebase');
const { initWebPush } = require('./config/webpush');

const PORT = process.env.PORT || 3000;

const start = async () => {
  try {
    // Test DB connection
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connected');

    // Init Firebase
    initFirebase();

    // Init Web Push
    initWebPush();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — closing DB pool');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});

start();
