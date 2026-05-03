.PHONY: install uninstall dev validate clean help

# 自动检测配置目录
CONFIG_DIR := $(or $(QWENPAW_WORKING_DIR),$(COPAW_WORKING_DIR),$(if $(wildcard $(HOME)/.copaw),$(HOME)/.copaw,$(HOME)/.qwenpaw))
PLUGIN_DIR := $(CONFIG_DIR)/plugins/file-viewer

help: ## 显示帮助
	@echo "QwenPaw File Viewer"
	@echo ""
	@echo "  make install    安装插件到 $(CONFIG_DIR)"
	@echo "  make uninstall  卸载插件"
	@echo "  make dev        开发模式（软链接）"
	@echo "  make validate   验证插件结构"
	@echo "  make clean      清理临时文件"
	@echo ""
	@echo "检测到的配置目录: $(CONFIG_DIR)"

install: ## 安装插件
	@bash install.sh

uninstall: ## 卸载插件
	@bash uninstall.sh

dev: ## 开发模式 — 创建软链接到插件目录
	@echo "🔗 创建开发模式软链接..."
	@if [ -d "$(PLUGIN_DIR)" ] && [ ! -L "$(PLUGIN_DIR)" ]; then \
		echo "  备份已有目录..."; \
		mv "$(PLUGIN_DIR)" "$(PLUGIN_DIR).bak.$$(date +%Y%m%d_%H%M%S)"; \
	fi
	@mkdir -p "$(dir $(PLUGIN_DIR))"
	@ln -sfn "$$(pwd)" "$(PLUGIN_DIR)"
	@echo "  ✓ $(PLUGIN_DIR) -> $$(pwd)"
	@echo ""
	@echo "📌 开发模式已启用，代码改动即时生效（需重启 QwenPaw）"

validate: ## 验证插件结构
	@echo "🔍 验证插件结构..."
	@python3 -c "import json; d=json.load(open('plugin.json')); \
		assert d.get('id'), 'missing id'; \
		assert d.get('name'), 'missing name'; \
		assert d.get('version'), 'missing version'; \
		assert d.get('entry',{}).get('backend'), 'missing entry.backend'; \
		print('  ✓ plugin.json 结构正确')"
	@python3 -c "import py_compile; py_compile.compile('src/plugin.py', doraise=True); \
		print('  ✓ src/plugin.py 语法正确')"
	@test -f src/frontend.js && echo "  ✓ src/frontend.js 存在" || echo "  ⚠️  src/frontend.js 不存在"
	@test -f src/__init__.py && echo "  ✓ src/__init__.py 存在" || echo "  ⚠️  src/__init__.py 不存在"
	@test -d src/static && echo "  ✓ src/static/ 存在 ($$(du -sh src/static | cut -f1))" || echo "  ⚠️  src/static/ 不存在"
	@echo ""
	@echo "✅ 验证通过"

clean: ## 清理临时文件
	@find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@find . -name "*.pyc" -delete 2>/dev/null || true
	@find . -name "*.bak" -delete 2>/dev/null || true
	@find . -name "*.bak.*" -delete 2>/dev/null || true
	@find . -name "core.*" -delete 2>/dev/null || true
	@echo "🧹 已清理"
