#!/usr/bin/env node

const { spawn } = require('child_process');

// 默认topic ID (可以从命令行参数覆盖)
const topicId = process.argv[2] || '792';

console.log(`🚀 Starting Web Dashboard for Topic ${topicId}...`);
console.log(`💡 Tip: You can also run: npm run dashboard ${topicId}\n`);

const child = spawn('node', ['dashboard-web.js', topicId], {
  stdio: 'inherit',
  shell: true
});

child.on('error', (error) => {
  console.error('Failed to start dashboard:', error);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code);
});
