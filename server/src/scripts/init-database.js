const db = require('../database/db');

async function initializeDatabase() {
    console.log('=== Database Initialization ===\n');
    
    try {
        await db.initialize();
        console.log('\n✓ Database initialized successfully');
        console.log('✓ Schema created');
        console.log('✓ Indexes created');
        console.log('\nDatabase is ready for use.');
        
        await db.close();
        process.exit(0);
    } catch (error) {
        console.error('\n✗ Database initialization failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

initializeDatabase();
