const { pool } = require('../src/config/db');

const run = async () => {
    try {
        console.log('Querying notification logs from today (2026-03-17)...');
        const result = await pool.query(
            "SELECT id, customer_id, type, channel, status, error_message, created_at FROM notification_logs WHERE created_at >= '2026-03-17' ORDER BY created_at DESC"
        );
        if (result.rows.length === 0) {
            console.log('No logs found for today.');
            // Let's also check the very last 5 logs regardless of date
            const lastFive = await pool.query('SELECT created_at FROM notification_logs ORDER BY created_at DESC LIMIT 5');
            console.log('Last 5 logs timestamps:', lastFive.rows);
        } else {
            console.log(`Found ${result.rows.length} logs for today:`);
            console.table(result.rows);
        }
    } catch (err) {
        console.error('DATABASE ERROR:', err);
    } finally {
        await pool.end();
    }
};

run();
