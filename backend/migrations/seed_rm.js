const { query } = require('../src/config/db');

async function seed() {
  try {
    const rmName = 'Test Relationship Manager';
    const fcmToken = 'YOUR_TEST_FCM_TOKEN'; // User can replace this for a real test
    
    await query(
      'INSERT INTO relationship_managers (name, fcm_token) VALUES ($1, $2)',
      [rmName, fcmToken]
    );
    console.log('✅ Seeded one Relationship Manager.');
  } catch (err) {
    console.error('❌ Seeding failed:', err.message);
  } finally {
    process.exit();
  }
}

seed();
