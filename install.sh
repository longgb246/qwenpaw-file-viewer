#!/usr/bin/env bash
# install.sh — QwenPaw File Viewer 一键安装脚本
#
# 用法：bash install.sh
#
# 自动检测配置目录（.copaw / .qwenpaw），复制插件文件并注册到 config.json。
# 安装后需重启 QwenPaw 生效。

set -e

PLUGIN_ID="file-viewer"
PLUGIN_NAME="文件预览器"
PLUGIN_VERSION="1.0.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
echo "║  QwenPaw File Viewer — 安装              ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  配置目录: $CONFIG_DIR"
echo "  安装到:   $PLUGIN_DIR"
echo ""

# ── 检查源文件 ────────────────────────────────────────────────
for f in plugin.json src/plugin.py src/frontend.js src/__init__.py; do
    if [ ! -f "$SCRIPT_DIR/$f" ]; then
        echo "❌ 缺少文件: $SCRIPT_DIR/$f"
        exit 1
    fi
done

if [ ! -d "$SCRIPT_DIR/src/static" ]; then
    echo "❌ 缺少目录: $SCRIPT_DIR/src/static"
    exit 1
fi

# ── 检查 QwenPaw 是否在运行 ───────────────────────────────────
if command -v qwenpaw >/dev/null 2>&1; then
    if qwenpaw status >/dev/null 2>&1; then
        echo "⚠️  QwenPaw 正在运行中。建议先停止再安装："
        echo "   qwenpaw shutdown"
        echo ""
        read -p "是否继续安装？(y/N) " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "已取消。"
            exit 0
        fi
    fi
fi

# ── 备份已有版本 ──────────────────────────────────────────────
if [ -d "$PLUGIN_DIR" ]; then
    BACKUP_DIR="${PLUGIN_DIR}.bak.$(date +%Y%m%d_%H%M%S)"
    echo "📦 备份已有版本到: $BACKUP_DIR"
    mv "$PLUGIN_DIR" "$BACKUP_DIR"
fi

# ── 复制插件文件 ──────────────────────────────────────────────
echo "📁 复制插件文件..."
mkdir -p "$PLUGIN_DIR"
cp "$SCRIPT_DIR/plugin.json" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/src/plugin.py" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/src/frontend.js" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/src/__init__.py" "$PLUGIN_DIR/"
cp "$SCRIPT_DIR/src/start.py" "$PLUGIN_DIR/"

# 安装后 entry 路径需要去掉 src/ 前缀（文件被展平到插件根目录）
python3 - "$PLUGIN_DIR/plugin.json" << 'PYEOF'
import json, sys
pj = sys.argv[1]
with open(pj, "r", encoding="utf-8") as f:
    d = json.load(f)
entry = d.get("entry", {})
for k in list(entry.keys()):
    if entry[k].startswith("src/"):
        entry[k] = entry[k][4:]
with open(pj, "w", encoding="utf-8") as f:
    json.dump(d, f, indent=2, ensure_ascii=False)
print("  ✓ 已修正 plugin.json entry 路径")
PYEOF

echo "📁 复制静态资源（Luckysheet 等）..."
cp -r "$SCRIPT_DIR/src/static" "$PLUGIN_DIR/static"

# ── 更新 config.json 注册插件 ─────────────────────────────────
if [ -f "$CONFIG_JSON" ]; then
    echo "📝 更新 config.json..."
    cp "$CONFIG_JSON" "${CONFIG_JSON}.bak"

    python3 - "$CONFIG_JSON" "$PLUGIN_ID" "$PLUGIN_NAME" "$PLUGIN_VERSION" << 'PYEOF'
import json, sys

config_path, pid, pname, pver = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

with open(config_path, "r", encoding="utf-8") as f:
    config = json.load(f)

config.setdefault("plugins", {})[pid] = {
    "name": pname,
    "version": pver,
    "enabled": True,
}

with open(config_path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2, ensure_ascii=False)

print(f"  ✓ 已注册插件 {pname} ({pid})")
PYEOF
else
    echo "⚠️  未找到 config.json，插件将在 QwenPaw 首次加载时自动注册"
fi

# ── 完成 ──────────────────────────────────────────────────────
echo ""
echo "✅ 安装成功！"
echo ""
echo "📍 安装位置: $PLUGIN_DIR"
STATIC_SIZE=$(du -sh "$PLUGIN_DIR/static" 2>/dev/null | cut -f1)
echo "📦 静态资源: $STATIC_SIZE"
echo ""
echo "🔄 下一步："
echo "   1. 重启 QwenPaw:  qwenpaw shutdown && qwenpaw app"
echo "   2. 在聊天中让 AI 使用 write_file 输出文件，自动出现预览卡片"
echo ""
