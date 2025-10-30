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

    this.cleanupTimer = null;

    // 存储所有filter的定时器，用于滚动刷新
    this.filterTimers = [];

    // 节点黑名单：Map<rpcUrl, blacklistUntilTimestamp>
    this.blacklistedNodes = new Map();
    this.NODE_BLACKLIST_TIME = 5 * 60 * 1000; // 5分钟

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

  // 检查节点是否被拉黑
  isNodeBlacklisted(rpcUrl) {
    const blacklistUntil = this.blacklistedNodes.get(rpcUrl);
    if (!blacklistUntil) return false;

    if (Date.now() >= blacklistUntil) {
      this.blacklistedNodes.delete(rpcUrl);
      return false;
    }
    return true;
  }

  // 将节点拉黑
  blacklistNode(rpcUrl, reason = '') {
    const until = Date.now() + this.NODE_BLACKLIST_TIME;
    this.blacklistedNodes.set(rpcUrl, until);
    console.log(`[FilterMonitor] ⛔ Blacklisted node ${rpcUrl} for 5 minutes. Reason: ${reason}`);
  }

  // 获取可用的providers（未被拉黑的）
  getAvailableProviders() {
    return this.providers.filter(p => !this.isNodeBlacklisted(p.rpcUrl));
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

  // 获取filter配置（根据模式）
  getFilterConfigs() {
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

    return filterConfigs;
  }

  // 创建单个filter
  createSingleFilter(providerInfo, filterConfig, filterIndex) {
    try {
      // 检查节点是否被拉黑
      if (this.isNodeBlacklisted(providerInfo.rpcUrl)) {
        console.log(`[FilterMonitor] ⏭️  Skip blacklisted node: ${providerInfo.rpcUrl}`);
        return null;
      }

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

      const filterInfo = {
        filter: filterConfig,
        provider: providerInfo.provider,
        rpcUrl: providerInfo.rpcUrl,
        handler: eventHandler,
        index: filterIndex,
        createdAt: Date.now()
      };

      console.log(`[FilterMonitor] ✅ Created filter #${filterIndex} on ${providerInfo.rpcUrl}`);
      return filterInfo;

    } catch (error) {
      console.error(`[FilterMonitor] ❌ Failed to create filter on ${providerInfo.rpcUrl}: ${error.message}`);
      // 创建失败，拉黑节点
      this.blacklistNode(providerInfo.rpcUrl, `Filter creation failed: ${error.message}`);
      return null;
    }
  }

  // 移除单个filter
  removeSingleFilter(filterInfo) {
    try {
      if (filterInfo && filterInfo.provider && filterInfo.handler) {
        filterInfo.provider.off(filterInfo.filter, filterInfo.handler);
        console.log(`[FilterMonitor] 🗑️  Removed filter #${filterInfo.index} from ${filterInfo.rpcUrl}`);
      }
    } catch (error) {
      console.error(`[FilterMonitor] Error removing filter: ${error.message}`);
    }
  }

  // 安排单个filter的创建和周期性刷新
  scheduleSingleFilter(providerInfo, filterConfig, filterIndex, initialDelay) {
    // 初次创建延迟
    const createTimer = setTimeout(() => {
      if (!this.isRunning) return;

      // 创建filter
      const filterInfo = this.createSingleFilter(providerInfo, filterConfig, filterIndex);

      if (filterInfo) {
        // 添加到filters数组
        this.filters[filterIndex] = filterInfo;

        // 设置周期性刷新
        const refreshTimer = setInterval(() => {
          if (!this.isRunning) return;

          console.log(`[FilterMonitor] 🔄 Refreshing filter #${filterIndex}...`);

          // 移除旧filter
          this.removeSingleFilter(this.filters[filterIndex]);

          // 创建新filter
          const newFilterInfo = this.createSingleFilter(providerInfo, filterConfig, filterIndex);

          if (newFilterInfo) {
            this.filters[filterIndex] = newFilterInfo;
          } else {
            // 如果创建失败，尝试使用其他可用节点
            const availableProviders = this.getAvailableProviders();
            if (availableProviders.length > 0) {
              const randomProvider = availableProviders[Math.floor(Math.random() * availableProviders.length)];
              console.log(`[FilterMonitor] 🔀 Trying alternative provider for filter #${filterIndex}: ${randomProvider.rpcUrl}`);
              const altFilterInfo = this.createSingleFilter(randomProvider, filterConfig, filterIndex);
              if (altFilterInfo) {
                this.filters[filterIndex] = altFilterInfo;
              }
            }
          }
        }, this.FILTER_REFRESH_INTERVAL);

        // 保存刷新定时器
        this.filterTimers[filterIndex] = { createTimer, refreshTimer };
      } else {
        // 如果初次创建失败，尝试其他节点
        const availableProviders = this.getAvailableProviders();
        if (availableProviders.length > 0) {
          const randomProvider = availableProviders[Math.floor(Math.random() * availableProviders.length)];
          console.log(`[FilterMonitor] 🔀 Trying alternative provider for filter #${filterIndex}: ${randomProvider.rpcUrl}`);

          const altFilterInfo = this.createSingleFilter(randomProvider, filterConfig, filterIndex);
          if (altFilterInfo) {
            this.filters[filterIndex] = altFilterInfo;

            // 设置周期性刷新
            const refreshTimer = setInterval(() => {
              if (!this.isRunning) return;

              console.log(`[FilterMonitor] 🔄 Refreshing filter #${filterIndex}...`);
              this.removeSingleFilter(this.filters[filterIndex]);

              const newFilterInfo = this.createSingleFilter(randomProvider, filterConfig, filterIndex);
              if (newFilterInfo) {
                this.filters[filterIndex] = newFilterInfo;
              }
            }, this.FILTER_REFRESH_INTERVAL);

            this.filterTimers[filterIndex] = { createTimer, refreshTimer };
          }
        }
      }
    }, initialDelay);

    // 保存创建定时器（刷新定时器会在创建后保存）
    this.filterTimers[filterIndex] = { createTimer, refreshTimer: null };
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

    this.isRunning = true;

    // 获取filter配置
    const filterConfigs = this.getFilterConfigs();

    // 计算总的filter数量
    const totalFilters = this.providers.length * filterConfigs.length;

    // 计算每个filter的创建间隔，在整个刷新周期内均匀分布
    const createInterval = this.FILTER_REFRESH_INTERVAL / totalFilters;

    console.log(`[FilterMonitor] 📊 Planning to create ${totalFilters} filters (${this.providers.length} providers × ${filterConfigs.length} configs)`);
    console.log(`[FilterMonitor] ⏱️  Filter creation interval: ${(createInterval / 1000).toFixed(2)}s`);

    // 初始化filters数组
    this.filters = new Array(totalFilters);
    this.filterTimers = new Array(totalFilters);

    // 为每个provider和每个filterConfig组合创建filter
    let filterIndex = 0;
    for (let i = 0; i < this.providers.length; i++) {
      const providerInfo = this.providers[i];

      for (let j = 0; j < filterConfigs.length; j++) {
        const filterConfig = filterConfigs[j];

        // 计算此filter的初始延迟（均匀分布）
        const initialDelay = filterIndex * createInterval;

        console.log(`[FilterMonitor] 📅 Scheduled filter #${filterIndex} on ${providerInfo.rpcUrl} to be created in ${(initialDelay / 1000).toFixed(2)}s`);

        // 安排filter的创建和周期性刷新
        this.scheduleSingleFilter(providerInfo, filterConfig, filterIndex, initialDelay);

        filterIndex++;
      }
    }

    // 定期清理过期交易记录
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredTxs();
    }, 30 * 1000); // 每30秒清理一次

    console.log('[FilterMonitor] ✅ Filter monitor started with rolling refresh mechanism');
    console.log(`[FilterMonitor] 🔄 Filters will be refreshed every ${this.FILTER_REFRESH_INTERVAL / 1000}s`);
  }

  // 停止监听
  stop() {
    if (!this.isRunning) {
      console.log('[FilterMonitor] Not running');
      return;
    }

    console.log('[FilterMonitor] Stopping filter monitor...');

    this.isRunning = false;

    // 清除cleanup定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 清除所有filter的定时器
    this.filterTimers.forEach((timers, index) => {
      if (timers) {
        if (timers.createTimer) {
          clearTimeout(timers.createTimer);
        }
        if (timers.refreshTimer) {
          clearInterval(timers.refreshTimer);
        }
      }
    });

    // 移除所有filters
    this.filters.forEach(filterInfo => {
      this.removeSingleFilter(filterInfo);
    });

    this.filters = [];
    this.filterTimers = [];

    // 清理交易记录
    this.processedTxs.clear();

    // 清理节点黑名单
    this.blacklistedNodes.clear();

    console.log('[FilterMonitor] ✅ Filter monitor stopped');
  }

  // 获取统计信息
  getStats() {
    const activeFilters = this.filters.filter(f => f !== undefined && f !== null).length;
    const blacklistedNodesCount = this.blacklistedNodes.size;
    const availableProviders = this.getAvailableProviders().length;

    return {
      isRunning: this.isRunning,
      providerCount: this.providers.length,
      availableProviders: availableProviders,
      filterCount: this.filters.length,
      activeFilters: activeFilters,
      processedTxsCount: this.processedTxs.size,
      blacklistedNodesCount: blacklistedNodesCount
    };
  }
}

module.exports = FilterMonitor;
