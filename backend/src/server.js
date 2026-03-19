require('dotenv').config({ override: true });

const app = require('./app');
const { pool } = require('./config/db');
const { initFirebase } = require('./config/firebase');
const { initWebPush } = require('./config/webpush');

const PORT = process.env.PORT || 16000;
console.log(`[Config] Target port: ${PORT}`);

const start = async () => {
  try {
    // Test DB connection
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL connected');

    // Init Firebase
    initFirebase();

    // Init Web Push
    initWebPush();

    // ✅ Store server instance
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Health check: http://localhost:${PORT}/health`);
    });

    // ✅ Handle port in use — no more unhandled crash
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use!`);
        console.error(`👉 Run this to fix: taskkill /F /IM node.exe`);
        console.error(`👉 Then run: npm run dev`);
        process.exit(1); // Clean exit — nodemon won't retry
      } else {
        console.error('❌ Server error:', err);
        process.exit(1);
      }
    });

  } catch (err) {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  }
};

// ✅ Graceful shutdown — releases port properly
process.on('SIGTERM', async () => {
  console.log('SIGTERM received — closing DB pool');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('👋 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

start();