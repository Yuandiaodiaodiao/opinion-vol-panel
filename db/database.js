const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class Database {
    constructor(dbPath, refreshTimeout = 60000) {
        this.dbPath = dbPath;
        this.db = null;
        this.refreshTimeout = refreshTimeout; // 默认60秒
        this.assetRefreshTimes = new Map(); // 记录每个assetId的最后刷新时间
        this.isReloading = false; // 重载锁
        this.lastReloadTime = 0; // 最后一次重载时间
    }

    async init() {
        const SQL = await initSqlJs();

        // 确保数据目录存在
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // 尝试加载现有数据库
        if (fs.existsSync(this.dbPath)) {
            const buffer = fs.readFileSync(this.dbPath);
            this.db = new SQL.Database(buffer);
            console.log('Database loaded from file');
        } else {
            this.db = new SQL.Database();
            this.createTables();
            console.log('New database created');
        }
    }

    createTables() {
        const schema = `
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        takerOrderHash TEXT NOT NULL UNIQUE,
        takerOrderMaker TEXT NOT NULL,
        makerAssetId TEXT NOT NULL,
        takerAssetId TEXT NOT NULL,
        makerAmountFilled TEXT NOT NULL,
        takerAmountFilled TEXT NOT NULL,
        blockNumber INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        txHash TEXT NOT NULL,
        side TEXT DEFAULT 'UNKNOWN',
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE INDEX IF NOT EXISTS idx_maker_asset ON orders(makerAssetId);
      CREATE INDEX IF NOT EXISTS idx_taker_asset ON orders(takerAssetId);
      CREATE INDEX IF NOT EXISTS idx_block ON orders(blockNumber);
      CREATE INDEX IF NOT EXISTS idx_timestamp ON orders(timestamp);
      CREATE INDEX IF NOT EXISTS idx_side ON orders(side);
    `;

        this.db.run(schema);
        this.save();
    }

    // 添加side字段到现有数据库（如果不存在）
    addSideColumn() {
        try {
            this.db.run('ALTER TABLE orders ADD COLUMN side TEXT DEFAULT "UNKNOWN"');
            this.save();
            console.log('Added side column to orders table');
        } catch (error) {
            // 如果字段已存在，忽略错误
            if (!error.message.includes('duplicate column name')) {
                console.error('Error adding side column:', error.message);
            }
        }
    }

    save() {
        const data = this.db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(this.dbPath, buffer);
    }

    async reloadDB() {
        // 加锁防止并发重载
        if (this.isReloading) {
            // 等待当前重载完成
            while (this.isReloading) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            return;
        }

        this.isReloading = true;
        try {
            const SQL = await initSqlJs();
            if (fs.existsSync(this.dbPath)) {
                const buffer = fs.readFileSync(this.dbPath);
                if (this.db) {
                    this.db.close();
                }
                this.db = new SQL.Database(buffer);
                this.lastReloadTime = Date.now();
                console.log('Database reloaded from disk');
            }
        } finally {
            this.isReloading = false;
        }
    }

    async checkAndReloadForAssets(assetIds) {
        const now = Date.now();
        let needReload = false;

        // 检查是否有任何assetId超过刷新时间
        for (const assetId of assetIds) {
            const lastRefresh = this.assetRefreshTimes.get(assetId) || 0;
            if (now - lastRefresh > this.refreshTimeout) {
                needReload = true;
                break;
            }
        }

        // 如果需要重载，执行重载并更新所有assetId的刷新时间
        if (needReload) {
            await this.reloadDB();
            // 更新所有assetId的刷新时间
            for (const assetId of assetIds) {
                this.assetRefreshTimes.set(assetId, now);
            }
        }
    }

    insertOrder(order) {
        const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO orders
      (takerOrderHash, takerOrderMaker, makerAssetId, takerAssetId,
       makerAmountFilled, takerAmountFilled, blockNumber, timestamp, txHash, side)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        stmt.run([
            order.takerOrderHash,
            order.takerOrderMaker,
            order.makerAssetId,
            order.takerAssetId,
            order.makerAmountFilled,
            order.takerAmountFilled,
            order.blockNumber,
            order.timestamp,
            order.txHash,
            order.side || 'UNKNOWN'
        ]);

        stmt.free();
        this.save();
    }

    batchInsertOrders(orders) {
        if (!orders || orders.length === 0) {
            return { inserted: 0, maxBlockNumber: 0 };
        }

        const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO orders
      (takerOrderHash, takerOrderMaker, makerAssetId, takerAssetId,
       makerAmountFilled, takerAmountFilled, blockNumber, timestamp, txHash, side)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        let inserted = 0;
        let maxBlockNumber = 0;

        for (const order of orders) {
            try {
                stmt.run([
                    order.takerOrderHash,
                    order.takerOrderMaker,
                    order.makerAssetId,
                    order.takerAssetId,
                    order.makerAmountFilled,
                    order.takerAmountFilled,
                    order.blockNumber,
                    order.timestamp,
                    order.txHash,
                    order.side || 'UNKNOWN'
                ]);
                inserted++;
                maxBlockNumber = Math.max(maxBlockNumber, order.blockNumber);
            } catch (error) {
                console.error(`Error inserting order ${order.takerOrderHash.slice(0, 10)}...: ${error.message}`);
            }
        }

        stmt.free();
        this.save();

        return { inserted, maxBlockNumber };
    }

    async getOrdersByAssetId(assetId) {
        await this.checkAndReloadForAssets([assetId]);

        const stmt = this.db.prepare(`
      SELECT * FROM orders
      WHERE makerAssetId = ? OR takerAssetId = ?
      ORDER BY timestamp ASC
    `);

        stmt.bind([assetId, assetId]);

        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }

        stmt.free();
        return results;
    }

    async getOrdersByAssetIds(assetIds) {
        await this.checkAndReloadForAssets(assetIds);

        const placeholders = assetIds.map(() => '?').join(',');
        const query = `
      SELECT * FROM orders
      WHERE makerAssetId IN (${placeholders}) OR takerAssetId IN (${placeholders})
      ORDER BY timestamp ASC
    `;

        const stmt = this.db.prepare(query);
        stmt.bind([...assetIds, ...assetIds]);

        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }

        stmt.free();
        return results;
    }

    getLatestBlockNumber() {
        const stmt = this.db.prepare('SELECT MAX(blockNumber) as maxBlock FROM orders');
        stmt.step();
        const result = stmt.getAsObject();
        stmt.free();
        return result.maxBlock || 0;
    }

    getTotalOrders() {
        const stmt = this.db.prepare('SELECT COUNT(*) as count FROM orders');
        stmt.step();
        const result = stmt.getAsObject();
        stmt.free();
        return result.count;
    }

    updateOrderSide(takerOrderHash, side) {
        const stmt = this.db.prepare(`
      UPDATE orders SET side = ? WHERE takerOrderHash = ?
    `);
        stmt.run([side, takerOrderHash]);
        stmt.free();
        this.save();
    }

    close() {
        if (this.db) {
            this.save();
            this.db.close();
        }
    }
}

module.exports = Database;

