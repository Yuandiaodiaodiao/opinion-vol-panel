# FilterMonitor 监听模式说明

## 三种监听模式

### 1. contract 模式
监听特定合约地址的所有事件。

**使用场景**: 当你想监听某个合约上发生的所有事情时。

**Filter配置**:
```javascript
{
  address: targetAddress,
  fromBlock: 'latest'
}
```

**示例**:
```javascript
const monitor = new FilterMonitor(
  '0xad1a38cec043e70e83a3ec30443db285ed10d774',
  rpcUrls,
  proxyConfig,
  handleEvent,
  { mode: 'contract' }
);
```

### 2. transfer 模式
监听所有涉及目标地址的ERC-1155 Transfer事件（不限合约）。

**使用场景**: 当你想监听某个地址在所有合约上的Transfer活动时。

**Filter配置**: 创建4个filter
```javascript
// TransferSingle: from=target
{ topics: [TRANSFER_SINGLE_TOPIC, null, addressTopic], fromBlock: 'latest' }

// TransferSingle: to=target  
{ topics: [TRANSFER_SINGLE_TOPIC, null, null, addressTopic], fromBlock: 'latest' }

// TransferBatch: from=target
{ topics: [TRANSFER_BATCH_TOPIC, null, addressTopic], fromBlock: 'latest' }

// TransferBatch: to=target
{ topics: [TRANSFER_BATCH_TOPIC, null, null, addressTopic], fromBlock: 'latest' }
```

**示例**:
```javascript
const monitor = new FilterMonitor(
  '0xUserAddress...',
  rpcUrls,
  proxyConfig,
  handleEvent,
  { mode: 'transfer' }
);
```

### 3. contract-transfer 模式 ⭐ 推荐
监听特定合约的ERC-1155 Transfer事件。

**使用场景**: 监听特定NFT合约的所有Transfer活动（最常用）。

**Filter配置**: 创建2个filter
```javascript
// TransferSingle on contract
{ 
  address: targetAddress,
  topics: [TRANSFER_SINGLE_TOPIC],
  fromBlock: 'latest' 
}

// TransferBatch on contract
{ 
  address: targetAddress,
  topics: [TRANSFER_BATCH_TOPIC],
  fromBlock: 'latest' 
}
```

**示例**:
```javascript
const monitor = new FilterMonitor(
  '0xad1a38cec043e70e83a3ec30443db285ed10d774',
  rpcUrls,
  proxyConfig,
  handleEvent,
  { mode: 'contract-transfer' }
);
```

## ERC-1155 事件签名

### TransferSingle
```solidity
event TransferSingle(
    address indexed operator,
    address indexed from,
    address indexed to,
    uint256 id,
    uint256 value
)
```
- Topic0: `0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62`

### TransferBatch
```solidity
event TransferBatch(
    address indexed operator,
    address indexed from,
    address indexed to,
    uint256[] ids,
    uint256[] values
)
```
- Topic0: `0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb`

## Filter数量对比

假设使用16个RPC节点：

- **contract模式**: 16个filter (1 filter × 16 RPC)
- **transfer模式**: 64个filter (4 filters × 16 RPC)
- **contract-transfer模式**: 32个filter (2 filters × 16 RPC)

## 性能建议

1. 优先使用 `contract-transfer` 模式 - 精确监听特定合约的Transfer
2. 如果需要监听所有事件，使用 `contract` 模式，然后在回调中过滤
3. `transfer` 模式会创建最多的filter，适合监听特定地址的跨合约活动

## 当前配置

monitorServer.js 使用 `contract-transfer` 模式监听合约地址：
`0xad1a38cec043e70e83a3ec30443db285ed10d774`
