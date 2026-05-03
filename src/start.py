#!/usr/bin/env python3
"""独立启动文件预览器后端（不依赖 QwenPaw）"""

import os
import sys
import logging
from http.server import HTTPServer

# 添加父目录到路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from plugin import FileViewerHandler, PORT, STATIC_DIR, logger

# 设置日志
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')

if __name__ == '__main__':
    print(f"📂 文件预览器后端启动中...")
    print(f"   端口：{PORT}")
    print(f"   静态文件：{STATIC_DIR}")
    
    server = HTTPServer(("127.0.0.1", PORT), FileViewerHandler)
    print(f"✅ 服务已就绪：http://127.0.0.1:{PORT}")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 正在关闭...")
        server.shutdown()
