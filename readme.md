 "api": {
    "bsc_api_key": "ZPPVNIHW99GPD7Q7IEGMT1TYD8QVMCBHM3",
    "bsc_api_url": "https://api.bscscan.com/api"
  },


  BEP-1155 token (ca: 0xad1a38cec043e70e83a3ec30443db285ed10d774)
  是预测市场的yes/no token ,

  我们要制作一个预测市场的交易量统计
  这个交易市场每进行一次成功的撮合都会有链上的OrderFilled事件


  例子:
  <example1>

OrderFilled (index_topic_1 bytes32 orderHash, index_topic_2 address maker, index_topic_3 address taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)View Source

Topics
0 0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6
1: orderHash
A3F513E5FFEE110F018D4543388819ED2B7C938C4D0FCEEE73535BB229E969ED
2: maker
0xd006482147f77970Ef07A91cd84B532433D57400
3: taker
0x0C1d437805947334082FF789CCC18c4017634195
Data


makerAssetId :
99426606710483936388295561939771828679151878339607161191787308344532084590471
takerAssetId :
0
makerAmountFilled :
20461341028331584471
takerAmountFilled :
19499658000000000000
fee :
0
  </example1>
<example2>
Name
OrderFilled (index_topic_1 bytes32 orderHash, index_topic_2 address maker, index_topic_3 address taker, uint256 makerAssetId, uint256 takerAssetId, uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee)View Source

Topics
0 0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6
1: orderHash
962203DE5A68DE996C4E44B129EDCCE5795F7B1D790FCB4D1DFAD10C564B2A41
2: maker
0x0C1d437805947334082FF789CCC18c4017634195
3: taker
0x5F45344126D6488025B0b84A3A8189F2487a7246
Data


makerAssetId :
0
takerAssetId :
99426606710483936388295561939771828679151878339607161191787308344532084590471
makerAmountFilled :
19999658000000000000
takerAmountFilled :
20461341028331584471
fee :
500000000000000000
</example2>

# Get ERC1155 Token Transfers by Address

export const chain = '1';

### Query Parameters

<ParamField query="apikey" type="string" default="YourApiKeyToken">
  Your Etherscan API key.
</ParamField>

<ParamField query="chainid" type="string" default="1">
  Chain ID to query, eg `1` for Ethereum, `8453` for Base from our [supported chains](/supported-chains).
</ParamField>

<ParamField query="module" type="string" default="account">
  Set to `account` for this endpoint.
</ParamField>

<ParamField query="action" type="string" default="token1155tx">
  Set to `token1155tx` for this endpoint.
</ParamField>

<ParamField query="contractaddress" type="string" default="0x76be3b62873462d2142405439777e971754e8e77">
  The ERC1155 token contract address to filter transfers by, eg `0x495f947276749ce646f68ac8c248420045cb7b5e` for [Opensea Shared Storefront](https://etherscan.io/token/0x495f947276749ce646f68ac8c248420045cb7b5e).
</ParamField>

<ParamField query="address" type="string" default="0x83f564d180b58ad9a02a449105568189ee7de8cb">
  The address to query, like `0xfefefefefefefefefefefefefefefefefefefefe`
</ParamField>

<ParamField query="page" type="integer" default="1">
  Page number for pagination.
</ParamField>

<ParamField query="offset" type="integer" default="1">
  Number of transactions per page.
</ParamField>

<ParamField query="startblock" type="integer" default="0">
  Starting block number to search from.
</ParamField>

<ParamField query="endblock" type="integer" default="9999999999">
  Ending block number to search to.
</ParamField>

<ParamField query="sort" type="string" default="desc">
  Sort order either `desc` for the latest transactions first or `asc` for the oldest transactions first.
</ParamField>

<ResponseExample>
  ```json Response theme={null}
  {
    "status": "1",
    "message": "OK",
    "result": [
      {
        "blockNumber": "13472395",
        "timeStamp": "1634973285",
        "hash": "0x643b15f3ffaad5d38e33e5872b4ebaa7a643eda8b50ffd5331f682934ee65d4d",
        "nonce": "41",
        "blockHash": "0xa5da536dfbe8125eb146114e2ee0d0bdef2b20483aacbf30fed6b60f092059e6",
        "transactionIndex": "100",
        "gas": "140000",
        "gasPrice": "52898577246",
        "gasUsed": "105030",
        "cumulativeGasUsed": "11739203",
        "input": "deprecated",
        "methodId": "0x3e6b214b",
        "functionName": "",
        "contractAddress": "0x76be3b62873462d2142405439777e971754e8e77",
        "from": "0x1e63326a84d2fa207bdfa856da9278a93deba418",
        "to": "0x83f564d180b58ad9a02a449105568189ee7de8cb",
        "tokenID": "10371",
        "tokenValue": "1",
        "tokenName": "parallel",
        "tokenSymbol": "LL",
        "confirmations": "9995266"
      }
    ]
  }
  ```
</ResponseExample>


你可以从Get ERC1155 Token Transfers by Address中
拿到所有的 token transfer, 并且这个tx中就包含了OrderFilled事件


我们最终的落库数据应该是 根据 makerAssetId /takerAssetId  , 进行groupby进行落库

后面取用数据的时候 会根据一个topic获得YES和NO的token的两个id 然后就可以重新捞取特定的两个assetid聚合起来得到一个topic的交易记录了

在这之前, 你要制作一个本地db(基于本地文件系统的轻量db即可) , 将我们这个交易监听模块的所有数据落库


有关bscscan怎么使用 可以参考这个  D:\Web3\autobuyfour\scanMeme.py

有关topic相关的一些知识可以参考 D:\Web3\op\src\sdk\TopicAPI.js

最终我们的产品包含两个入口
1. monitorServer 自动监听所有的OrderFilled 并落库
2. dashboard 看板, 输入topicid后 获取对应的YES/NO AssetId 然后从db中捞取成交数据, 向我们展示成交量 成交价格的 秒级别k线图