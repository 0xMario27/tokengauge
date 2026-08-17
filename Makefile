# TokenGauge
# make / make help    查看所有命令

.PHONY: help build selftest smoke start dist-arm64 dist-x64 dist-universal dist-all clean

help: ## 显示帮助
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## 编译 TypeScript
	npm run build

selftest: build ## 运行确定性自检（签名/解析/迁移向量）
	node dist/selftest.js

smoke: build ## 启动冒烟（窗口加载即自动退出）
	npx electron . --smoke

start: build ## 开发模式启动
	npx electron .

dist-arm64: build ## 打包 Apple Silicon dmg（默认分发，93MB）
	npx electron-builder --mac --arm64

dist-x64: build ## 打包 Intel dmg
	npx electron-builder --mac --x64

dist-universal: build ## 打包双架构通用 dmg（体积翻倍，176MB）
	npx electron-builder --mac --universal

dist-all: build ## 打包 arm64 + x64 各一份
	npx electron-builder --mac --arm64
	npx electron-builder --mac --x64

clean: ## 清理构建产物（dist/ + release/）
	rm -rf dist release
