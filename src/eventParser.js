// OrdersMatched 事件签名
// OrdersMatched(bytes32 indexed takerOrderHash, address indexed takerOrderMaker,
//               uint256 makerAssetId, uint256 takerAssetId,
//               uint256 makerAmountFilled, uint256 takerAmountFilled)

const ORDERS_MATCHED_TOPIC = '0x63bf4d16b7fa898ef4c4b2b6d90fd201e9c56313b65638af6088d149d2ce956c';

/**
 * 解析16进制字符串为BigInt
 */
function hexToBigInt(hex) {
  return BigInt(hex).toString();
}

/**
 * 从日志中解析OrdersMatched事件
 * @param {Object} log - 交易日志
 * @returns {Object|null} 解析后的订单数据
 */
function parseOrdersMatchedEvent(log) {
  // 检查是否是OrdersMatched事件
  if (!log.topics || log.topics[0].toLowerCase() !== ORDERS_MATCHED_TOPIC.toLowerCase()) {
    return null;
  }

  try {
    // topics[0]: 事件签名
    // topics[1]: takerOrderHash (indexed)
    // topics[2]: takerOrderMaker (indexed address)
    const takerOrderHash = log.topics[1];
    const takerOrderMaker = '0x' + log.topics[2].slice(26); // 地址是后20字节

    // data 包含非indexed参数: makerAssetId, takerAssetId, makerAmountFilled, takerAmountFilled
    // 每个uint256占64个字符(32字节)
    const data = log.data.slice(2); // 移除 '0x'

    const makerAssetId = hexToBigInt('0x' + data.slice(0, 64));
    const takerAssetId = hexToBigInt('0x' + data.slice(64, 128));
    const makerAmountFilled = hexToBigInt('0x' + data.slice(128, 192));
    const takerAmountFilled = hexToBigInt('0x' + data.slice(192, 256));

    // blockNumber处理：
    // - BSCScan API: hex字符串如 "0x3f3b7a4"
    // - ethers.js filter: 数字如 66330633
    let blockNumber;
    if (typeof log.blockNumber === 'string') {
      blockNumber = log.blockNumber.startsWith('0x')
        ? parseInt(log.blockNumber, 16)
        : parseInt(log.blockNumber, 10);
    } else if (typeof log.blockNumber === 'number') {
      blockNumber = log.blockNumber;
    } else {
      blockNumber = 0;
    }

    // timestamp处理：
    // - BSCScan API: hex字符串如 "0x674a1234"
    // - ethers.js filter: 不存在此字段
    let timestamp;
    if (log.timeStamp) {
      if (typeof log.timeStamp === 'string') {
        timestamp = log.timeStamp.startsWith('0x')
          ? parseInt(log.timeStamp, 16)
          : parseInt(log.timeStamp, 10);
      } else {
        timestamp = log.timeStamp;
      }
    } else {
      // ethers.js filter没有timestamp，使用当前时间
      timestamp = Math.floor(Date.now() / 1000);
    }

    return {
      takerOrderHash,
      takerOrderMaker,
      makerAssetId,
      takerAssetId,
      makerAmountFilled,
      takerAmountFilled,
      blockNumber,
      timestamp,
      txHash: log.transactionHash
    };
  } catch (error) {
    console.error('Error parsing OrdersMatched event:', error);
    return null;
  }
}

/**
 * 从交易回执中提取所有OrdersMatched事件
 * @param {Object} receipt - 交易回执
 * @returns {Array} 解析后的订单数组
 */
function extractOrdersMatchedEvents(receipt) {
  if (!receipt || !receipt.logs) {
    return [];
  }

  const orders = [];
  for (const log of receipt.logs) {
    const order = parseOrdersMatchedEvent(log);
    if (order) {
      orders.push(order);
    }
  }

  return orders;
}

/**
 * 从BSCScan的getLogs结果中解析OrdersMatched事件
 * @param {Array} logs - BSCScan getLogs返回的日志数组
 * @returns {Array} 解析后的订单数组
 */
function parseLogsFromBSCScan(logs) {
  if (!Array.isArray(logs)) {
    return [];
  }

  const orders = [];
  for (const log of logs) {
    const order = parseOrdersMatchedEvent(log);
    if (order) {
      orders.push(order);
    }
  }

  return orders;
}

// USDT Transfer 事件签名
// Transfer(address indexed from, address indexed to, uint256 value)
const USDT_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';

/**
 * 解析USDT Transfer事件
 * @param {Object} log - 交易日志 (来自BSCScan API或RPC receipt)
 * @returns {Object|null} 解析后的转账数据
 */
function parseUSDTTransferEvent(log) {
  // 检查是否是Transfer事件且来自USDT合约
  if (!log.topics ||
      log.topics.length < 3 ||
      log.topics[0].toLowerCase() !== USDT_TRANSFER_TOPIC.toLowerCase() ||
      log.address.toLowerCase() !== USDT_ADDRESS.toLowerCase()) {
    return null;
  }

  try {
    // topics[0]: 事件签名
    // topics[1]: from (indexed address)
    // topics[2]: to (indexed address)
    const from = '0x' + log.topics[1].slice(26).toLowerCase();
    const to = '0x' + log.topics[2].slice(26).toLowerCase();

    // data 包含 value
    const value = hexToBigInt(log.data);

    return {
      from,
      to,
      value
    };
  } catch (error) {
    console.error('Error parsing USDT Transfer event:', error);
    return null;
  }
}

/**
 * 分析交易日志中的USDT流向，判断takerOrderMaker的净流入/流出
 * @param {Array} logs - 交易日志数组
 * @param {string} takerOrderMaker - takerOrderMaker地址
 * @returns {string} 'BUY' | 'SELL' | 'UNKNOWN'
 */
function determineBuySell(logs, takerOrderMaker) {
  if (!logs || logs.length === 0 || !takerOrderMaker) {
    return 'UNKNOWN';
  }

  const makerAddress = takerOrderMaker.toLowerCase();
  let netFlow = 0n; // 净流入为正，净流出为负

  for (const log of logs) {
    const transfer = parseUSDTTransferEvent(log);
    if (!transfer) continue;

    // 如果 takerOrderMaker 是接收方，净流入增加
    if (transfer.to === makerAddress) {
      netFlow += BigInt(transfer.value);
    }

    // 如果 takerOrderMaker 是发送方，净流入减少
    if (transfer.from === makerAddress) {
      netFlow -= BigInt(transfer.value);
    }
  }

  // 净流入为正 => SELL (卖出token获得USDT)
  // 净流出为负 => BUY (支付USDT购买token)
  if (netFlow > 0n) {
    return 'SELL';
  } else if (netFlow < 0n) {
    return 'BUY';
  }

  return 'UNKNOWN';
}

module.exports = {
  ORDERS_MATCHED_TOPIC,
  USDT_TRANSFER_TOPIC,
  USDT_ADDRESS,
  parseOrdersMatchedEvent,
  extractOrdersMatchedEvents,
  parseLogsFromBSCScan,
  parseUSDTTransferEvent,
  determineBuySell
};
