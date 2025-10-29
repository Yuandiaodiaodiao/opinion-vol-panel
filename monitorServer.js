const fs = require('fs');
const path = require('path');
const BSCApi = require('./src/bscAPI');
const RPCPool = require('./src/rpcPool');
const FilterMonitor = require('./src/filterMonitor');
const Database = require('./db/database');
const { ORDERS_MATCHED_TOPIC, parseOrdersMatchedEvent, determineBuySell } = require('./src/eventParser');
const { loadConfig } = require('./src/configLoader');

// 加载配置
const config = loadConfig();

// 状态文件路径
const stateFile = config.monitor.stateFile;

// 加载或初始化状态
function loadState() {
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  }
  return {
    lastProcessedBlock: config.contract.startBlock
  };
}

// 保存状态
function saveState(state) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// 主监听函数
async function monitor() {
  // 创建RPC池实例
  const rpcPool = new RPCPool(
    config.api.bsc_rpc_urls || [config.api.bsc_rpc_url],
    config.proxy
  );

  const bscApi = new BSCApi(
    config.api.bsc_api_url,
    config.api.bsc_api_key,
    config.proxy,
    config.api.bsc_rpc_url,
    rpcPool
  );

  const db = new Database(config.database.path);
  await db.init();

  // 尝试添加side字段（如果已存在则忽略）
  db.addSideColumn();

  console.log('Monitor Server Started');
  console.log(`Contract: ${config.contract.address}`);
  console.log(`Database: ${config.database.path}`);
  console.log('Using RPC Filter Monitor for real-time ERC-1155 Transfer event detection');
  console.log('Monitoring Mode: contract-transfer (all Transfer events on this contract)');

  // ERC-1155 事件签名
  const TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
  const TRANSFER_BATCH_TOPIC = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

  // 事件处理函数
  async function handleEvent(log) {
    try {
      console.log(`\n[${new Date().toISOString()}] Processing event from tx: ${log.transactionHash}`);

      // 检查是否是Transfer事件
      if (!log.topics || log.topics.length === 0) {
        console.log('  No topics found, skipping');
        return;
      }

      const topic0 = log.topics[0].toLowerCase();
      const isTransferSingle = topic0 === TRANSFER_SINGLE_TOPIC.toLowerCase();
      const isTransferBatch = topic0 === TRANSFER_BATCH_TOPIC.toLowerCase();

      if (!isTransferSingle && !isTransferBatch) {
        console.log(`  Not a Transfer event (topic: ${log.topics[0]}), skipping`);
        return;
      }

      console.log(`  ✓ Detected ${isTransferSingle ? 'TransferSingle' : 'TransferBatch'} event`);
      console.log(`  → Fetching full transaction receipt to find OrdersMatched event...`);

      // 根据 transactionHash 获取完整的交易回执
      let receipt;
      try {
        receipt = await bscApi.getTransactionReceiptByRPC(log.transactionHash);
        if (!receipt || !receipt.logs) {
          console.log('  ✗ Failed to get transaction receipt or no logs found');
          return;
        }
        console.log(`  ✓ Receipt fetched, found ${receipt.logs.length} logs in this transaction`);
      } catch (error) {
        console.error(`  ✗ Error getting transaction receipt: ${error.message}`);
        return;
      }

      // 在所有事件中查找 OrdersMatched 事件
      const ordersMatchedLogs = receipt.logs.filter(eventLog => {
        return eventLog.topics &&
               eventLog.topics.length > 0 &&
               eventLog.topics[0].toLowerCase() === ORDERS_MATCHED_TOPIC.toLowerCase();
      });

      if (ordersMatchedLogs.length === 0) {
        console.log('  ✗ No OrdersMatched event found in this transaction');
        return;
      }

      console.log(`  ✓ Found ${ordersMatchedLogs.length} OrdersMatched event(s)`);

      // 处理所有找到的 OrdersMatched 事件
      for (const ordersMatchedLog of ordersMatchedLogs) {
        console.log('\n  === Processing OrdersMatched Event ===');
        console.log(JSON.stringify(ordersMatchedLog, null, 2));

        // 解析事件
        const order = parseOrdersMatchedEvent(ordersMatchedLog);
        if (!order) {
          console.log('  ✗ Failed to parse OrdersMatched event, skipping');
          continue;
        }

        console.log(`  ✓ Order parsed: ${order.takerOrderHash}`);
        console.log(`    Block: ${order.blockNumber}, Maker: ${order.takerOrderMaker}`);

        // 判断 BUY/SELL
        order.side = determineBuySell(receipt.logs, order.takerOrderMaker);
        console.log(`    Side: ${order.side}`);

        // 插入数据库
        try {
          const result = db.batchInsertOrders([order]);
          if (result.inserted > 0) {
            console.log(`  ✅ Order inserted into database`);
            console.log(`    Order details:`, JSON.stringify(order, null, 2));
            console.log(`    Total orders in database: ${db.getTotalOrders()}`);
          } else {
            console.log(`  ℹ Order already exists in database (duplicate)`);
          }
        } catch (error) {
          console.error(`  ✗ Error inserting order: ${error.message}`);
        }
      }

    } catch (error) {
      console.error(`✗ Error handling event: ${error.message}`);
      console.error(error.stack);
    }
  }

  // 创建FilterMonitor实例
  const filterMonitor = new FilterMonitor(
    config.contract.address,
    config.api.bsc_rpc_urls || [config.api.bsc_rpc_url],
    config.proxy,
    handleEvent,
    { mode: 'contract-transfer' } // 监听合约的所有Transfer事件
  );

  // 启动FilterMonitor
  await filterMonitor.start();

  // 定期输出统计信息
  setInterval(() => {
    const stats = filterMonitor.getStats();
    console.log(`\n[Stats] Filter Monitor: ${stats.filterCount} filters active, ${stats.processedTxsCount} txs in cache`);
    console.log(`[Stats] Database: ${db.getTotalOrders()} total orders`);
  }, 60 * 1000); // 每分钟输出一次

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    filterMonitor.stop();
    db.close();
    process.exit(0);
  });
}

// 启动监听
monitor().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
