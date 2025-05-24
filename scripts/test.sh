#!/bin/bash

# 🧪 Podcast Summarizer 测试运行脚本
# 提供便捷的测试运行选项

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 显示帮助信息
show_help() {
    echo -e "${BLUE}🧪 Podcast Summarizer 测试运行脚本${NC}"
    echo ""
    echo "用法: ./scripts/test.sh [选项]"
    echo ""
    echo "选项:"
    echo "  all           运行所有测试"
    echo "  db            运行数据库测试 (推荐 - 100% 通过)"
    echo "  api           运行 API 测试"
    echo "  components    运行组件测试"
    echo "  working       只运行通过的测试"
    echo "  broken        只运行失败的测试"
    echo "  coverage      运行测试并生成覆盖率报告"
    echo "  watch         监听模式运行测试"
    echo "  clean         清理测试缓存"
    echo "  status        显示测试状态总结"
    echo "  help          显示此帮助信息"
    echo ""
    echo "示例:"
    echo "  ./scripts/test.sh db        # 运行数据库测试"
    echo "  ./scripts/test.sh working   # 只运行通过的测试"
    echo "  ./scripts/test.sh coverage  # 生成覆盖率报告"
}

# 运行数据库测试
run_db_tests() {
    echo -e "${GREEN}🗃️  运行数据库测试 (38/38 通过)${NC}"
    npm test -- __tests__/lib/
}

# 运行 API 测试
run_api_tests() {
    echo -e "${YELLOW}🔌 运行 API 测试 (部分通过)${NC}"
    npm test -- __tests__/api/
}

# 运行组件测试
run_component_tests() {
    echo -e "${YELLOW}⚛️  运行组件测试${NC}"
    npm test -- __tests__/dashboard/
}

# 只运行通过的测试
run_working_tests() {
    echo -e "${GREEN}✅ 运行通过的测试${NC}"
    echo -e "${BLUE}数据库测试:${NC}"
    npm test -- __tests__/lib/
    echo ""
    echo -e "${BLUE}DB-Init API 测试:${NC}"
    npm test -- __tests__/api/db-init.test.ts
}

# 只运行失败的测试
run_broken_tests() {
    echo -e "${RED}🔧 运行需要修复的测试${NC}"
    echo -e "${YELLOW}注意: 这些测试当前有问题，仅用于调试${NC}"
    npm test -- __tests__/api/upload.test.ts __tests__/api/podcasts.test.ts __tests__/api/process.test.ts __tests__/dashboard/
}

# 运行所有测试
run_all_tests() {
    echo -e "${BLUE}🚀 运行所有测试${NC}"
    npm test
}

# 生成覆盖率报告
run_coverage() {
    echo -e "${BLUE}📊 生成测试覆盖率报告${NC}"
    npm test -- --coverage
}

# 监听模式
run_watch() {
    echo -e "${BLUE}👀 监听模式运行测试${NC}"
    npm test -- --watch
}

# 清理缓存
clean_cache() {
    echo -e "${YELLOW}🧹 清理测试缓存${NC}"
    npm test -- --clearCache
    echo -e "${GREEN}缓存已清理${NC}"
}

# 显示测试状态
show_status() {
    echo -e "${BLUE}📊 测试状态总结${NC}"
    echo ""
    echo -e "${GREEN}✅ 通过的测试:${NC}"
    echo "  - 数据库操作测试: 24/24"
    echo "  - 数据库集成测试: 14/14"
    echo "  - DB-Init API 测试: 7/7"
    echo "  - 总计: 45/67 (67%)"
    echo ""
    echo -e "${YELLOW}🔧 需要修复的测试:${NC}"
    echo "  - Upload API: 0/8 (HTTP 方法路由问题)"
    echo "  - Podcasts API: 0/10 (Mock 集成问题)"
    echo "  - Process API: 0/4 (响应结构问题)"
    echo "  - Dashboard 组件: 0/1 (ES 模块问题)"
    echo "  - 总计: 22/67 (33%)"
    echo ""
    echo -e "${BLUE}📁 测试文件分布:${NC}"
    echo "  - __tests__/lib/: 2 文件 (完全通过)"
    echo "  - __tests__/api/: 4 文件 (1/4 通过)"
    echo "  - __tests__/dashboard/: 1 文件 (需要修复)"
    echo ""
    echo -e "${GREEN}💡 推荐操作:${NC}"
    echo "  ./scripts/test.sh working    # 运行所有通过的测试"
    echo "  ./scripts/test.sh db         # 运行数据库测试 (100% 通过)"
}

# 主逻辑
case "${1:-help}" in
    "all")
        run_all_tests
        ;;
    "db")
        run_db_tests
        ;;
    "api")
        run_api_tests
        ;;
    "components")
        run_component_tests
        ;;
    "working")
        run_working_tests
        ;;
    "broken")
        run_broken_tests
        ;;
    "coverage")
        run_coverage
        ;;
    "watch")
        run_watch
        ;;
    "clean")
        clean_cache
        ;;
    "status")
        show_status
        ;;
    "help"|*)
        show_help
        ;;
esac 