const http = require('http');
const url = require('url');
const { exec } = require('child_process');
const Database = require('./db/database');
const TopicAPI = require('./src/topicAPI');
const { loadConfig } = require('./src/configLoader');

const config = loadConfig();
const PORT = 7776;

/**
 * 将金额格式化为可读的数字（假设18位小数）
 */
function formatAmount(amountStr, decimals = 18) {
  const amount = BigInt(amountStr);
  const divisor = BigInt(10 ** decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;
  return `${integerPart}.${fractionalPart.toString().padStart(decimals, '0').slice(0, 4)}`;
}

/**
 * 计算成交量（USD）
 */
function calculateVolume(order) {
  const makerAssetId = BigInt(order.makerAssetId);
  const takerAssetId = BigInt(order.takerAssetId);

  if (makerAssetId !== 0n) {
    return BigInt(order.takerAmountFilled);
  } else if (takerAssetId !== 0n) {
    return BigInt(order.makerAmountFilled);
  }

  return 0n;
}

/**
 * 按时间间隔聚合成交量
 */
function aggregateVolumeByInterval(orders, intervalMinutes) {
  if (orders.length === 0) return [];

  const volumeMap = new Map();
  const intervalSeconds = intervalMinutes * 60;

  for (const order of orders) {
    const bucketTimestamp = Math.floor(order.timestamp / intervalSeconds) * intervalSeconds;

    if (!volumeMap.has(bucketTimestamp)) {
      volumeMap.set(bucketTimestamp, {
        timestamp: bucketTimestamp,
        volume: 0n,
        trades: 0,
        buyVolume: 0n,
        sellVolume: 0n,
        buyTrades: 0,
        sellTrades: 0
      });
    }

    const bucket = volumeMap.get(bucketTimestamp);
    const vol = calculateVolume(order);
    bucket.volume += vol;
    bucket.trades++;

    if (order.side === 'BUY') {
      bucket.buyVolume += vol;
      bucket.buyTrades++;
    } else if (order.side === 'SELL') {
      bucket.sellVolume += vol;
      bucket.sellTrades++;
    }
  }

  return Array.from(volumeMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 过滤指定时间范围内的订单
 */
function filterOrdersByTimeRange(orders, rangeMinutes) {
  if (rangeMinutes === 'all') return orders;

  const now = Math.floor(Date.now() / 1000);
  const cutoffTime = now - (rangeMinutes * 60);

  return orders.filter(order => order.timestamp >= cutoffTime);
}

/**
 * 获取交易数据统计
 */
function getTradeStats(orders, yesToken, noToken) {
  const yesOrders = orders.filter(o =>
    o.makerAssetId === yesToken || o.takerAssetId === yesToken
  );

  const noOrders = orders.filter(o =>
    o.makerAssetId === noToken || o.takerAssetId === noToken
  );

  const yesVolume = yesOrders.reduce((sum, o) => sum + calculateVolume(o), 0n);
  const noVolume = noOrders.reduce((sum, o) => sum + calculateVolume(o), 0n);
  const totalVolume = yesVolume + noVolume;

  const buyOrders = orders.filter(o => o.side === 'BUY');
  const sellOrders = orders.filter(o => o.side === 'SELL');
  const buyVolume = buyOrders.reduce((sum, o) => sum + calculateVolume(o), 0n);
  const sellVolume = sellOrders.reduce((sum, o) => sum + calculateVolume(o), 0n);

  return {
    yesOrders: yesOrders.length,
    noOrders: noOrders.length,
    totalOrders: orders.length,
    yesVolume: formatAmount(yesVolume.toString()),
    noVolume: formatAmount(noVolume.toString()),
    totalVolume: formatAmount(totalVolume.toString()),
    buyOrders: buyOrders.length,
    sellOrders: sellOrders.length,
    buyVolume: formatAmount(buyVolume.toString()),
    sellVolume: formatAmount(sellVolume.toString())
  };
}

/**
 * 生成交易详情数据
 */
function generateTradeDetails(orders, yesToken, noToken, limit = 100) {
  const recentOrders = [...orders]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  return recentOrders.map(order => {
    const makerAssetId = BigInt(order.makerAssetId);
    const takerAssetId = BigInt(order.takerAssetId);
    const makerFilled = BigInt(order.makerAmountFilled);
    const takerFilled = BigInt(order.takerAmountFilled);

    let side = 'UNKNOWN';
    let shares = 0n;
    let usdAmount = 0n;

    if (makerAssetId === BigInt(yesToken) || takerAssetId === BigInt(yesToken)) {
      side = 'YES';
      if (makerAssetId === BigInt(yesToken)) {
        shares = makerFilled;
        usdAmount = takerFilled;
      } else {
        shares = takerFilled;
        usdAmount = makerFilled;
      }
    } else if (makerAssetId === BigInt(noToken) || takerAssetId === BigInt(noToken)) {
      side = 'NO';
      if (makerAssetId === BigInt(noToken)) {
        shares = makerFilled;
        usdAmount = takerFilled;
      } else {
        shares = takerFilled;
        usdAmount = makerFilled;
      }
    }

    let price = '0.000';
    if (shares > 0n) {
      const priceScaled = (usdAmount * 1000n) / shares;
      price = (Number(priceScaled) / 1000).toFixed(3);
    }

    const volume = calculateVolume(order);

    return {
      timestamp: order.timestamp,
      time: new Date(order.timestamp * 1000).toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }),
      side,
      buySell: order.side || 'UNKNOWN',
      price,
      shares: formatAmount(shares.toString()),
      volume: formatAmount(volume.toString()),
      txHash: order.txHash || 'N/A'
    };
  });
}

/**
 * 生成HTML页面
 */
function generateHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trading Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #0a0e17;
      color: #e4e4e7;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      padding: 30px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    .header h1 {
      font-size: 28px;
      margin-bottom: 15px;
      color: #38bdf8;
    }

    .topic-selector {
      margin-top: 20px;
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .topic-selector label {
      font-weight: 500;
      color: #94a3b8;
    }
    .topic-selector input {
      flex: 1;
      max-width: 300px;
      padding: 10px 15px;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #0f172a;
      color: #e4e4e7;
      font-size: 14px;
    }
    .topic-selector button {
      padding: 10px 20px;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #0f172a;
      color: #e4e4e7;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .topic-selector button:hover {
      border-color: #38bdf8;
      background: #1e293b;
    }

    .topic-tabs {
      margin-top: 15px;
      display: flex;
      gap: 10px;
      overflow-x: auto;
      padding-bottom: 10px;
    }
    .topic-tab {
      flex-shrink: 0;
      padding: 10px 15px;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #0f172a;
      color: #e4e4e7;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .topic-tab:hover {
      border-color: #38bdf8;
      background: #1e293b;
    }
    .topic-tab.active {
      border-color: #38bdf8;
      background: #1e293b;
      color: #38bdf8;
    }
    .topic-tab-id {
      font-weight: 600;
      margin-right: 5px;
    }

    .child-tabs {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #334155;
      display: none;
    }
    .child-tabs-title {
      font-size: 14px;
      color: #94a3b8;
      margin-bottom: 10px;
      font-weight: 500;
    }
    .child-tabs-container {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .child-tab {
      padding: 12px 18px;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #0f172a;
      color: #e4e4e7;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      white-space: nowrap;
    }
    .child-tab:hover {
      border-color: #38bdf8;
      background: #1e293b;
    }
    .child-tab.active {
      border-color: #38bdf8;
      background: #1e293b;
      color: #38bdf8;
      font-weight: 600;
    }

    .topic-info {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .info-item {
      background: rgba(255, 255, 255, 0.05);
      padding: 12px;
      border-radius: 8px;
      border-left: 3px solid #38bdf8;
    }
    .info-label { font-size: 12px; color: #94a3b8; margin-bottom: 5px; }
    .info-value { font-size: 18px; font-weight: 600; }
    .yes-value { color: #4ade80; }
    .no-value { color: #f87171; }

    .controls {
      background: #1e293b;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 20px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .controls label { font-weight: 500; color: #94a3b8; }
    .controls select, .controls button {
      padding: 10px 15px;
      border: 1px solid #334155;
      border-radius: 6px;
      background: #0f172a;
      color: #e4e4e7;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .controls select:hover, .controls button:hover {
      border-color: #38bdf8;
      background: #1e293b;
    }

    .chart-container {
      background: #1e293b;
      padding: 25px;
      border-radius: 12px;
      margin-bottom: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    .chart-wrapper { position: relative; height: 400px; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 15px;
      margin-bottom: 20px;
    }
    .stat-card {
      background: #1e293b;
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    .stat-label { font-size: 13px; color: #94a3b8; margin-bottom: 8px; }
    .stat-value { font-size: 24px; font-weight: 600; }

    .trades-section {
      background: #1e293b;
      padding: 25px;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    .trades-section h2 {
      font-size: 20px;
      margin-bottom: 20px;
      color: #38bdf8;
    }
    .table-wrapper {
      overflow-x: auto;
      max-height: 600px;
      overflow-y: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    thead { position: sticky; top: 0; background: #0f172a; z-index: 10; }
    th {
      text-align: left;
      padding: 12px;
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      border-bottom: 2px solid #334155;
    }
    td {
      padding: 12px;
      border-bottom: 1px solid #334155;
      font-size: 13px;
    }
    tbody tr:hover { background: rgba(56, 189, 248, 0.05); }
    .side-yes { color: #4ade80; font-weight: 600; }
    .side-no { color: #f87171; font-weight: 600; }
    .side-buy { color: #4ade80; }
    .side-sell { color: #f87171; }
    .tx-hash {
      font-family: monospace;
      font-size: 11px;
      color: #64748b;
      word-break: break-all;
      max-width: 150px;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #94a3b8;
    }
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #94a3b8;
    }
    .empty-state h2 {
      font-size: 24px;
      color: #38bdf8;
      margin-bottom: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Trading Dashboard</h1>

      <div class="topic-selector">
        <label>Topic ID:</label>
        <input type="number" id="topicInput" placeholder="Enter topic ID...">
        <button id="loadBtn">Load Topic</button>
      </div>

      <div class="topic-tabs" id="topicTabs"></div>

      <div class="child-tabs" id="childTabs">
        <div class="child-tabs-title">Select Sub-Topic:</div>
        <div class="child-tabs-container" id="childTabsContainer"></div>
      </div>

      <div id="topicInfo" class="topic-info" style="display: none;"></div>
    </div>

    <div id="mainContent" style="display: none;">
      <div class="controls">
        <label>Time Range:</label>
        <select id="timeRange">
          <option value="60">Last 1 Hour</option>
          <option value="360">Last 6 Hours</option>
          <option value="720">Last 12 Hours</option>
          <option value="1440">Last 24 Hours</option>
          <option value="4320">Last 3 Days</option>
          <option value="10080">Last 7 Days</option>
          <option value="all">All Time</option>
        </select>

        <label style="margin-left: 20px;">Interval:</label>
        <select id="interval">
          <option value="1">1 Minute</option>
          <option value="5">5 Minutes</option>
          <option value="15">15 Minutes</option>
          <option value="60">1 Hour</option>
          <option value="240">4 Hours</option>
        </select>

        <button id="refreshBtn" style="margin-left: auto;">Refresh</button>
      </div>

      <div id="stats" class="stats-grid"></div>

      <div class="chart-container">
        <h2 style="margin-bottom: 15px; color: #38bdf8;">Trading Volume</h2>
        <div class="chart-wrapper">
          <canvas id="volumeChart"></canvas>
        </div>
      </div>

      <div class="trades-section">
        <h2>Recent Trades</h2>
        <div class="table-wrapper">
          <table id="tradesTable">
            <thead>
              <tr>
                <th>Time</th>
                <th>Side</th>
                <th>B/S</th>
                <th>Price</th>
                <th>Shares</th>
                <th>Volume (USD)</th>
                <th>TX Hash</th>
              </tr>
            </thead>
            <tbody id="tradesBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="emptyState" class="empty-state">
      <h2>Welcome to Trading Dashboard</h2>
      <p>Please select a topic from the tabs above or enter a topic ID to get started.</p>
    </div>
  </div>

  <script>
    let currentTopicId = null;
    let currentChildTopicId = null;
    let currentTopicData = null;
    let chart = null;
    let allTopics = [];

    async function loadTopics() {
      try {
        const response = await fetch('/api/topics');
        allTopics = await response.json();
        renderTopicTabs();
      } catch (error) {
        console.error('Failed to load topics:', error);
      }
    }

    function renderTopicTabs() {
      const tabsContainer = document.getElementById('topicTabs');
      tabsContainer.innerHTML = allTopics.map(topic => \`
        <div class="topic-tab \${topic.topicId === currentTopicId ? 'active' : ''}"
             onclick="loadTopic(\${topic.topicId})"
             title="\${topic.title}">
          <span class="topic-tab-id">#\${topic.topicId}</span>
          \${topic.title}
        </div>
      \`).join('');
    }

    async function loadTopic(topicId) {
      currentTopicId = topicId;
      currentChildTopicId = null;
      document.getElementById('topicInput').value = topicId;

      try {
        const response = await fetch(\`/api/topic/\${topicId}\`);
        const topicInfo = await response.json();

        if (topicInfo.error) {
          alert(topicInfo.error);
          return;
        }

        currentTopicData = topicInfo;
        renderTopicTabs();

        // 检查是否是multi topic（包含childList）
        // rawTopicInfo可能在topicInfo.raw.childList 或 topicInfo.childList
        const childList = (topicInfo.raw && topicInfo.raw.childList) || topicInfo.childList;

        if (childList && Array.isArray(childList) && childList.length > 0) {
          // Multi topic - 显示父主题信息和子主题tabs
          console.log('Multi topic detected with', childList.length, 'children');
          renderParentTopicInfo(topicInfo);
          renderChildTabs(childList);
          document.getElementById('childTabs').style.display = 'block';
          document.getElementById('mainContent').style.display = 'none';
          document.getElementById('topicInfo').style.display = 'grid';
          document.getElementById('emptyState').style.display = 'none';
        } else {
          // Single topic - 直接加载数据
          console.log('Single topic detected');
          document.getElementById('childTabs').style.display = 'none';
          renderTopicInfo(topicInfo);
          document.getElementById('mainContent').style.display = 'block';
          document.getElementById('topicInfo').style.display = 'grid';
          document.getElementById('emptyState').style.display = 'none';
          await fetchData();
        }
      } catch (error) {
        console.error('Failed to load topic:', error);
        alert('Failed to load topic: ' + error.message);
      }
    }

    function renderChildTabs(childList) {
      const container = document.getElementById('childTabsContainer');
      container.innerHTML = childList.map(child => \`
        <div class="child-tab \${child.topicId === currentChildTopicId ? 'active' : ''}"
             onclick="loadChildTopic(\${child.topicId})">
          <strong>#\${child.topicId}</strong> \${child.title}
        </div>
      \`).join('');
    }

    async function loadChildTopic(childTopicId) {
      currentChildTopicId = childTopicId;

      try {
        const response = await fetch(\`/api/topic/\${childTopicId}\`);
        const childTopicInfo = await response.json();

        if (childTopicInfo.error) {
          alert(childTopicInfo.error);
          return;
        }

        // Re-render child tabs to update active state
        if (currentTopicData && currentTopicData.raw && currentTopicData.raw.childList) {
          renderChildTabs(currentTopicData.raw.childList);
        }

        renderTopicInfo(childTopicInfo);
        document.getElementById('mainContent').style.display = 'block';
        await fetchData();
      } catch (error) {
        console.error('Failed to load child topic:', error);
        alert('Failed to load child topic: ' + error.message);
      }
    }

    function renderParentTopicInfo(topicInfo) {
      // 显示multi topic的父主题基本信息
      const infoHTML = \`
        <div class="info-item">
          <div class="info-label">Topic ID</div>
          <div class="info-value">\${topicInfo.topicId}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Topic Title</div>
          <div class="info-value" style="font-size: 14px;">\${topicInfo.title}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Topic Type</div>
          <div class="info-value" style="color: #38bdf8;">Multi Topic</div>
        </div>
        <div class="info-item">
          <div class="info-label">Sub Topics</div>
          <div class="info-value">\${(topicInfo.childList || (topicInfo.raw && topicInfo.raw.childList) || []).length}</div>
        </div>
      \`;
      document.getElementById('topicInfo').innerHTML = infoHTML;
      document.getElementById('topicInfo').style.display = 'grid';
    }

    function renderTopicInfo(topicInfo) {
      const infoHTML = \`
        <div class="info-item">
          <div class="info-label">Topic ID</div>
          <div class="info-value">\${topicInfo.topicId}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Topic Title</div>
          <div class="info-value" style="font-size: 14px;">\${topicInfo.title}</div>
        </div>
        <div class="info-item">
          <div class="info-label">YES Price</div>
          <div class="info-value yes-value">\${topicInfo.yesPrice || 'N/A'}</div>
        </div>
        <div class="info-item">
          <div class="info-label">NO Price</div>
          <div class="info-value no-value">\${topicInfo.noPrice || 'N/A'}</div>
        </div>
      \`;
      document.getElementById('topicInfo').innerHTML = infoHTML;
      document.getElementById('topicInfo').style.display = 'grid';
    }

    async function fetchData() {
      // Use child topic if selected, otherwise use parent topic
      const topicIdToFetch = currentChildTopicId || currentTopicId;
      if (!topicIdToFetch) return;

      const timeRange = document.getElementById('timeRange').value;
      const interval = document.getElementById('interval').value;

      try {
        // 传递parentTopicId以便后端能正确找到topic信息
        const params = new URLSearchParams({
          topicId: topicIdToFetch,
          parentTopicId: currentTopicId,
          range: timeRange,
          interval: interval
        });
        const response = await fetch(\`/api/data?\${params}\`);
        const data = await response.json();

        if (data.error) {
          console.error('API Error:', data.error);
          alert('Failed to load data: ' + data.error);
        }

        updateStats(data.stats);
        updateChart(data.volumeData);
        updateTrades(data.trades);
      } catch (error) {
        console.error('Failed to fetch data:', error);
      }
    }

    function updateStats(stats) {
      const statsHTML = \`
        <div class="stat-card">
          <div class="stat-label">Total Volume</div>
          <div class="stat-value" style="color: #38bdf8;">\${stats.totalVolume} USD</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">YES Volume</div>
          <div class="stat-value yes-value">\${stats.yesVolume} USD</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">NO Volume</div>
          <div class="stat-value no-value">\${stats.noVolume} USD</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Trades</div>
          <div class="stat-value">\${stats.totalOrders}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">BUY Volume</div>
          <div class="stat-value side-buy">\${stats.buyVolume} USD</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">SELL Volume</div>
          <div class="stat-value side-sell">\${stats.sellVolume} USD</div>
        </div>
      \`;
      document.getElementById('stats').innerHTML = statsHTML;
    }

    function updateChart(volumeData) {
      // 处理空数据
      if (!volumeData || volumeData.length === 0) {
        if (chart) {
          chart.destroy();
          chart = null;
        }
        const ctx = document.getElementById('volumeChart').getContext('2d');
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto';
        ctx.fillText('No trading data available', ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
      }

      const labels = volumeData.map(d => {
        const date = new Date(d.timestamp * 1000);
        return date.toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      });

      const volumes = volumeData.map(d => parseFloat(d.volume) || 0);
      const buyVolumes = volumeData.map(d => parseFloat(d.buyVolume) || 0);
      const sellVolumes = volumeData.map(d => parseFloat(d.sellVolume) || 0);

      const ctx = document.getElementById('volumeChart').getContext('2d');

      if (chart) {
        chart.destroy();
      }

      chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Buy Volume',
              data: buyVolumes,
              backgroundColor: 'rgba(74, 222, 128, 0.6)',
              borderColor: 'rgba(74, 222, 128, 1)',
              borderWidth: 1
            },
            {
              label: 'Sell Volume',
              data: sellVolumes,
              backgroundColor: 'rgba(248, 113, 113, 0.6)',
              borderColor: 'rgba(248, 113, 113, 1)',
              borderWidth: 1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              stacked: true,
              grid: { color: '#334155' },
              ticks: {
                color: '#94a3b8',
                maxRotation: 45,
                minRotation: 45
              }
            },
            y: {
              stacked: true,
              grid: { color: '#334155' },
              ticks: { color: '#94a3b8' },
              title: {
                display: true,
                text: 'Volume (USD)',
                color: '#94a3b8'
              }
            }
          },
          plugins: {
            legend: {
              labels: { color: '#e4e4e7' }
            },
            tooltip: {
              backgroundColor: '#0f172a',
              titleColor: '#e4e4e7',
              bodyColor: '#e4e4e7',
              borderColor: '#334155',
              borderWidth: 1,
              callbacks: {
                label: function(context) {
                  return context.dataset.label + ': $' + context.parsed.y.toFixed(4);
                }
              }
            }
          }
        }
      });
    }

    function updateTrades(trades) {
      const tbody = document.getElementById('tradesBody');
      tbody.innerHTML = trades.map(trade => \`
        <tr>
          <td>\${trade.time}</td>
          <td class="side-\${trade.side.toLowerCase()}">\${trade.side}</td>
          <td class="side-\${trade.buySell.toLowerCase()}">\${trade.buySell}</td>
          <td>$\${trade.price}</td>
          <td>\${trade.shares}</td>
          <td>\${trade.volume}</td>
          <td class="tx-hash">\${trade.txHash}</td>
        </tr>
      \`).join('');
    }

    document.getElementById('loadBtn').addEventListener('click', () => {
      const topicId = parseInt(document.getElementById('topicInput').value);
      if (!isNaN(topicId)) {
        loadTopic(topicId);
      }
    });

    document.getElementById('topicInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const topicId = parseInt(document.getElementById('topicInput').value);
        if (!isNaN(topicId)) {
          loadTopic(topicId);
        }
      }
    });

    document.getElementById('timeRange').addEventListener('change', fetchData);
    document.getElementById('interval').addEventListener('change', fetchData);
    document.getElementById('refreshBtn').addEventListener('click', fetchData);

    // Initial load
    loadTopics();
  </script>
</body>
</html>`;
}

/**
 * 从多盘口数据中查找指定的子盘口
 */
function findChildTopic(topicInfo, targetTopicId) {
  if (topicInfo.topicId === targetTopicId) {
    return topicInfo;
  }

  if (topicInfo.raw && topicInfo.raw.childList && Array.isArray(topicInfo.raw.childList)) {
    for (const child of topicInfo.raw.childList) {
      if (child.topicId === targetTopicId) {
        return {
          topicId: child.topicId,
          title: child.title,
          yesToken: child.yesPos || '',
          noToken: child.noPos || '',
          yesPrice: child.yesMarketPrice || '',
          noPrice: child.noMarketPrice || '',
          questionId: child.questionId,
          raw: child
        };
      }
    }
  }

  return topicInfo;
}

/**
 * 处理API请求
 */
async function handleAPIRequest(query, db, topicAPI) {
  try {
    const topicId = parseInt(query.topicId);
    const parentTopicId = query.parentTopicId ? parseInt(query.parentTopicId) : topicId;
    const range = query.range || '60';
    const interval = parseInt(query.interval) || 1;

    // 首先使用parentTopicId获取rawTopicInfo（确保能找到缓存文件）
    const rawTopicInfo = await topicAPI.getTopicInfo(parentTopicId);

    // 如果topicId和parentTopicId不同，说明是child topic，需要从childList中查找
    let topicInfo;
    if (topicId !== parentTopicId) {
      topicInfo = findChildTopic(rawTopicInfo, topicId);
    } else {
      topicInfo = rawTopicInfo;
    }

    const yesToken = topicInfo.yesToken;
    const noToken = topicInfo.noToken;

    const allOrders = await db.getOrdersByAssetIds([yesToken, noToken].filter(t => t && t !== '0'));

    if (allOrders.length === 0) {
      return {
        stats: {
          yesOrders: 0,
          noOrders: 0,
          totalOrders: 0,
          yesVolume: '0.0000',
          noVolume: '0.0000',
          totalVolume: '0.0000',
          buyOrders: 0,
          sellOrders: 0,
          buyVolume: '0.0000',
          sellVolume: '0.0000'
        },
        volumeData: [],
        trades: []
      };
    }

    const filteredOrders = filterOrdersByTimeRange(allOrders, range);
    const stats = getTradeStats(filteredOrders, yesToken, noToken);
    const volumeData = aggregateVolumeByInterval(filteredOrders, interval);

    const serializedVolumeData = volumeData.map(d => ({
      timestamp: d.timestamp,
      volume: formatAmount(d.volume.toString()),
      trades: d.trades,
      buyVolume: formatAmount(d.buyVolume.toString()),
      sellVolume: formatAmount(d.sellVolume.toString()),
      buyTrades: d.buyTrades,
      sellTrades: d.sellTrades
    }));

    const trades = generateTradeDetails(filteredOrders, yesToken, noToken, 100);

    return {
      stats,
      volumeData: serializedVolumeData,
      trades
    };
  } catch (error) {
    console.error('Error in handleAPIRequest:', error);
    // 返回空数据而不是抛出异常
    return {
      stats: {
        yesOrders: 0,
        noOrders: 0,
        totalOrders: 0,
        yesVolume: '0.0000',
        noVolume: '0.0000',
        totalVolume: '0.0000',
        buyOrders: 0,
        sellOrders: 0,
        buyVolume: '0.0000',
        sellVolume: '0.0000'
      },
      volumeData: [],
      trades: [],
      error: error.message
    };
  }
}

/**
 * 安全的JSON序列化（处理BigInt等特殊类型）
 */
function safeJSONStringify(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  });
}

/**
 * 发送JSON响应（带正确的Content-Length和编码）
 */
function sendJSON(res, statusCode, data) {
  const json = safeJSONStringify(data);
  const buffer = Buffer.from(json, 'utf8');

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': buffer.length
  });
  res.end(buffer);
}

/**
 * 发送HTML响应（带正确的Content-Length和编码）
 */
function sendHTML(res, html) {
  const buffer = Buffer.from(html, 'utf8');

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': buffer.length
  });
  res.end(buffer);
}

/**
 * 启动HTTP服务器
 */
async function startServer() {
  const db = new Database(config.database.path);
  await db.init();

  const topicAPI = new TopicAPI(undefined, config.proxy);

  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    try {
      if (pathname === '/') {
        sendHTML(res, generateHTML());
      } else if (pathname === '/api/topics') {
        const topics = topicAPI.getAllCachedTopics();
        sendJSON(res, 200, topics);
      } else if (pathname.startsWith('/api/topic/')) {
        const topicId = parseInt(pathname.split('/')[3]);
        try {
          const rawTopicInfo = await topicAPI.getTopicInfo(topicId);

          // 如果请求的是parent topic ID，直接返回完整信息（包括childList）
          if (rawTopicInfo.topicId === topicId) {
            // 清理冗余数据节省流量
            rawTopicInfo.raw.klineThumbnail=[];
            sendJSON(res, 200, rawTopicInfo);
          } else {
            // 如果请求的是child topic ID，从childList中查找
            const topicInfo = findChildTopic(rawTopicInfo, topicId);
            sendJSON(res, 200, topicInfo);
          }
        } catch (error) {
          sendJSON(res, 200, { error: error.message });
        }
      } else if (pathname === '/api/data') {
        const data = await handleAPIRequest(parsedUrl.query, db, topicAPI);
        sendJSON(res, 200, data);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
      }
    } catch (error) {
      console.error('Request error:', error);
      sendJSON(res, 500, { error: 'Internal Server Error', message: error.message });
    }
  });

  server.listen(PORT, () => {
    console.log(`\nDashboard server started at http://localhost:${PORT}`);
    console.log(`Opening browser...\n`);

    const url = `http://localhost:${PORT}`;
    const command = process.platform === 'win32'
      ? `cmd.exe /c start ${url}`
      : process.platform === 'darwin'
      ? `open ${url}`
      : `xdg-open ${url}`;

    exec(command, (error) => {
      if (error) {
        console.log(`Manual access: ${url}`);
      }
    });
  });

  process.on('SIGINT', () => {
    console.log('\n\nShutting down server...');
    db.close();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
}

startServer().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
