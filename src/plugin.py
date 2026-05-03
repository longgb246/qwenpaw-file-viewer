"""
文件预览器 - 后端
独立的 HTTP 服务，提供文件读取 API 和静态文件服务。
监听 39150 端口。
在 PROFILE.md 中注入/清理能力说明。
"""

import os
import re
import json
import base64
import logging
import threading
import mimetypes
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

logger = logging.getLogger("plugin:file-viewer")
PORT = 39150

# ── 静态文件目录（Luckysheet）────────────────────────────────────
STATIC_DIR = Path(__file__).parent / "static"

# ── Agent 能力注入 ────────────────────────────────────────────────
PLUGIN_ID = "file-viewer"
PROFILE_PATH = Path.home() / ".copaw" / "workspaces" / "default" / "PROFILE.md"

SECTION_START = f"<!-- PLUGIN:{PLUGIN_ID} START -->"
SECTION_END = f"<!-- PLUGIN:{PLUGIN_ID} END -->"
SECTION_BODY = f"""{SECTION_START}
### 📂 文件预览器 (file-viewer)

你安装了 file-viewer 插件。聊天中会自动将文件渲染为可点击的预览卡片，用户点击后
右侧滑出面板查看内容。

**触发预览的方式（两种）**：
1. **`write_file`** — 写出文件后，自动渲染预览卡片（适合生成新文件）
2. **`read_file`** — 读取已有文件后，同样会渲染预览卡片（适合预览已有文件）

**支持的类型**：
- 📝 **文本文件**：Markdown / JSON / 代码 / HTML / CSV / YAML / TOML 等
- 📕 **二进制文件**：PDF / Excel / PPTX / 图片

**作为 agent，你应该：**
- 生成报告、总结等内容时，用 `write_file` 输出到文件，让用户获得可视化预览
- **当用户要求预览已有文件时**，直接用 `read_file` 读取该文件，前端会自动弹出预览卡片
- 文件写到任何你方便管理的目录（如 `research/`、`reports/`、`/tmp/` 等）
- 文件名用有意义的命名（如 `SQL优化调研报告.md`）
- 善用表格、代码块、标题让内容更易读

**限制**：单文件不超过 5MB。

**⚠️ 发送文件给用户预览时：同时调用 `write_file` 和 `send_file_to_user`！**
- `write_file` → web 端显示可点击的预览卡片
- `send_file_to_user` → 确保移动端也能收到文件
{SECTION_END}
"""


def _inject_profile_section():
    """向 PROFILE.md 追加能力说明段落。幂等：已存在则跳过。"""
    try:
        if not PROFILE_PATH.exists():
            logger.warning("PROFILE.md 不存在: %s", PROFILE_PATH)
            return

        content = PROFILE_PATH.read_text(encoding="utf-8")
        if SECTION_START in content:
            logger.debug("PROFILE.md 中已存在 file-viewer 段落，跳过")
            return

        injected = content.rstrip() + "\n\n" + SECTION_BODY
        PROFILE_PATH.write_text(injected, encoding="utf-8")
        logger.info("✅ 已向 PROFILE.md 注入 file-viewer 能力说明")
    except Exception as e:
        logger.error("注入 PROFILE.md 失败: %s", e)


def _remove_profile_section():
    """从 PROFILE.md 精确删除 file-viewer 段落。"""
    try:
        if not PROFILE_PATH.exists():
            return

        content = PROFILE_PATH.read_text(encoding="utf-8")
        if SECTION_START not in content:
            return

        # 精确删除标记段落及其周围空白
        pattern = re.compile(
            r"\n*" + re.escape(SECTION_START) + r".*?" + re.escape(SECTION_END) + r"\n*",
            re.DOTALL,
        )
        cleaned = pattern.sub("\n", content).rstrip() + "\n"
        PROFILE_PATH.write_text(cleaned, encoding="utf-8")
        logger.info("✅ 已从 PROFILE.md 移除 file-viewer 能力说明")
    except Exception as e:
        logger.error("移除 PROFILE.md 段落失败: %s", e)


class FileViewerHandler(BaseHTTPRequestHandler):
    """REST API 处理器"""

    def log_message(self, fmt, *args):
        logger.debug("API %s", fmt % args)

    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


    def do_GET(self):
        """处理静态文件请求（Luckysheet 的 CSS/JS）"""
        # /static/css/xxx.css 或 /static/xxx.js
        if self.path.startswith("/static/"):
            relative_path = self.path[8:]  # 去掉 /static/
            file_path = STATIC_DIR / relative_path
            
            # 安全检查：防止目录穿越
            try:
                file_path.resolve().relative_to(STATIC_DIR.resolve())
            except ValueError:
                self._send_json({"error": "非法路径"}, 403)
                return
            
            if not file_path.exists() or not file_path.is_file():
                self.send_response(404)
                self.end_headers()
                return
            
            # 读取并返回
            ext = file_path.suffix.lower()
            mime_map = {
                '.css': 'text/css',
                '.js': 'application/javascript',
                '.woff': 'font/woff',
                '.woff2': 'font/woff2',
                '.ttf': 'font/ttf',
            }
            content_type = mime_map.get(ext, 'application/octet-stream')
            
            # 读取文件内容
            with open(file_path, 'rb') as f:
                file_data = f.read()
            
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "public, max-age=31536000")
            self.send_header("Content-Length", str(len(file_data)))
            self.end_headers()
            
            self.wfile.write(file_data)
        else:
            self.send_response(404)
            self.end_headers()


    def do_POST(self):
        if self.path == "/read":
            self._handle_read()
        else:
            self._send_json({"error": "未知端点: " + self.path}, 404)

    def _handle_read(self):
        """读取文件内容并返回。文本文件返回字符串，二进制文件返回 base64。"""
        try:
            body = self._read_body()
            file_path = body.get("path", "").strip()
            encoding = body.get("encoding", "utf-8")

            if not file_path:
                self._send_json({"error": "缺少 path 参数"}, 400)
                return

            abs_path = os.path.abspath(os.path.expanduser(file_path))
            if ".." in abs_path.split(os.sep):
                self._send_json({"error": "路径不允许包含 .."}, 403)
                return

            if not os.path.isfile(abs_path):
                self._send_json({"error": f"文件不存在: {abs_path}"}, 404)
                return

            file_size = os.path.getsize(abs_path)
            if file_size > 5 * 1024 * 1024:
                self._send_json({"error": f"文件过大 ({file_size} bytes)，超过 5MB 限制"}, 413)
                return

            ext = os.path.splitext(abs_path)[1].lower()

            # 二进制文件 → base64
            BINARY_EXTS = {'.pdf', '.xlsx', '.xls', '.png', '.jpg', '.jpeg', '.gif',
                           '.webp', '.svg', '.ico', '.bmp', '.zip', '.gz', '.tar',
                           '.docx', '.doc', '.pptx', '.ppt'}
            if ext in BINARY_EXTS:
                with open(abs_path, "rb") as f:
                    raw = f.read()
                content_b64 = base64.b64encode(raw).decode("ascii")
                self._send_json({
                    "ok": True,
                    "path": abs_path,
                    "filename": os.path.basename(abs_path),
                    "ext": ext,
                    "size": file_size,
                    "binary": True,
                    "content": content_b64,
                })
                return

            # 文本文件 → 字符串
            with open(abs_path, "r", encoding=encoding, errors="replace") as f:
                content = f.read()
            self._send_json({
                "ok": True,
                "path": abs_path,
                "filename": os.path.basename(abs_path),
                "ext": ext,
                "size": file_size,
                "content": content,
                "encoding": encoding,
            })

        except Exception as e:
            logger.error("读取文件失败: %s", e)
            self._send_json({"error": str(e)}, 500)


# ── 插件入口 ────────────────────────────────────────────────────
class FileViewerPlugin:
    """符合 QwenPaw 插件接口的类"""
    _server: HTTPServer = None
    _thread: threading.Thread = None

    def register(self, api):
        """被 QwenPaw 调用进行注册"""
        logger.info("插件注册中...")
        api.register_startup_hook("file-viewer-http", self._start_server)
        api.register_shutdown_hook("file-viewer-stop", self._stop_server)
        logger.info("文件预览器后端已注册 (port=%d)", PORT)
        # 立即注入（不依赖 startup hook，确保 agent 尽早感知）
        _inject_profile_section()

    def _start_server(self):
        self._server = HTTPServer(("127.0.0.1", PORT), FileViewerHandler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        logger.info("📂 文件预览器 API 已启动: http://127.0.0.1:%d", PORT)

    def _stop_server(self):
        if self._server:
            self._server.shutdown()
            logger.info("文件预览器 API 已关闭")
        _remove_profile_section()


# QwenPaw 要求的导出名
plugin = FileViewerPlugin()
