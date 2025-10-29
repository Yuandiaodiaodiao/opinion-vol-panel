const Database = require('./db/database');
const BSCApi = require('./src/bscAPI');
const { determineBuySell } = require('./src/eventParser');
const { loadConfig } = require('./src/configLoader');

// 加载配置
const config = loadConfig();

async function updateExistingOrders() {
  const db = new Database(config.database.path);
  await db.init();

  // 添加side字段（如果不存在）
  db.addSideColumn();

  const bscApi = new BSCApi(
    config.api.bsc_api_url,
    config.api.bsc_api_key,
    config.proxy,
    config.api.bsc_rpc_url
  );

  console.log('Fetching all orders from database...');

  // 获取所有订单
  const stmt = db.db.prepare('SELECT * FROM orders WHERE side IS NULL OR side = "UNKNOWN" ORDER BY blockNumber ASC');
  const orders = [];
  while (stmt.step()) {
    orders.push(stmt.getAsObject());
  }
  stmt.free();

  console.log(`Found ${orders.length} orders to update`);

  if (orders.length === 0) {
    console.log('No orders need updating');
    db.close();
    return;
  }

  let updated = 0;
  let errors = 0;

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];

    try {
      console.log(`[${i + 1}/${orders.length}] Processing tx ${order.txHash.slice(0, 16)}...`);

      // 通过RPC获取交易回执
      const receipt = await bscApi.getTransactionReceiptByRPC(order.txHash);

      if (receipt && receipt.logs) {
        // 判断BUY/SELL
        const side = determineBuySell(receipt.logs, order.takerOrderMaker);

        // 更新数据库
        db.updateOrderSide(order.takerOrderHash, side);

        console.log(`  Updated: ${side}`);
        updated++;
      } else {
        console.log('  No logs found, keeping as UNKNOWN');
      }

      // 添加延迟避免RPC请求过快
      if ((i + 1) % 10 === 0) {
        console.log(`  Processed ${i + 1}/${orders.length}, sleeping 1s...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.error(`  Error: ${error.message}`);
      errors++;

      // 如果连续出错太多，暂停一下
      if (errors > 5) {
        console.log('Too many errors, sleeping 5s...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        errors = 0;
      }
    }
  }

  console.log(`\nUpdate complete!`);
  console.log(`  Updated: ${updated}/${orders.length}`);
  console.log(`  Errors: ${errors}`);

  db.close();
}

// 运行更新脚本
updateExistingOrders().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
