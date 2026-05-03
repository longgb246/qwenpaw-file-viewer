# Contributing / 贡献指南

感谢你对 QwenPaw File Viewer 的关注！欢迎通过以下方式参与贡献。

## 报告问题

- 使用 [GitHub Issues](https://github.com/longgb246/qwenpaw-file-viewer/issues) 报告 bug 或提出功能建议
- 请尽量提供：QwenPaw 版本、Python 版本、操作系统、错误日志、文件类型

## 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交改动：`git commit -m 'feat: add your feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 提交 Pull Request

### Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 文档更新
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建/工具变更

### 代码规范

- Python 代码遵循 PEP 8
- JavaScript 使用 4 空格缩进
- 所有文件使用 UTF-8 编码、LF 换行

### 验证

提交前请运行验证：

```bash
make validate
```

## 开发模式

使用软链接进行本地开发：

```bash
make dev
```

修改代码后重启 QwenPaw 即可看到效果。

## 许可证

贡献的代码将遵循本项目的 [MIT License](LICENSE)。
