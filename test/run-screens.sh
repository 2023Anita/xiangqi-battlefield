#!/bin/sh
# 在本沙箱中运行截图测试 (needs playwright installed in ../.pw)
W="$(cd "$(dirname "$0")/../.." && pwd)/.pw"
NODE_PATH="$W/node_modules" PLAYWRIGHT_BROWSERS_PATH="$W/browsers" exec node "$(dirname "$0")/screenshots.js" "$@"
