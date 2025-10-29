const fs = require('fs');
const Database = require('./db/database');
const TopicAPI = require('./src/topicAPI');
const chalk = require('chalk');
const { loadConfig } = require('./src/configLoader');

// 加载配置
const config = loadConfig();

/**
 * 将金额格式化为可读的数字（假设18位小数）
 */
function formatAmount(amountStr, decimals = 18) {
  const amount = BigInt(amountStr);
  const divisor = BigInt(10 ** decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;
  return `${integerPart}.${fractionalPart.toString().padStart(decimals, '0').slice(0, 2)}`;
}

/**
 * 计算成交量（USD）
 */
function calculateVolume(order) {
  const makerAssetId = BigInt(order.makerAssetId);
  const takerAssetId = BigInt(order.takerAssetId);

  if (makerAssetId !== 0n) {
    // takerAmount是USD
    return BigInt(order.takerAmountFilled);
  } else if (takerAssetId !== 0n) {
    // makerAmount是USD
    return BigInt(order.makerAmountFilled);
  }

  return 0n;
}

/**
 * 按分钟聚合成交量
 */
function aggregateVolumeByMinute(orders) {
  if (orders.length === 0) return [];

  const volumeMap = new Map();

  for (const order of orders) {
    // 将时间戳向下取整到分钟
    const minuteTimestamp = Math.floor(order.timestamp / 60) * 60;

    if (!volumeMap.has(minuteTimestamp)) {
      volumeMap.set(minuteTimestamp, {
        timestamp: minuteTimestamp,
        volume: 0n,
        trades: 0,
        buyVolume: 0n,
        sellVolume: 0n,
        buyTrades: 0,
        sellTrades: 0
      });
    }

    const bucket = volumeMap.get(minuteTimestamp);
    const vol = calculateVolume(order);
    bucket.volume += vol;
    bucket.trades++;

    // 统计BUY/SELL
    if (order.side === 'BUY') {
      bucket.buyVolume += vol;
      bucket.buyTrades++;
    } else if (order.side === 'SELL') {
      bucket.sellVolume += vol;
      bucket.sellTrades++;
    }
  }

  return Array.from(volumeMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 绘制60分钟交易量柱状图
 */
function drawVolumeChart(volumeData, title, height = 25, width = 120) {
  console.log(chalk.bold.cyan(`\n=== ${title} ===\n`));

  if (volumeData.length === 0) {
    console.log(chalk.yellow('No volume data'));
    return;
  }

  // 只显示最近60分钟
  const displayData = volumeData.slice(-60);

  if (displayData.length === 0) {
    console.log(chalk.yellow('No recent data'));
    return;
  }

  // 获取最大成交量
  let maxVolume = 0n;
  for (const d of displayData) {
    if (d.volume > maxVolume) {
      maxVolume = d.volume;
    }
  }

  if (maxVolume === 0n) {
    console.log(chalk.yellow('No volume in data'));
    return;
  }

  // 创建画布
  const canvas = Array(height).fill(null).map(() => Array(width).fill(' '));

  // 计算每根柱子的宽度
  const barWidth = Math.max(1, Math.floor(width / displayData.length));

  // 绘制Y轴刻度（成交量）
  for (let i = 0; i <= 4; i++) {
    const y = Math.floor(height * i / 4);
    const volume = maxVolume - (maxVolume * BigInt(i) / 4n);
    const label = formatAmount(volume.toString(), 18);

    // 在canvas左侧标记成交量
    for (let x = 0; x < Math.min(label.length, 10); x++) {
      if (y < height) {
        canvas[y][x] = label[x];
      }
    }
  }

  // 绘制柱状图
  displayData.forEach((data, idx) => {
    const x = 12 + idx * barWidth;
    const barHeight = Number(data.volume * BigInt(height - 1) / maxVolume);

    for (let i = 0; i < barHeight; i++) {
      const y = height - 1 - i;
      if (y >= 0 && y < height) {
        for (let dx = 0; dx < Math.min(barWidth - 1, 2); dx++) {
          if (x + dx < width) {
            canvas[y][x + dx] = '█';
          }
        }
      }
    }
  });

  // 输出画布
  for (let y = 0; y < height; y++) {
    const line = canvas[y].join('');
    console.log(chalk.cyan(line));
  }

  console.log('─'.repeat(width));

  // 绘制X轴时间刻度（每15分钟）
  const formatTime = (date) => {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  let timeAxisLine = ' '.repeat(12); // 左侧留空
  for (let i = 0; i < displayData.length; i++) {
    const minute = new Date(displayData[i].timestamp * 1000).getMinutes();
    if (minute % 15 === 0) {
      const time = formatTime(new Date(displayData[i].timestamp * 1000));
      const x = i * barWidth;

      // 插入时间标记
      while (timeAxisLine.length < 12 + x) {
        timeAxisLine += ' ';
      }
      timeAxisLine = timeAxisLine.slice(0, 12 + x) + chalk.yellow(time) + timeAxisLine.slice(12 + x + time.length);
    }
  }
  console.log(timeAxisLine);

  // 显示时间范围
  const startTime = new Date(displayData[0].timestamp * 1000);
  const endTime = new Date(displayData[displayData.length - 1].timestamp * 1000);

  console.log(`\nTime Range: ${chalk.yellow(formatTime(startTime))} - ${chalk.yellow(formatTime(endTime))}`);
  console.log(`Total Minutes: ${chalk.cyan(displayData.length)}`);
  console.log(`Max Volume: ${chalk.green(formatAmount(maxVolume.toString()))} USD/min`);

  // 计算总成交量和总交易数
  let totalVolume = 0n;
  let totalTrades = 0;
  for (const d of displayData) {
    totalVolume += d.volume;
    totalTrades += d.trades;
  }

  console.log(`Total Volume: ${chalk.green(formatAmount(totalVolume.toString()))} USD`);
  console.log(`Total Trades: ${chalk.cyan(totalTrades)}`);
  console.log(`Average Volume: ${chalk.yellow(formatAmount((totalVolume / BigInt(displayData.length)).toString()))} USD/min\n`);
}

/**
 * 显示基础统计信息
 */
function displayBasicStats(yesOrders, noOrders, topicInfo, allOrders) {
  console.log(chalk.bold.cyan('\n=== Trading Overview ===\n'));

  const yesVolume = yesOrders.reduce((sum, o) => sum + calculateVolume(o), 0n);
  const noVolume = noOrders.reduce((sum, o) => sum + calculateVolume(o), 0n);
  const totalVolume = yesVolume + noVolume;

  console.log(`Topic: ${chalk.green(topicInfo.title)}`);
  console.log(`YES Price: ${chalk.green(topicInfo.yesPrice)}`);
  console.log(`NO Price:  ${chalk.red(topicInfo.noPrice)}`);
  console.log('');

  console.log(`YES Orders: ${chalk.green(yesOrders.length.toString().padStart(8))}  Volume: ${chalk.green(formatAmount(yesVolume.toString()).padStart(15))} USD`);
  console.log(`NO Orders:  ${chalk.red(noOrders.length.toString().padStart(8))}  Volume: ${chalk.red(formatAmount(noVolume.toString()).padStart(15))} USD`);
  console.log(`Total:      ${chalk.cyan((yesOrders.length + noOrders.length).toString().padStart(8))}  Volume: ${chalk.cyan(formatAmount(totalVolume.toString()).padStart(15))} USD`);

  // 统计BUY/SELL
  const buyOrders = allOrders.filter(o => o.side === 'BUY');
  const sellOrders = allOrders.filter(o => o.side === 'SELL');
  const unknownOrders = allOrders.filter(o => !o.side || o.side === 'UNKNOWN');

  const buyVolume = buyOrders.reduce((sum, o) => sum + calculateVolume(o), 0n);
  const sellVolume = sellOrders.reduce((sum, o) => sum + calculateVolume(o), 0n);

  console.log('');
  console.log(`BUY Orders: ${chalk.green(buyOrders.length.toString().padStart(8))}  Volume: ${chalk.green(formatAmount(buyVolume.toString()).padStart(15))} USD`);
  console.log(`SELL Orders:${chalk.red(sellOrders.length.toString().padStart(8))}  Volume: ${chalk.red(formatAmount(sellVolume.toString()).padStart(15))} USD`);
  if (unknownOrders.length > 0) {
    console.log(`Unknown:    ${chalk.gray(unknownOrders.length.toString().padStart(8))}`);
  }
}

/**
 * 显示最近的交易记录
 */
function displayRecentTrades(orders, yesToken, noToken, limit = 20) {
  console.log(chalk.bold.cyan(`\n=== Recent ${limit} Trades ===\n`));

  if (orders.length === 0) {
    console.log(chalk.yellow('No trades found'));
    return;
  }

  // 按时间戳倒序排列，取最近的记录
  const recentOrders = [...orders]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  // 表头
  console.log(
    chalk.gray('Time'.padEnd(20)) +
    chalk.gray('Side'.padEnd(8)) +
    chalk.gray('B/S'.padEnd(6)) +
    chalk.gray('Price'.padEnd(12)) +
    chalk.gray('Shares'.padEnd(15)) +
    chalk.gray('Volume (USD)'.padEnd(15)) +
    chalk.gray('Tx Hash'.padEnd(20))
  );
  console.log('─'.repeat(96));

  // 显示每条交易
  for (const order of recentOrders) {
    const time = new Date(order.timestamp * 1000).toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    // 判断是YES还是NO
    let side = 'UNKNOWN';
    let sideColor = chalk.gray;
    let shares = 0n;
    let usdAmount = 0n;

    const makerAssetId = BigInt(order.makerAssetId);
    const takerAssetId = BigInt(order.takerAssetId);
    const makerFilled = BigInt(order.makerAmountFilled);
    const takerFilled = BigInt(order.takerAmountFilled);

    if (makerAssetId === BigInt(yesToken) || takerAssetId === BigInt(yesToken)) {
      side = 'YES';
      sideColor = chalk.green;
      // 如果 maker 是 YES token，则 makerFilled 是 shares
      if (makerAssetId === BigInt(yesToken)) {
        shares = makerFilled;
        usdAmount = takerFilled;
      } else {
        shares = takerFilled;
        usdAmount = makerFilled;
      }
    } else if (makerAssetId === BigInt(noToken) || takerAssetId === BigInt(noToken)) {
      side = 'NO';
      sideColor = chalk.red;
      // 如果 maker 是 NO token，则 makerFilled 是 shares
      if (makerAssetId === BigInt(noToken)) {
        shares = makerFilled;
        usdAmount = takerFilled;
      } else {
        shares = takerFilled;
        usdAmount = makerFilled;
      }
    }

    // 计算价格 = USD / Shares
    let price = '0.00';
    if (shares > 0n) {
      // 使用高精度计算: (usdAmount * 100) / shares，得到两位小数
      const priceScaled = (usdAmount * 100n) / shares;
      price = (Number(priceScaled) / 100).toFixed(2);
    }

    // 计算成交量
    const volume = calculateVolume(order);
    const volumeStr = formatAmount(volume.toString());

    // Shares 数量
    const sharesStr = formatAmount(shares.toString());

    // 交易哈希（截取前16位）
    const txHashShort = order.txHash ? order.txHash.slice(0, 16) + '...' : 'N/A';

    // BUY/SELL标记
    let buySellStr = '';
    let buySellColor = chalk.gray;
    if (order.side === 'BUY') {
      buySellStr = 'BUY';
      buySellColor = chalk.green;
    } else if (order.side === 'SELL') {
      buySellStr = 'SELL';
      buySellColor = chalk.red;
    } else {
      buySellStr = '-';
    }

    console.log(
      chalk.yellow(time.padEnd(20)) +
      sideColor(side.padEnd(8)) +
      buySellColor(buySellStr.padEnd(6)) +
      chalk.white(('$' + price).padEnd(12)) +
      chalk.magenta(sharesStr.padEnd(15)) +
      chalk.cyan(volumeStr.padEnd(15)) +
      chalk.gray(txHashShort)
    );
  }

  console.log('');
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(chalk.yellow('Usage: node dashboard.js <topicId>'));
    console.log(chalk.gray('\nExample:'));
    console.log(chalk.gray('  node dashboard.js 792'));
    console.log(chalk.gray('\nDisplays 60-minute volume chart (1 bar per minute)'));
    process.exit(0);
  }

  const firstArg = args[0];
  const isTopicId = !isNaN(firstArg) && firstArg.length < 10;

  if (!isTopicId) {
    console.log(chalk.red('Please use Topic ID'));
    console.log(chalk.yellow('Example: node dashboard.js 792'));
    process.exit(1);
  }

  const topicId = parseInt(firstArg);

  console.log(chalk.bold.cyan(`\n╔════════════════════════════════════════════════════════════╗`));
  console.log(chalk.bold.cyan(`║         Prediction Market Volume Dashboard                ║`));
  console.log(chalk.bold.cyan(`╚════════════════════════════════════════════════════════════╝`));

  // 获取 Topic 信息
  const topicAPI = new TopicAPI(undefined, config.proxy);
  let topicInfo;
  try {
    topicInfo = await topicAPI.getTopicInfo(topicId);
  } catch (error) {
    console.error(chalk.red('\n✗ Failed to fetch topic info:'), error.message);
    process.exit(1);
  }

  const yesToken = topicInfo.yesToken;
  const noToken = topicInfo.noToken;

  // 初始化数据库
  const db = new Database(config.database.path);
  await db.init();

  // 查询订单
  const allOrders = db.getOrdersByAssetIds([yesToken, noToken].filter(t => t && t !== '0'));

  if (allOrders.length === 0) {
    console.log(chalk.yellow('\n✗ No orders found for this topic'));
    db.close();
    process.exit(0);
  }

  // 分离YES和NO的订单
  const yesOrders = allOrders.filter(o =>
    o.makerAssetId === yesToken || o.takerAssetId === yesToken
  );

  const noOrders = allOrders.filter(o =>
    o.makerAssetId === noToken || o.takerAssetId === noToken
  );

  // 显示基础统计
  displayBasicStats(yesOrders, noOrders, topicInfo, allOrders);

  // 聚合所有订单的分钟成交量（YES + NO）
  const volumeData = aggregateVolumeByMinute(allOrders);

  // 绘制60分钟交易量柱状图
  drawVolumeChart(volumeData, 'Trading Volume (Last 60 Minutes)', 25, 120);

  // 显示最近20条交易记录
  displayRecentTrades(allOrders, yesToken, noToken, 20);

  db.close();
}

// 运行
main().catch(error => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});
