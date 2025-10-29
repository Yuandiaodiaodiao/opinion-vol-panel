const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class RPCPool {
  constructor(rpcUrls, proxyConfig = null) {
    this.rpcUrls = [...rpcUrls];
    this.blacklist = new Map(); // {url: blacklistUntilTimestamp}
    this.currentIndex = 0;
    this.agent = proxyConfig && proxyConfig.enabled
      ? new HttpsProxyAgent(proxyConfig.url)
      : null;
  }

  getAvailableRPCs() {
    const currentTime = Date.now();

    // 清理过期的黑名单
    for (const [url, untilTime] of this.blacklist.entries()) {
      if (currentTime > untilTime) {
        this.blacklist.delete(url);
      }
    }

    // 返回非黑名单中的RPC
    return this.rpcUrls.filter(url => !this.blacklist.has(url));
  }

  getNextRPC() {
    const availableRPCs = this.getAvailableRPCs();

    if (availableRPCs.length === 0) {
      console.log('警告: 所有RPC都在黑名单中，等待5秒后重试...');
      return new Promise(resolve => {
        setTimeout(() => resolve(this.getNextRPC()), 5000);
      });
    }

    const rpcUrl = availableRPCs[this.currentIndex % availableRPCs.length];
    this.currentIndex++;
    return rpcUrl;
  }

  markFailed(rpcUrl) {
    const blacklistUntil = Date.now() + 5000; // 5秒黑名单
    this.blacklist.set(rpcUrl, blacklistUntil);
    console.log(`  RPC ${rpcUrl} 已加入黑名单5秒`);
  }

  async executeWithRetry(operation, ...args) {
    const maxRetries = this.rpcUrls.length;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const rpcUrl = await this.getNextRPC();

      try {
        const result = await operation(rpcUrl, ...args);
        return result;
      } catch (error) {
        console.log(`  RPC ${rpcUrl} 操作失败: ${error.message}`);
        this.markFailed(rpcUrl);

        if (attempt === maxRetries - 1) {
          console.error('  所有RPC都已尝试失败');
          throw error;
        }
      }
    }
  }

  async getTransactionReceipt(txHash) {
    return this.executeWithRetry(async (rpcUrl) => {
      const config = {
        method: 'post',
        url: rpcUrl,
        headers: {
          'Content-Type': 'application/json'
        },
        data: {
          jsonrpc: '2.0',
          method: 'eth_getTransactionReceipt',
          params: [txHash],
          id: 1
        }
      };

      if (this.agent) {
        config.httpsAgent = this.agent;
        config.proxy = false;
      }

      const response = await axios(config);

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return response.data.result;
    });
  }

  async getLatestBlockNumber() {
    return this.executeWithRetry(async (rpcUrl) => {
      const config = {
        method: 'post',
        url: rpcUrl,
        headers: {
          'Content-Type': 'application/json'
        },
        data: {
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1
        }
      };

      if (this.agent) {
        config.httpsAgent = this.agent;
        config.proxy = false;
      }

      const response = await axios(config);

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return parseInt(response.data.result, 16);
    });
  }

  // 批量并发获取交易回执
  async batchGetTransactionReceipts(txHashes, concurrency = 10) {
    const results = [];
    const chunks = [];

    // 分批处理
    for (let i = 0; i < txHashes.length; i += concurrency) {
      chunks.push(txHashes.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(txHash =>
        this.getTransactionReceipt(txHash).catch(error => {
          console.error(`  Error getting receipt for ${txHash.slice(0, 16)}...: ${error.message}`);
          return null;
        })
      );

      const chunkResults = await Promise.all(promises);
      results.push(...chunkResults);

      // 添加小延迟避免请求过快
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }
}

module.exports = RPCPool;
