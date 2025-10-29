#!/bin/bash

echo "=== OP Volume Monitor Quick Start ==="
echo ""

# 检查node_modules
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

# 检查数据库
if [ ! -f "data/orders.db" ]; then
    echo "⚠ Warning: Database not found. Please run monitor server first:"
    echo "  npm run monitor"
    echo ""
fi

# 显示示例
echo "Example Commands:"
echo ""
echo "1. Start Monitor Server:"
echo "   npm run monitor"
echo ""
echo "2. View Dashboard (Topic ID):"
echo "   npm run dashboard 792"
echo "   npm run dashboard 792 5    # 5-second interval"
echo ""
echo "3. Test Topic API:"
echo "   node test_topic.js"
echo ""
echo "4. Run Demo:"
echo "   node demo.js"
echo ""

# 如果提供了参数，执行相应命令
if [ "$1" = "monitor" ]; then
    echo "Starting monitor server..."
    node monitorServer.js
elif [ "$1" = "dashboard" ]; then
    if [ -z "$2" ]; then
        echo "Please provide topic ID:"
        echo "  ./quickstart.sh dashboard 792"
    else
        node dashboard.js $2 ${3:-1}
    fi
elif [ "$1" = "demo" ]; then
    node demo.js
else
    echo "Run with argument to execute:"
    echo "  ./quickstart.sh monitor"
    echo "  ./quickstart.sh dashboard 792"
    echo "  ./quickstart.sh demo"
fi
