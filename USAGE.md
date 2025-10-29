# 使用说明

## 监听服务

启动监听服务，自动监听OrderFilled事件并存入数据库：

```bash
npm run monitor
# 或
node monitorServer.js
```

服务会：
- 冷启动时从BSC RPC获取最新区块号
- 每30秒轮询一次新事件
- 持续扫描同一区块范围，直到BSCScan API索引完成返回数据
- 自动保存进度到 `monitor_state.json`

## Dashboard看板

### 方式1: 使用Topic ID（推荐）

通过Topic ID自动获取YES/NO token并查询交易数据：

```bash
npm run dashboard 792
# 或
node dashboard.js 792
```

使用自定义K线时间间隔（5秒）：

```bash
node dashboard.js 792 5
```

### 方式2: 直接使用Asset ID

如果你已经知道具体的Asset ID，可以直接查询：

```bash
node dashboard.js 78464044768923104002184716865086658420801293197224294747339592090218729991164 99426606710483936388295561939771828679151878339607161191787308344532084590471
```

使用自定义K线时间间隔：

```bash
node dashboard.js 78464044768923104002184716865086658420801293197224294747339592090218729991164 99426606710483936388295561939771828679151878339607161191787308344532084590471 5
```

## Dashboard输出说明

Dashboard会显示：

1. **Topic信息**（使用Topic ID时）
   - Topic标题
   - YES Token ID
   - NO Token ID

2. **交易统计**
   - 总订单数
   - 总交易量
   - 平均交易量
   - 平均价格
   - 价格区间
   - K线数量

3. **K线图表**
   - 时间戳
   - 开盘价（Open）
   - 最高价（High）
   - 最低价（Low）
   - 收盘价（Close）
   - 交易量（Volume）
   - 交易笔数（Trades）

## 测试脚本

```bash
# 测试BSC RPC连接
node test_rpc.js

# 测试Topic API
node test_topic.js

# 测试BSCScan API
node test_api_simple.js

# 查找事件
node test_find_events.js
```

## 缓存机制

Topic信息会缓存到 `.cache/topics/` 目录，有效期24小时。

清除特定topic缓存：
```bash
rm .cache/topics/topic_792.json
```

清除所有缓存：
```bash
rm -rf .cache/topics/
```

## 数据库

数据存储在 `./data/orders.db`（SQLite数据库）

查看数据库内容：
```bash
sqlite3 ./data/orders.db "SELECT COUNT(*) FROM orders;"
sqlite3 ./data/orders.db "SELECT * FROM orders LIMIT 5;"
```

## 常见问题

### 1. 没有找到数据
- 确保监听服务已经运行并收集了数据
- 检查Topic ID是否正确
- 查看数据库中是否有对应的Asset ID数据

### 2. API请求失败
- 检查代理设置（config.json中的proxy配置）
- 确认BSCScan API Key有效
- 查看错误信息中的完整请求URL进行调试

### 3. Topic API获取失败
- 检查网络连接和代理设置
- Topic可能不存在或已过期
- 查看 `.cache/topics/` 中的缓存文件
