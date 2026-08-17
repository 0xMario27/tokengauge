# TokenGauge
# make / make help    list all commands

.PHONY: help build selftest smoke start dist-arm64 dist-x64 dist-universal dist-all clean

help: ## show help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## compile TypeScript
	npm run build

selftest: build ## run deterministic self-tests (signature/parsing/migration vectors)
	node dist/selftest.js

smoke: build ## boot smoke test (exits right after window load)
	npx electron . --smoke

start: build ## run in dev mode
	npx electron .

dist-arm64: build ## build Apple Silicon dmg (default distribution, 93MB)
	npx electron-builder --mac --arm64

dist-x64: build ## build Intel dmg
	npx electron-builder --mac --x64

dist-universal: build ## build universal dmg (both arches, twice the size, 176MB)
	npx electron-builder --mac --universal

dist-all: build ## build both arm64 and x64 dmgs
	npx electron-builder --mac --arm64
	npx electron-builder --mac --x64

clean: ## clean build outputs (dist/ + release/)
	rm -rf dist release
