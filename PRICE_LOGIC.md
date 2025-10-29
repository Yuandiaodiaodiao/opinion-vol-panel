# 价格计算逻辑说明

## OrdersMatched 事件

系统监听的事件从 `OrderFilled` 改为 `OrdersMatched`，用于捕获市价单的交易流。

### 事件签名

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

**Topic0**: `0x63bf4d16b7fa898ef4c4b2b6d90fd201e9c56313b65638af6088d149d2ce956c`

## 价格计算规则

根据 `makerAssetId` 和 `takerAssetId` 的值来判断哪个是USD计价：

### 情况1: makerAssetId ≠ 0

- **makerAssetId**: 代表prediction token (YES/NO token ID)
- **takerAssetId**: 0 (表示USD)
- **makerAmountFilled**: Token数量
- **takerAmountFilled**: USD金额

**价格计算**:
```
价格 = takerAmountFilled / makerAmountFilled
```

### 情况2: takerAssetId ≠ 0

- **makerAssetId**: 0 (表示USD)
- **takerAssetId**: 代表prediction token (YES/NO token ID)
- **makerAmountFilled**: USD金额
- **takerAmountFilled**: Token数量

**价格计算**:
```
价格 = makerAmountFilled / takerAmountFilled
```

## 示例

### 示例1: 买入YES token (makerAssetId ≠ 0)

```json
{
  "makerAssetId": "99426606710483936388295561939771828679151878339607161191787308344532084590471",
  "takerAssetId": "0",
  "makerAmountFilled": "1000000000000000000000",  // 1000 tokens
  "takerAmountFilled": "952000000000000000000"     // 952 USD
}
```

**价格**: 952 / 1000 = 0.952 USD per token

### 示例2: 卖出YES token (takerAssetId ≠ 0)

```json
{
  "makerAssetId": "0",
  "takerAssetId": "49529337474351567656563065160780401350957193644797729582753506049577792201184",
  "makerAmountFilled": "42731919000000000000",  // 42.73 USD
  "takerAmountFilled": "45557625674217907219"  // 45.56 tokens
}
```

**价格**: 42.73 / 45.56 = 0.938 USD per token

## 实现代码

参见 `dashboard.js` 中的 `calculatePrice` 函数：

```javascript
function calculatePrice(order) {
  const makerAssetId = BigInt(order.makerAssetId);
  const takerAssetId = BigInt(order.takerAssetId);
  const makerAmount = BigInt(order.makerAmountFilled);
  const takerAmount = BigInt(order.takerAmountFilled);

  if (makerAssetId !== 0n) {
    // takerAmount是USD，makerAmount是token数量
    if (makerAmount === 0n) return 0;
    return Number(takerAmount * 10000n / makerAmount) / 10000;
  } else if (takerAssetId !== 0n) {
    // makerAmount是USD，takerAmount是token数量
    if (takerAmount === 0n) return 0;
    return Number(makerAmount * 10000n / takerAmount) / 10000;
  }

  return 0;
}
```

## 合理性验证

预测市场的token价格应该在0到1之间（对应0%到100%的概率），系统计算出的价格范围正常：

- YES token: 0.05 - 0.95
- NO token: 0.05 - 0.95

这些价格符合预测市场的定价逻辑。
