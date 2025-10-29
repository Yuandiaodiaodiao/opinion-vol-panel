const Database = require('./db/database');
const config = require('./config.json');

async function generate60MinTestData() {
  const db = new Database(config.database.path);
  await db.init();

  console.log('Generating 60-minute test data...\n');

  const yesToken = '78464044768923104002184716865086658420801293197224294747339592090218729991164';
  const noToken = '99426606710483936388295561939771828679151878339607161191787308344532084590471';

  const now = Math.floor(Date.now() / 1000);
  const baseTime = now - (60 * 60); // 60分钟前
  const baseBlock = 66028000;

  let orderCount = 0;

  // 为每分钟生成1-5笔随机交易
  for (let minute = 0; minute < 60; minute++) {
    const tradesInMinute = Math.floor(Math.random() * 5) + 1; // 1-5笔

    for (let trade = 0; trade < tradesInMinute; trade++) {
      const timestamp = baseTime + (minute * 60) + (trade * 10); // 每笔间隔10秒
      const isYes = Math.random() > 0.5;

      // 随机成交量 100-2000 USD
      const volume = 100 + Math.random() * 1900;

      const order = {
        takerOrderHash: `0x${orderCount.toString(16).padStart(64, '0')}`,
        takerOrderMaker: `0x${Math.random().toString(16).slice(2, 42).padStart(40, '0')}`,
        makerAssetId: isYes ? yesToken : noToken,
        takerAssetId: '0',
        makerAmountFilled: BigInt(Math.floor(volume * 1e18)).toString(),
        takerAmountFilled: BigInt(Math.floor(volume * 1e18)).toString(),
        blockNumber: baseBlock + orderCount,
        timestamp: timestamp,
        txHash: `0xtest${orderCount}`
      };

      db.insertOrder(order);
      orderCount++;
    }
  }

  console.log(`✓ Generated ${orderCount} test orders`);
  console.log(`  Time range: Last 60 minutes`);
  console.log(`  Average: ${(orderCount / 60).toFixed(1)} trades per minute`);
  console.log(`\nTotal orders in database: ${db.getTotalOrders()}`);

  db.close();

  console.log('\n✓ Run: node dashboard.js 792');
}

generate60MinTestData().catch(console.error);
