const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');

/**
 * Topic API管理类
 * 用于获取预测市场topic信息并缓存到本地
 */
class TopicAPI {
  constructor(cacheDir = path.join(__dirname, '../.cache/topics'), proxyConfig = null) {
    this.baseUrl = 'https://proxy.opinion.trade:8443/api/bsc/api/v2/topic';
    this.cacheDir = cacheDir;
    this.agent = proxyConfig && proxyConfig.enabled ? new HttpsProxyAgent(proxyConfig.url) : null;
    this.nonMultiListPath = path.join(this.cacheDir, 'non_multi_topics.json');
    this.nonMultiTopics = this.loadNonMultiList();
  }

  /**
   * 确保缓存目录存在
   */
  ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 加载非multi topic列表
   */
  loadNonMultiList() {
    try {
      if (fs.existsSync(this.nonMultiListPath)) {
        const content = fs.readFileSync(this.nonMultiListPath, 'utf-8');
        const data = JSON.parse(content);
        return new Set(data.topics || []);
      }
    } catch (error) {
      console.error(`加载非multi列表失败:`, error.message);
    }
    return new Set();
  }

  /**
   * 保存非multi topic列表
   */
  saveNonMultiList() {
    try {
      this.ensureCacheDir();
      const data = {
        timestamp: Date.now(),
        topics: Array.from(this.nonMultiTopics)
      };
      fs.writeFileSync(this.nonMultiListPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error(`保存非multi列表失败:`, error.message);
    }
  }

  /**
   * 添加topic到非multi列表
   */
  addToNonMultiList(topicId) {
    if (!this.nonMultiTopics.has(topicId)) {
      this.nonMultiTopics.add(topicId);
      this.saveNonMultiList();
      console.log(`✓ Topic ${topicId} 已标记为非multi，下次将跳过multi查询`);
    }
  }

  /**
   * 检查topic是否为非multi
   */
  isNonMultiTopic(topicId) {
    return this.nonMultiTopics.has(topicId);
  }

  /**
   * 获取缓存文件路径
   */
  getCachePath(topicId) {
    return path.join(this.cacheDir, `topic_${topicId}.json`);
  }

  /**
   * 从缓存读取topic信息
   */
  loadFromCache(topicId) {
    try {
      const cachePath = this.getCachePath(topicId);
      if (!fs.existsSync(cachePath)) {
        return null;
      }

      const content = fs.readFileSync(cachePath, 'utf-8');
      const cached = JSON.parse(content);

      // 检查缓存是否过期（24小时）
      const cacheAge = Date.now() - cached.timestamp;
      const maxAge = 24 * 60 * 60 * 1000;

      if (cacheAge < maxAge) {
        console.log(`✓ 从缓存加载 Topic ${topicId}`);
        return cached.data;
      } else {
        console.log(`! Topic ${topicId} 缓存已过期，重新获取`);
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * 保存topic信息到缓存
   */
  saveToCache(topicId, data) {
    try {
      this.ensureCacheDir();
      const cachePath = this.getCachePath(topicId);
      const cached = {
        timestamp: Date.now(),
        topicId: topicId,
        data: data
      };
      fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2), 'utf-8');
      console.log(`✓ Topic ${topicId} 已缓存到本地`);
    } catch (error) {
      console.error(`保存缓存失败:`, error.message);
    }
  }

  /**
   * 尝试从multi接口获取topic信息
   */
  async getTopicInfoFromMulti(topicId) {
    const multiUrl = `https://proxy.opinion.trade:8443/api/bsc/api/v2/topic/mutil/${topicId}`;
    console.log(`→ 尝试从Multi API获取 Topic ${topicId}...`);

    const config = {
      method: 'get',
      url: multiUrl,
      timeout: 10000,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    };

    if (this.agent) {
      config.httpsAgent = this.agent;
      config.proxy = false;
    }

    try {
      const response = await axios(config);

      // 检查返回数据是否有效
      if (response.data && response.data.errno === 0 && response.data.result && response.data.result.data) {
        console.log(`✓ Multi API返回有效数据`);
        return this.parseTopicInfo(response.data);
      } else {
        console.log(`! Multi API返回数据无效，使用fallback`);
        // 将topic添加到非multi列表
        this.addToNonMultiList(topicId);
        return null;
      }
    } catch (error) {
      console.log(`! Multi API查询失败: ${error.message}，使用fallback`);
      // 将topic添加到非multi列表
      this.addToNonMultiList(topicId);
      return null;
    }
  }

  /**
   * 根据topicId获取topic详情（带缓存）
   */
  async getTopicInfo(topicId, forceRefresh = false) {
    // 如果不强制刷新，先尝试从缓存读取
    if (!forceRefresh) {
      const cached = this.loadFromCache(topicId);
      if (cached) {
        return cached;
      }
    }

    // 检查是否为已知的非multi topic，如果是则直接跳过multi查询
    if (!this.isNonMultiTopic(topicId)) {
      // 先尝试使用multi接口
      try {
        const multiResult = await this.getTopicInfoFromMulti(topicId);
        if (multiResult) {
          // 保存到缓存
          this.saveToCache(topicId, multiResult);
          return multiResult;
        }
      } catch (error) {
        console.log(`Multi接口异常: ${error.message}`);
      }
    } else {
      console.log(`✓ Topic ${topicId} 已知为非multi，跳过multi查询`);
    }

    // Fallback到原接口
    try {
      const url = `${this.baseUrl}/${topicId}`;
      console.log(`→ 从原API获取 Topic ${topicId}...`);

      const config = {
        method: 'get',
        url: url,
        timeout: 10000,
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
      };

      if (this.agent) {
        config.httpsAgent = this.agent;
        config.proxy = false;
      }

      const response = await axios(config);
      const topicInfo = this.parseTopicInfo(response.data);

      // 保存到缓存
      this.saveToCache(topicId, topicInfo);

      return topicInfo;
    } catch (error) {
      console.error(`获取Topic ${topicId}失败:`, error.message);
      throw error;
    }
  }

  /**
   * 解析topic信息
   */
  parseTopicInfo(data) {
    const result = data.result || data.data || data;

    if (!result || !result.data) {
      throw new Error('无效的topic数据');
    }

    const topicData = result.data;

    // 提取关键信息
    const topicInfo = {
      topicId: topicData.topicId,
      title: topicData.title,
      status: topicData.status,
      chainId: topicData.chainId,

      // Question ID
      questionId: topicData.questionId,

      // Token IDs - 这是我们需要的AssetId
      yesToken: topicData.yesPos,
      noToken: topicData.noPos || '0',  // NO token默认为0

      // 价格信息
      yesPrice: topicData.yesMarketPrice,
      noPrice: topicData.noMarketPrice,

      // 其他信息
      volume: topicData.volume,
      totalPrice: topicData.totalPrice,
      cutoffTime: topicData.cutoffTime,

      // 原始数据
      raw: topicData
    };

    return topicInfo;
  }

  /**
   * 获取用于交易量查询的token配置
   */
  async getTokens(topicId) {
    const topicInfo = await this.getTopicInfo(topicId);

    return {
      yes: topicInfo.yesToken,
      no: topicInfo.noToken,
      title: topicInfo.title,
      topicId: topicInfo.topicId
    };
  }

  /**
   * 获取所有已缓存的topics列表
   */
  getAllCachedTopics() {
    try {
      this.ensureCacheDir();

      const files = fs.readdirSync(this.cacheDir);
      const topics = [];

      for (const file of files) {
        if (file.startsWith('topic_') && file.endsWith('.json')) {
          try {
            const cachePath = path.join(this.cacheDir, file);
            const content = fs.readFileSync(cachePath, 'utf-8');
            const cached = JSON.parse(content);

            if (cached.data) {
              topics.push({
                topicId: cached.data.topicId,
                title: cached.data.title,
                yesToken: cached.data.yesToken,
                noToken: cached.data.noToken,
                yesPrice: cached.data.yesPrice,
                noPrice: cached.data.noPrice,
                status: cached.data.status,
                timestamp: cached.timestamp
              });
            }
          } catch (error) {
            console.error(`Failed to read cache file ${file}:`, error.message);
          }
        }
      }

      // 按timestamp降序排序（最新的在前）
      topics.sort((a, b) => b.timestamp - a.timestamp);

      return topics;
    } catch (error) {
      console.error('Failed to get cached topics:', error.message);
      return [];
    }
  }
}

module.exports = TopicAPI;
