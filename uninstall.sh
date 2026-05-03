#!/usr/bin/env bash
# uninstall.sh — QwenPaw File Viewer 一键卸载脚本
#
# 用法：bash uninstall.sh
#
# 删除插件目录，从 config.json 中移除注册信息，清理 PROFILE.md 中的标记段落。

set -e

PLUGIN_ID="file-viewer"
PLUGIN_NAME="文件预览器"

# ── 检测配置目录 ──────────────────────────────────────────────
detect_config_dir() {
    if [ -n "${QWENPAW_WORKING_DIR:-}" ]; then
        echo "$QWENPAW_WORKING_DIR"
        return
    fi
    if [ -n "${COPAW_WORKING_DIR:-}" ]; then
        echo "$COPAW_WORKING_DIR"
        return
    fi
    if [ -d "$HOME/.copaw" ]; then
        echo "$HOME/.copaw"
        return
    fi
    echo "$HOME/.qwenpaw"
}

CONFIG_DIR="$(detect_config_dir)"
PLUGIN_DIR="$CONFIG_DIR/plugins/$PLUGIN_ID"
CONFIG_JSON="$CONFIG_DIR/config.json"

echo "╔══════════════════════════════════════════╗"
echo "║  QwenPaw File Viewer — 卸载              ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  配置目录: $CONFIG_DIR"
echo "  插件目录: $PLUGIN_DIR"
echo ""

# ── 确认 ──────────────────────────────────────────────────────
if [ ! -d "$PLUGIN_DIR" ]; then
    echo "⚠️  插件目录不存在: $PLUGIN_DIR"
    echo "   可能已经卸载。"
    exit 0
fi

read -p "确定要卸载「$PLUGIN_NAME」吗？此操作不可撤销。(y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "已取消。"
    exit 0
fi

# ── 删除插件目录 ──────────────────────────────────────────────
echo "🗑️  删除插件目录..."
rm -rf "$PLUGIN_DIR"

# ── 从 config.json 移除注册信息 ───────────────────────────────
if [ -f "$CONFIG_JSON" ]; then
    echo "📝 更新 config.json..."
    cp "$CONFIG_JSON" "${CONFIG_JSON}.bak"

    python3 - "$CONFIG_JSON" "$PLUGIN_ID" << 'PYEOF'
import json, sys

config_path, pid = sys.argv[1], sys.argv[2]

with open(config_path, "r", encoding="utf-8") as f:
    config = json.load(f)

if pid in config.get("plugins", {}):
    del config["plugins"][pid]
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)
    print(f"  ✓ 已从 config.json 移除 {pid}")
else:
    print(f"  ⚠️  {pid} 不在 config.json 中")
PYEOF
fi

# ── 清理 PROFILE.md 中的标记段落 ──────────────────────────────
echo "🧹 清理 PROFILE.md..."
WORKSPACES_DIR="$CONFIG_DIR/workspaces"
if [ -d "$WORKSPACES_DIR" ]; then
    find "$WORKSPACES_DIR" -name "PROFILE.md" -type f | while read -r profile; do
        if grep -q "<!-- PLUGIN:$PLUGIN_ID START -->" "$profile" 2>/dev/null; then
            python3 - "$profile" "$PLUGIN_ID" << 'PYEOF'
import re, sys

profile_path, pid = sys.argv[1], sys.argv[2]

with open(profile_path, "r", encoding="utf-8") as f:
    content = f.read()

start_marker = f"<!-- PLUGIN:{pid} START -->"
end_marker = f"<!-- PLUGIN:{pid} END -->"
pattern = re.compile(
    r"\n*" + re.escape(start_marker) + r".*?" + re.escape(end_marker) + r"\n*",
    re.DOTALL,
)
cleaned = pattern.sub("\n", content).rstrip() + "\n"

with open(profile_path, "w", encoding="utf-8") as f:
    f.write(cleaned)

print(f"  ✓ 已清理 {profile_path}")
PYEOF
        fi
    done
fi

# ── 完成 ──────────────────────────────────────────────────────
echo ""
echo "✅ 卸载成功！"
echo ""
echo "🔄 下一步："
echo "   重启 QwenPaw:  qwenpaw shutdown && qwenpaw app"
echo ""
