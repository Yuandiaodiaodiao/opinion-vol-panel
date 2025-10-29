const fs = require('fs');

/**
 * 加载配置文件并应用环境变量覆盖
 */
function loadConfig() {
  const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

  // 从环境变量读取代理 URL
  if (process.env.HTTPS_PROXY) {
    config.proxy.url = process.env.HTTPS_PROXY;
    console.log(`Using proxy from HTTPS_PROXY: ${process.env.HTTPS_PROXY}`);
  }

  return config;
}

module.exports = { loadConfig };
