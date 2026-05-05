const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const config = require('../config/config');

class Database {
    constructor() {
        this.db = null;
        this.closingPromise = null;
    }

    async initialize() {
        return new Promise((resolve, reject) => {
            const dbPath = config.database.path;
            const dbDir = path.dirname(dbPath);

            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            this.db = new sqlite3.Database(dbPath, (err) => {
                if (err) {
                    console.error('[DB] Error opening database:', err);
                    return reject(err);
                }
                console.log('[DB] Connected to SQLite database at:', dbPath);
                this.runSchema()
                    .then(() => resolve())
                    .catch(reject);
            });
        });
    }

    async runSchema() {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        const statements = schema
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        for (const statement of statements) {
            await this.run(statement);
        }

        await this.runMigrations();
        
        console.log('[DB] Schema initialized successfully');
    }

    async runMigrations() {
        const migrations = [
            { table: 'products', column: 'images', type: 'TEXT' },
            { table: 'products', column: 'description', type: 'TEXT' },
            { table: 'products', column: 'source_category', type: 'TEXT' },
            { table: 'products', column: 'ai_summary', type: 'TEXT' },
            { table: 'products', column: 'ai_signals', type: 'TEXT' },
            { table: 'products', column: 'ai_is_resellable', type: 'INTEGER' },
            { table: 'products', column: 'ai_estimated_total_weight_grams', type: 'REAL' },
            { table: 'products', column: 'ai_estimated_unit_weight_grams', type: 'REAL' },
            { table: 'products', column: 'ai_recommended_resale_pack_quantity', type: 'INTEGER' },
            { table: 'products', column: 'ai_estimated_resale_pack_weight_grams', type: 'REAL' },
            { table: 'products', column: 'ai_is_resale_pack_shippable_under_100g', type: 'INTEGER' },
            { table: 'products', column: 'ai_estimated_weight_grams', type: 'REAL' },
            { table: 'products', column: 'ai_is_shippable_under_100g', type: 'INTEGER' },
            { table: 'products', column: 'ai_provider', type: 'TEXT' },
            { table: 'products', column: 'ai_processed_at', type: 'DATETIME' },
            { table: 'products', column: 'shipping_score', type: 'REAL' },
            { table: 'scraping_runs', column: 'category', type: 'TEXT' },
            { table: 'scraping_runs', column: 'run_type', type: "TEXT DEFAULT 'keyword'" },
            { table: 'scraping_runs', column: 'products_filtered', type: 'INTEGER DEFAULT 0' },
        ];

        for (const m of migrations) {
            const cols = await this.all(`PRAGMA table_info(${m.table})`);
            const has = cols.some(c => c.name === m.column);
            if (!has) {
                try {
                    await this.run(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.type}`);
                    console.log(`[DB] Migration: added ${m.table}.${m.column}`);
                } catch (e) {
                    console.warn(`[DB] Migration warn (${m.table}.${m.column}):`, e.message);
                }
            }
        }
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) {
                    console.error('[DB] Error executing query:', err.message);
                    console.error('[DB] SQL:', sql);
                    return reject(err);
                }
                resolve({ lastID: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) {
                    console.error('[DB] Error executing query:', err.message);
                    return reject(err);
                }
                resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error('[DB] Error executing query:', err.message);
                    return reject(err);
                }
                resolve(rows);
            });
        });
    }

    async beginTransaction() {
        await this.run('BEGIN TRANSACTION');
    }

    async commit() {
        await this.run('COMMIT');
    }

    async rollback() {
        await this.run('ROLLBACK');
    }

    close() {
        if (!this.db) return Promise.resolve();
        if (this.closingPromise) return this.closingPromise;

        const dbInstance = this.db;
        this.db = null;

        this.closingPromise = new Promise((resolve, reject) => {
            dbInstance.close((err) => {
                this.closingPromise = null;

                if (err) {
                    console.error('[DB] Error closing database:', err);
                    return reject(err);
                }
                console.log('[DB] Database connection closed');
                resolve();
            });
        });

        return this.closingPromise;
    }
}

module.exports = new Database();
