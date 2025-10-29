const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
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

  getOrdersByAssetId(assetId) {
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

  getOrdersByAssetIds(assetIds) {
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
