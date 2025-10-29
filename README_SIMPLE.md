# OP Volume Monitor - 简化版

预测市场交易量监控系统 - 专注于成交量展示

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动监听服务

```bash
npm run monitor
```

监听服务会：
- 自动从最新区块开始监听
- 每30秒扫描一次OrdersMatched事件
- 将交易数据存入SQLite数据库
- 持续运行直到手动停止（Ctrl+C）

### 3. 查看Dashboard

```bash
node dashboard.js <topicId>
```

示例：
```bash
node dashboard.js 792
```

## Dashboard展示内容

### 1. 交易概览

```
Topic: Ethereum all time high by October 31?
YES Price: 0.057
NO Price:  0.943

YES Orders:      117  Volume:  130085.41 USD
NO Orders:        90  Volume:   99114.79 USD
Total:           207  Volume:  229200.21 USD
```

### 2. 60分钟交易量图表

- **每根柱子**: 代表1分钟的总交易量（YES + NO合并）
- **Y轴**: 交易量（USD/分钟）
- **X轴**: 时间刻度（每15分钟标注）
- **显示范围**: 最近60分钟

```
7585.83                                     █
                                            █
                        █                   █
5689.37                 █                   █
                  █     █             █     █
3792.91     █     █     █       █     █     █
      █     █     █     █ █     █     █     █
1896.45█ █  █ █   █ █   █ █ █   █ █   █ █   █
────────────────────────────────────────────────
      07:30       07:45       08:00       08:15
```

### 3. 统计信息

- 时间范围
- 总交易量（USD）
- 总交易笔数
- 平均每分钟交易量
- 峰值交易量

## 测试数据生成

如果数据库中没有足够数据，可以生成测试数据：

```bash
npm run test:gen
# 或
node generate_60min_test_data.js
```

这会生成60分钟的模拟交易数据（每分钟1-5笔随机交易）。

## 配置文件

`config.json`:

```json
{
  "api": {
    "bsc_api_key": "YOUR_API_KEY",
    "bsc_api_url": "https://api.bscscan.com/api",
    "bsc_rpc_url": "https://bsc-dataseed.binance.org/"
  },
  "proxy": {
    "enabled": true,
    "url": "http://172.30.48.1:10809"
  },
  "contract": {
    "address": "0xad1a38cec043e70e83a3ec30443db285ed10d774",
    "startBlock": 0
  },
  "monitor": {
    "pollInterval": 30000,
    "stateFile": "./monitor_state.json"
  },
  "database": {
    "path": "./data/orders.db"
  }
}
```

## 数据说明

### OrdersMatched事件

系统监听BSC链上的OrdersMatched事件：

```solidity
OrdersMatched(
    bytes32 indexed takerOrderHash,
    address indexed takerOrderMaker,
    uint256 makerAssetId,
    uint256 takerAssetId,
    uint256 makerAmountFilled,
    uint256 takerAmountFilled
)
```

### 成交量计算

- 如果 `makerAssetId != 0`: `takerAmountFilled` 是USD金额
- 如果 `takerAssetId != 0`: `makerAmountFilled` 是USD金额

## 项目结构

```
opvol/
├── config.json              # 配置文件
├── package.json             # 依赖管理
├── monitorServer.js         # 监听服务
├── dashboard.js             # Dashboard CLI
├── db/
│   └── database.js          # 数据库操作
├── src/
│   ├── bscAPI.js           # BSCScan/RPC API封装
│   ├── eventParser.js      # OrdersMatched事件解析
│   └── topicAPI.js         # Topic信息获取
├── data/
│   └── orders.db           # SQLite数据库（自动生成）
└── monitor_state.json      # 监听进度（自动生成）
```

## 常见问题

### 1. Dashboard显示"No orders found"

- 确保监听服务正在运行
- 等待服务收集足够的数据
- 检查Topic ID是否正确
- 可以用测试脚本生成数据：`npm run test:gen`

### 2. 监听服务报错

- 检查BSCScan API Key是否有效
- 查看代理设置是否正确
- 确认网络连接正常

### 3. 图表显示不完整

- 确保终端宽度至少120字符
- 使用支持UTF-8的终端
- Windows用户推荐使用Windows Terminal

## 技术栈

- **Node.js**: 运行环境
- **SQLite**: 本地数据存储
- **Axios**: HTTP请求
- **Chalk**: 终端彩色输出
- **sql.js**: 纯JavaScript的SQLite实现

## 注意事项

1. BSCScan API有速率限制，建议使用付费API Key
2. 数据库文件会自动创建和更新
3. 监听服务使用Ctrl+C优雅退出，会自动保存进度
4. Dashboard是只读的，不会修改数据库

## 性能优化

- 监听服务每次查询10000个区块
- 如果没有新数据，会保持在同一区间重复扫描
- 只有发现新事件才推进区块号
- 这样避免了API索引延迟导致的数据丢失
