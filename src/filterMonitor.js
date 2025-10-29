const { ethers } = require('ethers');
const { HttpsProxyAgent } = require('https-proxy-agent');

class FilterMonitor {
  constructor(targetAddress, rpcUrls, proxyConfig, onEvent, options = {}) {
    this.targetAddress = targetAddress.toLowerCase();
    this.rpcUrls = rpcUrls;
    this.proxyConfig = proxyConfig;
    this.onEvent = onEvent; // 事件回调函数

    // 监听模式：'contract' - 监听合约所有事件，'transfer' - 监听所有涉及地址的Transfer事件
    this.mode = options.mode || 'transfer';

    this.providers = [];
    this.filters = [];
    this.isRunning = false;

    // 交易哈希去重 - 使用Map存储txHash和时间戳
    this.processedTxs = new Map();

    // LRU配置：1分钟过期
    this.TX_EXPIRE_TIME = 60 * 1000;

    // Filter刷新间隔：3分钟
    this.FILTER_REFRESH_INTERVAL = 3 * 60 * 1000;

    // Filter创建间隔：2秒
    this.FILTER_CREATE_DELAY = 2000;

    this.refreshTimer = null;
    this.cleanupTimer = null;

    // ERC-1155 事件签名
    // TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)
    this.TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
    // TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)
    this.TRANSFER_BATCH_TOPIC = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

    // 将地址转换为32字节的indexed参数格式
    this.addressTopic = '0x' + this.targetAddress.slice(2).padStart(64, '0');
  }

  // 清理过期的交易哈希（LRU机制）
  cleanupExpiredTxs() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [txHash, timestamp] of this.processedTxs.entries()) {
      if (now - timestamp > this.TX_EXPIRE_TIME) {
        this.processedTxs.delete(txHash);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[FilterMonitor] Cleaned up ${cleanedCount} expired tx records. Current cache size: ${this.processedTxs.size}`);
    }
  }

  // 检查交易是否已处理过
  isTransactionProcessed(txHash) {
    return this.processedTxs.has(txHash);
  }

  // 标记交易为已处理
  markTransactionAsProcessed(txHash) {
    this.processedTxs.set(txHash, Date.now());
  }

  // 初始化Provider
  async initializeProviders() {
    this.providers = [];
    const agent = this.proxyConfig.enabled ? new HttpsProxyAgent(this.proxyConfig.url) : null;

    for (const rpcUrl of this.rpcUrls) {
      try {
        const fetchRequest = new ethers.FetchRequest(rpcUrl);

        if (agent) {
          fetchRequest.getUrlFunc = ethers.FetchRequest.createGetUrlFunc({ agent });
        }

        const provider = new ethers.JsonRpcProvider(fetchRequest);

        // 测试连接
        await provider.getBlockNumber();

        this.providers.push({ provider, rpcUrl });
        console.log(`[FilterMonitor] ✅ Connected to RPC: ${rpcUrl}`);
      } catch (error) {
        console.log(`[FilterMonitor] ❌ Failed to connect to RPC: ${rpcUrl} - ${error.message}`);
      }
    }

    if (this.providers.length === 0) {
      throw new Error('Failed to connect to any RPC nodes');
    }

    console.log(`[FilterMonitor] 🌐 Connected to ${this.providers.length} RPC nodes`);
  }

  // 创建Filter监听器
  async createFilters() {
    this.filters = [];

    for (let i = 0; i < this.providers.length; i++) {
      try {
        const providerInfo = this.providers[i];

        // 根据模式创建不同的filter配置
        let filterConfigs = [];

        if (this.mode === 'contract') {
          // 模式1：监听特定合约的所有事件
          filterConfigs.push({
            address: this.targetAddress,
            fromBlock: 'latest'
          });
        } else if (this.mode === 'transfer') {
          // 模式2：监听所有涉及目标地址的ERC-1155 Transfer事件
          // TransferSingle: from=target
          filterConfigs.push({
            topics: [this.TRANSFER_SINGLE_TOPIC, null, this.addressTopic],
            fromBlock: 'latest'
          });
          // TransferSingle: to=target
          filterConfigs.push({
            topics: [this.TRANSFER_SINGLE_TOPIC, null, null, this.addressTopic],
            fromBlock: 'latest'
          });
          // TransferBatch: from=target
          filterConfigs.push({
            topics: [this.TRANSFER_BATCH_TOPIC, null, this.addressTopic],
            fromBlock: 'latest'
          });
          // TransferBatch: to=target
          filterConfigs.push({
            topics: [this.TRANSFER_BATCH_TOPIC, null, null, this.addressTopic],
            fromBlock: 'latest'
          });
        } else if (this.mode === 'contract-transfer') {
          // 模式3：监听特定合约的Transfer事件（ERC-1155）
          filterConfigs.push({
            address: this.targetAddress,
            topics: [this.TRANSFER_SINGLE_TOPIC],
            fromBlock: 'latest'
          });
          filterConfigs.push({
            address: this.targetAddress,
            topics: [this.TRANSFER_BATCH_TOPIC],
            fromBlock: 'latest'
          });
        }

        // 为每个filter配置创建监听器
        for (let j = 0; j < filterConfigs.length; j++) {
          const filterConfig = filterConfigs[j];

          // 事件处理函数
          const eventHandler = async (log) => {
            try {
              const txHash = log.transactionHash;

              // 去重检查
              if (this.isTransactionProcessed(txHash)) {
                return;
              }

              console.log(`[FilterMonitor] 🔍 New transaction detected: ${txHash}`);

              // 标记为已处理
              this.markTransactionAsProcessed(txHash);

              // 调用回调函数
              if (this.onEvent) {
                await this.onEvent(log);
              }
            } catch (error) {
              console.error(`[FilterMonitor] Error handling event: ${error.message}`);
            }
          };

          // 使用provider监听
          providerInfo.provider.on(filterConfig, eventHandler);

          this.filters.push({
            filter: filterConfig,
            provider: providerInfo.provider,
            rpcUrl: providerInfo.rpcUrl,
            handler: eventHandler
          });
        }

        console.log(`[FilterMonitor] ✅ Created ${filterConfigs.length} filter(s) on provider ${i + 1}/${this.providers.length} (${providerInfo.rpcUrl})`);

        // 错开创建时间，避免同时创建
        if (i < this.providers.length - 1) {
          await new Promise(resolve => setTimeout(resolve, this.FILTER_CREATE_DELAY));
        }
      } catch (error) {
        console.error(`[FilterMonitor] ❌ Failed to create filter on ${this.providers[i].rpcUrl}: ${error.message}`);
      }
    }

    console.log(`[FilterMonitor] Created ${this.filters.length} total filters`);
  }

  // 刷新Filter
  async refreshFilters() {
    if (!this.isRunning) return;

    console.log('[FilterMonitor] 🔄 Refreshing filters...');

    // 移除旧filter
    this.filters.forEach(filterInfo => {
      try {
        filterInfo.provider.off(filterInfo.filter, filterInfo.handler);
      } catch (error) {
        console.error(`[FilterMonitor] Error removing old filter: ${error.message}`);
      }
    });

    // 创建新filter
    await this.createFilters();

    console.log('[FilterMonitor] ✅ Filters refreshed');
  }

  // 启动监听
  async start() {
    if (this.isRunning) {
      console.log('[FilterMonitor] Already running');
      return;
    }

    console.log('[FilterMonitor] Starting filter monitor...');

    // 初始化providers
    await this.initializeProviders();

    // 创建filters
    await this.createFilters();

    this.isRunning = true;

    // 定期刷新filters
    this.refreshTimer = setInterval(() => {
      this.refreshFilters().catch(error => {
        console.error(`[FilterMonitor] Error refreshing filters: ${error.message}`);
      });
    }, this.FILTER_REFRESH_INTERVAL);

    // 定期清理过期交易记录
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredTxs();
    }, 30 * 1000); // 每30秒清理一次

    console.log('[FilterMonitor] ✅ Filter monitor started');
  }

  // 停止监听
  stop() {
    if (!this.isRunning) {
      console.log('[FilterMonitor] Not running');
      return;
    }

    console.log('[FilterMonitor] Stopping filter monitor...');

    this.isRunning = false;

    // 清除定时器
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 移除所有filters
    this.filters.forEach(filterInfo => {
      try {
        filterInfo.provider.off(filterInfo.filter, filterInfo.handler);
      } catch (error) {
        console.error(`[FilterMonitor] Error removing filter: ${error.message}`);
      }
    });

    this.filters = [];

    // 清理交易记录
    this.processedTxs.clear();

    console.log('[FilterMonitor] ✅ Filter monitor stopped');
  }

  // 获取统计信息
  getStats() {
    return {
      isRunning: this.isRunning,
      providerCount: this.providers.length,
      filterCount: this.filters.length,
      processedTxsCount: this.processedTxs.size
    };
  }
}

module.exports = FilterMonitor;
