# 测试说明

## 修改内容

已将监听方式从BSCScan API轮询改为RPC Filter持久化监听，支持监听ERC-1155的Transfer事件。

## 监听模式

支持三种监听模式（详见 FILTER_MODES.md）：
- **contract**: 监听合约所有事件
- **transfer**: 监听地址所有Transfer（跨合约）
- **contract-transfer**: 监听合约的Transfer事件 ⭐ 当前使用

## 测试脚本

1. **test_erc1155_transfer.js** - 测试ERC-1155 Transfer事件监听 ⭐ 推荐
   ```bash
   node test_erc1155_transfer.js
   ```

2. **debug_log_structure.js** - 查看原始log数据结构
   ```bash
   node debug_log_structure.js
   ```

3. **test_orders_matched.js** - 测试OrdersMatched事件检测和解析
   ```bash
   node test_orders_matched.js
   ```

4. **test_filterMonitor.js** - 测试FilterMonitor基本功能
   ```bash
   node test_filterMonitor.js
   ```

## 启动监听服务

```bash
node monitorServer.js
```

当前配置监听合约 `0xad1a38cec043e70e83a3ec30443db285ed10d774` 的所有ERC-1155 Transfer事件。

## 数据结构变化

### BSCScan API log格式
```javascript
{
  blockNumber: "0x3f3b7a4",  // hex字符串
  timeStamp: "0x674a1234",    // hex字符串
  transactionHash: "0x...",
  topics: [...],
  data: "0x..."
}
```

### ethers.js filter log格式
```javascript
{
  _type: "log",
  blockNumber: 66330633,      // 数字
  // 没有 timeStamp 字段
  transactionHash: "0x...",
  topics: [...],
  data: "0x...",
  index: 834
}
```

## 关键修改

1. **eventParser.js** - 兼容两种log格式
   - blockNumber: 支持hex字符串和数字
   - timestamp: 当不存在时使用当前时间

2. **filterMonitor.js** - 新建
   - 16个RPC节点并发监听
   - Map+LRU去重(1分钟过期)
   - 每3分钟自动刷新filter
   - 错开2秒创建避免并发冲突

3. **monitorServer.js** - 使用FilterMonitor
   - 实时监听事件
   - 打印完整log用于调试
   - 自动解析和落库
