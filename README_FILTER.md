# RPC Filter 监听系统

## 概述

已将监听方式从BSCScan API轮询改为RPC Filter持久化监听，专门监听ERC-1155 NFT合约的Transfer事件。

## 核心特性

### 1. 多RPC节点并发监听
- 支持同时使用多个RPC节点（默认16个）
- 每个节点创建独立的filter
- 节点故障自动容错

### 2. 交易去重机制
- 使用Map存储已处理的交易哈希
- LRU策略：1分钟后自动清理过期记录
- 防止同一交易被多个filter重复触发

### 3. Filter自动刷新
- 每3分钟自动刷新所有filter
- 防止RPC节点filter过期失效
- 创建filter时错开2秒避免并发冲突

### 4. ERC-1155 Transfer监听
- 监听TransferSingle事件
- 监听TransferBatch事件
- 支持三种监听模式（详见FILTER_MODES.md）

## 文件说明

### 核心文件
- **src/filterMonitor.js** - Filter监听核心类
- **monitorServer.js** - 监听服务主程序
- **src/eventParser.js** - 事件解析（兼容BSCScan和ethers.js格式）

### 测试文件
- **test_erc1155_transfer.js** - ERC-1155 Transfer事件测试
- **debug_log_structure.js** - Log数据结构调试
- **test_orders_matched.js** - OrdersMatched事件测试
- **test_filterMonitor.js** - FilterMonitor基本功能测试

### 文档
- **FILTER_MODES.md** - 三种监听模式详细说明
- **TESTING.md** - 测试指南
- **README_FILTER.md** - 本文档

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 配置config.json
确保配置了多个RPC节点和代理（如需要）：
```json
{
  "contract": {
    "address": "0xad1a38cec043e70e83a3ec30443db285ed10d774"
  },
  "api": {
    "bsc_rpc_urls": [
      "https://bsc-rpc.publicnode.com",
      "https://bsc-dataseed1.binance.org/",
      ...
    ]
  },
  "proxy": {
    "enabled": true,
    "url": "http://172.18.80.1:10809"
  }
}
```

### 3. 运行测试
```bash
# 测试ERC-1155 Transfer监听
node test_erc1155_transfer.js
```

### 4. 启动监听服务
```bash
node monitorServer.js
```

## 监听模式

当前使用 **contract-transfer** 模式：
- 监听特定合约的所有Transfer事件
- 每个RPC节点创建2个filter（TransferSingle + TransferBatch）
- 16个RPC = 32个filter总数

## 技术细节

### Filter配置示例
```javascript
// TransferSingle
{
  address: '0xad1a38cec043e70e83a3ec30443db285ed10d774',
  topics: ['0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'],
  fromBlock: 'latest'
}

// TransferBatch  
{
  address: '0xad1a38cec043e70e83a3ec30443db285ed10d774',
  topics: ['0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'],
  fromBlock: 'latest'
}
```

### 去重LRU机制
```javascript
// 存储结构
processedTxs = Map<txHash, timestamp>

// 检查
if (processedTxs.has(txHash)) return;

// 标记
processedTxs.set(txHash, Date.now());

// 清理（每30秒）
for (const [hash, time] of processedTxs) {
  if (Date.now() - time > 60000) {
    processedTxs.delete(hash);
  }
}
```

### 数据兼容性
eventParser.js兼容两种log格式：

**BSCScan API**:
```javascript
{
  blockNumber: "0x3f3b7a4",  // hex string
  timeStamp: "0x674a1234",    // hex string
  ...
}
```

**ethers.js Filter**:
```javascript
{
  blockNumber: 66330633,      // number
  // no timeStamp field
  ...
}
```

## 性能优化

1. **并发监听**: 16个RPC节点同时监听，提高可靠性
2. **内存优化**: LRU清理机制防止内存泄漏
3. **错开创建**: Filter创建间隔2秒，避免同时请求
4. **自动刷新**: 3分钟刷新避免filter失效

## 故障处理

### RPC节点失败
- 自动跳过失败节点
- 其他节点继续工作
- 3分钟后重试刷新

### Filter创建失败
- 记录错误日志
- 继续创建其他filter
- 不影响已创建的filter

### 事件处理错误
- 捕获并记录错误
- 不影响其他事件处理
- 继续监听新事件

## 监控统计

每分钟输出统计信息：
```
[Stats] Filter Monitor: 32 filters active, 15 txs in cache
[Stats] Database: 1234 total orders
```

## 注意事项

1. 需要稳定的网络连接到BSC RPC节点
2. 如果在国内，建议配置代理
3. Filter会监听latest区块，不会漏掉任何新交易
4. 已处理的交易会在1分钟后从缓存中清除

## 与BSCScan API对比

| 特性 | BSCScan API | RPC Filter |
|------|-------------|------------|
| 实时性 | 延迟30秒+ | 实时(<3秒) |
| 可靠性 | 经常失灵 | 稳定可靠 |
| 并发 | 单点请求 | 16节点并发 |
| 费用 | API限制 | RPC免费 |
| 去重 | 无 | LRU机制 |

## 未来优化

1. [ ] 添加事件通知功能（Webhook）
2. [ ] 支持动态添加/移除RPC节点
3. [ ] 添加更多监听模式
4. [ ] 完善错误重试机制
5. [ ] 添加性能监控面板
