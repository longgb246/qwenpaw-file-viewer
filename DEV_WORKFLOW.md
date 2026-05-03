# QwenPaw File Viewer 开发流程

本文档记录了 file-viewer 插件的标准开发流程。所有修改都应遵循此流程。

## 路径清单

| 项目 | 路径 |
|------|------|
| **仓库源码** | `/home/guangbin.lgb/Work/Codes/github_codes/qwenpaw-file-viewer` |
| **插件安装目录** | `/home/guangbin.lgb/.copaw/plugins/file-viewer/` |
| **QwenPaw 主项目** | `/home/guangbin.lgb/Work/Codes/github_codes/QwenPaw` |
| **QwenPaw 配置目录** | `/home/guangbin.lgb/.copaw/` |
| **PROFILE.md** | `/home/guangbin.lgb/.copaw/workspaces/default/PROFILE.md` |

## 标准开发流程

每次修改插件代码后，按以下步骤操作（全自动，无需人工审批）：

### Step 1: 修改源码

在仓库 `/home/guangbin.lgb/Work/Codes/github_codes/qwenpaw-file-viewer` 中修改代码。

核心文件：
- `src/plugin.py` — 后端 HTTP API + PROFILE.md 注入
- `src/frontend.js` — 前端 React 组件
- `src/__init__.py` — Python 包入口
- `plugin.json` — 插件清单

### Step 2: 卸载旧插件

```bash
# 直接删除安装目录（比 uninstall.sh 更快更干净）
rm -rf /home/guangbin.lgb/.copaw/plugins/file-viewer/
```

注意：卸载后 PROFILE.md 中的 file-viewer 段落不会自动清理，但安装新版本时会覆盖。

### Step 3: 安装新插件

```bash
cd /home/guangbin.lgb/Work/Codes/github_codes/qwenpaw-file-viewer
bash install.sh
```

install.sh 会：
1. 自动检测配置目录（.copaw / .qwenpaw）
2. 复制 plugin.json + src/ 下的核心文件到插件目录
3. 复制 src/static/ 到插件目录
4. 更新 config.json 注册插件

### Step 4: 重启 QwenPaw

```bash
cd /home/guangbin.lgb/Work/Codes/github_codes/QwenPaw

# 停止
./docker_stop.sh
# 等待完全关闭（约 5-10 秒）

# 启动
./docker_start.sh
# 等待完全启动（约 15-30 秒）
```

### Step 5: 验证

重启完成后通知用户。用户在浏览器中刷新 QwenPaw 页面即可使用新版本。

### Step 6: Git 提交 + 推送（可选）

```bash
cd /home/guangbin.lgb/Work/Codes/github_codes/qwenpaw-file-viewer
git add -A
git commit -m "feat/fix: 描述变更内容"
GIT_SSH_COMMAND="python3 $(pwd)/git-ssh-wrapper.py" HOME=/home/guangbin.lgb git push
```

## 注意事项

1. **文件权限**：所有创建/修改的文件都要 `chown -R guangbin.lgb:users`
2. **Git 账号**：项目级配置为 `longgb246 / lgb453476610@163.com`
3. **SSH 推送**：Docker 环境 SSH 不可用，需使用 `git-ssh-wrapper.py`（paramiko）
4. **静态资源**：`src/static/` 约 30MB，安装时需完整复制
5. **端口**：后端服务固定端口 39150
6. **PROFILE.md 注入**：插件启动时自动注入，关闭时自动清理
