const { pool } = require('../src/config/db');

const run = async () => {
    try {
        console.log('Fetching customers with FCM tokens...');
        const result = await pool.query(
            'SELECT id, phone_number, fcm_token, updated_at FROM customers ORDER BY updated_at DESC LIMIT 5'
        );
        console.table(result.rows);
    } catch (err) {
        console.error('DATABASE ERROR:', err);
    } finally {
        await pool.end();
    }
};

run();
