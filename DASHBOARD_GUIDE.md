# Dashboard 使用指南

## 功能特性

Dashboard为每个prediction market的YES和NO token分别显示：

1. **交易统计** - 总订单数、总成交量、平均价格等
2. **ASCII K线图** - 终端绘制的蜡烛图
3. **成交量柱状图** - 可视化成交量分布

## 使用方法

```bash
node dashboard.js <topicId> [intervalSeconds]
```

### 参数说明

- `topicId`: Prediction market的Topic ID（必需）
- `intervalSeconds`: K线时间间隔（秒），默认30秒

### 示例

```bash
# 默认30秒K线
node dashboard.js 792

# 10秒K线（更细粒度）
node dashboard.js 792 10

# 60秒K线（1分钟）
node dashboard.js 792 60

# 300秒K线（5分钟）
node dashboard.js 792 300
```

## 图表说明

### K线图颜色

- **绿色实心方块 (█)**: 上涨K线（收盘价 ≥ 开盘价）
- **红色空心方块 (░)**: 下跌K线（收盘价 < 开盘价）
- **灰色竖线 (│)**: 上下影线

### K线结构

```
    │       <- 上影线（最高价到实体顶部）
   ███      <- 实体（开盘价到收盘价）
    │       <- 下影线（实体底部到最低价）
```

### Y轴刻度

左侧显示价格刻度，从上到下递减。

### 成交量图

- **蓝色柱状图**: 每根K线的USD成交量
- 柱子高度表示相对成交量大小
- 底部显示最大成交量数值

## 输出示例

```
=== YES Token Trading Statistics ===

Total Orders:     20
Total Volume:     41062.342504 USD
Average Volume:   2053.117125 USD
Average Price:    0.0737
Price Range:      0.0500 - 0.0975
K-lines:          20

=== YES Token Price Chart ===

0.098                                    ██
                                    ██
                               ██
0.086
                          ██
                     ██
                ██
           ██
0.074
      ██
 ██
────────────────────────────────────────────

=== Volume ===

                                    ██
           ██        ██        ██   ██
      ██   ██   ██   ██   ██   ██   ██   ██
 ██   ██   ██   ██   ██   ██   ██   ██   ██
────────────────────────────────────────────
Max Volume: 2777.579160 USD
```

## 理解数据

### YES Token

- 价格上涨表示市场认为事件发生概率增加
- 高成交量配合价格上涨 = 强烈看涨信号

### NO Token

- 价格下跌表示市场认为事件不发生概率增加
- YES和NO的价格总和通常接近1.0

## 数据来源

所有数据来自监听服务收集的OrdersMatched事件：

- 价格：根据makerAssetId/takerAssetId自动计算USD单价
- 成交量：交易中的USD金额
- 时间聚合：按指定时间间隔聚合多笔交易

## 性能建议

- **10秒间隔**: 适合短期分析，数据点多
- **30秒间隔**: 默认值，平衡细节和整体趋势
- **60秒+**: 适合查看长期趋势，数据点少更清晰

## 测试数据

如果数据库中数据不足，可以运行测试脚本生成模拟数据：

```bash
node test_dashboard_visual.js
```

这会生成40笔测试交易（20笔YES，20笔NO），用于演示可视化效果。

## 故障排查

### "No orders found"

- 检查监听服务是否运行：`npm run monitor`
- 确认Topic ID正确
- 等待服务收集足够数据

### "Price range is zero"

- 只有一笔交易或所有交易价格相同
- 尝试更长的时间间隔聚合更多交易
- 等待更多交易数据

### 图表显示异常

- 确保终端宽度至少100字符
- 使用支持UTF-8的终端
- 某些终端可能不支持方块字符显示
