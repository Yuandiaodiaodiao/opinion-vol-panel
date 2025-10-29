const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

class BSCApi {
  constructor(apiUrl, apiKey, proxyConfig, rpcUrl, rpcPool = null) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.rpcUrl = rpcUrl;
    this.agent = proxyConfig.enabled ? new HttpsProxyAgent(proxyConfig.url) : null;
    this.rpcPool = rpcPool; // RPC池实例
  }

  async request(params) {
    const config = {
      method: 'get',
      url: this.apiUrl,
      params: {
        apikey: this.apiKey,
        chainid: 56,  // BSC chainid
        ...params
      }
    };

    if (this.agent) {
      config.httpsAgent = this.agent;
      config.proxy = false;
    }

    // 构建完整的请求URL用于调试
    const queryParams = new URLSearchParams(config.params).toString();
    const fullUrl = `${this.apiUrl}?${queryParams}`;

    try {
      const response = await axios(config);
      console.log(response);
      if (response.data.status === '1') {
        return response.data.result;
      } else if (response.data.status === '0' &&
                 (response.data.message === 'No transactions found' ||
                  response.data.message === 'No records found')) {
        return [];
      } else {
        console.error(`\n[BSCScan API Error]`);
        console.error(`Message: ${response.data.message}`);
        console.error(`Request URL: ${fullUrl}\n`);
        throw new Error(`BSCScan API Error: ${response.data.message}`);
      }
    } catch (error) {
      if (error.response) {
        console.error(`\n[BSCScan API Request Failed]`);
        console.error(`Status: ${error.response.status} - ${error.response.statusText}`);
        console.error(`Request URL: ${fullUrl}\n`);
        throw new Error(`BSCScan API request failed: ${error.response.status} - ${error.response.statusText}`);
      } else if (!error.message.includes('BSCScan API Error')) {
        // 如果不是上面已经处理过的BSCScan API Error，打印URL
        console.error(`\n[Request Error]`);
        console.error(`Message: ${error.message}`);
        console.error(`Request URL: ${fullUrl}\n`);
      }
      throw error;
    }
  }

  async getERC1155Transfers(contractAddress, address = null, startBlock = 0, endBlock = 99999999, page = 1, offset = 100) {
    const params = {
      module: 'account',
      action: 'token1155tx',
      contractaddress: contractAddress,
      startblock: startBlock,
      endblock: endBlock,
      page: page,
      offset: offset,
      sort: 'asc'
    };

    if (address) {
      params.address = address;
    }

    return await this.request(params);
  }

  async getTransactionByHash(txHash) {
    const params = {
      module: 'proxy',
      action: 'eth_getTransactionByHash',
      txhash: txHash
    };

    return await this.request(params);
  }

  async getTransactionReceipt(txHash) {
    const params = {
      module: 'proxy',
      action: 'eth_getTransactionReceipt',
      txhash: txHash
    };

    return await this.request(params);
  }

  async getLogs(fromBlock, toBlock, topic0 = null) {
    const params = {
      module: 'logs',
      action: 'getLogs',
      fromBlock: fromBlock,
      toBlock: toBlock
    };

    if (topic0) {
      params.topic0 = topic0;
    }

    return await this.request(params);
  }

  async getLatestBlockNumber() {
    // 如果有RPC池，使用RPC池
    if (this.rpcPool) {
      return this.rpcPool.getLatestBlockNumber();
    }

    // 否则使用单一RPC
    const config = {
      method: 'post',
      url: this.rpcUrl,
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

    try {
      const response = await axios(config);

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return parseInt(response.data.result, 16);
    } catch (error) {
      if (error.response) {
        throw new Error(`RPC request failed: ${error.response.status} - ${error.response.statusText}`);
      } else {
        throw error;
      }
    }
  }

  async getTransactionReceiptByRPC(txHash) {
    // 如果有RPC池，使用RPC池
    if (this.rpcPool) {
      return this.rpcPool.getTransactionReceipt(txHash);
    }

    // 否则使用单一RPC
    const config = {
      method: 'post',
      url: this.rpcUrl,
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

    try {
      const response = await axios(config);

      if (response.data.error) {
        throw new Error(`RPC Error: ${response.data.error.message}`);
      }

      return response.data.result;
    } catch (error) {
      if (error.response) {
        throw new Error(`RPC request failed: ${error.response.status} - ${error.response.statusText}`);
      } else {
        throw error;
      }
    }
  }

  // 批量并发获取交易回执
  async batchGetTransactionReceipts(txHashes, concurrency = 10) {
    if (this.rpcPool) {
      return this.rpcPool.batchGetTransactionReceipts(txHashes, concurrency);
    }

    // 如果没有RPC池，使用传统方式
    const results = [];
    for (const txHash of txHashes) {
      try {
        const receipt = await this.getTransactionReceiptByRPC(txHash);
        results.push(receipt);
      } catch (error) {
        console.error(`Error getting receipt for ${txHash.slice(0, 16)}...: ${error.message}`);
        results.push(null);
      }
    }
    return results;
  }
}

module.exports = BSCApi;
