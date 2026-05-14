# md2r2

提取 Markdown 文件中本地图片/资源，上传到 Cloudflare R2，并把原文中的本地路径就地替换为 CDN 链接的 CLI 工具。

> **md2r2** = **m**ark**d**own → **R2**

## 安装与使用

无需全局安装，直接通过 `npx` 调用：

```bash
# 首次使用，先生成配置文件模板
npx md2r2 init

# 编辑 ~/.config/md2r2/config.json 填入凭证后即可上传
npx md2r2 ./posts/some-article.md
```

也可全局安装：

```bash
npm i -g md2r2
md2r2 ./posts/some-article.md
```

## 命令

| 命令 | 说明 |
| --- | --- |
| `md2r2 <md-file>` | 解析、上传、写回 markdown |
| `md2r2 init [--force]` | 在用户目录创建配置模板，加 `--force` 覆盖已有文件 |
| `md2r2 config-path` | 打印当前配置文件的绝对路径 |
| `md2r2 --help` | 显示帮助 |

### 可选参数

- `--dry-run`：只解析与分类，不上传也不写回文件
- `--no-write`：上传完成后只打印结果，不修改源 markdown

## 配置文件

默认位置（按平台优先级）：

| 平台 | 路径 |
| --- | --- |
| macOS / Linux | `~/.config/md2r2/config.json` |
| Windows | `%APPDATA%\md2r2\config.json` |
| 任意 | 设置环境变量 `MD2R2_CONFIG_DIR=/path/to/dir` 自定义 |

文件结构：

```json
{
  "accountId": "your-cloudflare-account-id",
  "accessKeyId": "your-r2-access-key-id",
  "secretAccessKey": "your-r2-secret-access-key",
  "bucket": "your-bucket",
  "publicDomain": "https://cdn.example.com",
  "uploadPrefix": "blog",
  "concurrency": 5
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `accountId` | ✅ | Cloudflare 账户 ID（用于拼接 R2 endpoint） |
| `accessKeyId` | ✅ | R2 Access Key |
| `secretAccessKey` | ✅ | R2 Secret Key |
| `bucket` | ✅ | 存储桶名称 |
| `publicDomain` | ✅ | 绑定到该 bucket 的公开访问域名，用于拼接最终 URL 并判定"已在 CDN" |
| `uploadPrefix` | ❌ | bucket 内的前缀路径，可留空 |
| `concurrency` | ❌ | 并行上传数量，默认 5 |

## 特性

- 同时识别 Markdown 图片 `![](path)`、HTML `<img src="...">`、Markdown 链接 `[text](path)`
- 已使用 `publicDomain` 的资源会自动跳过，避免重复上传
- 同一篇 markdown 内被引用多次的相同本地文件按绝对路径去重，只上传一次
- 上传后对象采用 `UUID + 原扩展名` 命名，避免冲突
- **Typora 友好的 alt 处理**：本地资源始终上传并替换 URL；只有当 `![alt](url)` 的 `alt` 与原 URL 的文件名一致（典型的 Typora 自动命名）时，才会同步把 alt 更新为新文件名；如果 alt 已被你改成有意义的描述，则保持不动
- 通过 `p-limit` 控制并发，过程实时彩色日志
- 代码按模块拆分（`config` / `logger` / `markdown` / `uploader` / `cli` / `index`）

### alt 处理规则示例

| 输入 | 输出 |
| --- | --- |
| `![image-20260514182000123](./image-20260514182000123.png)` | `![<新文件名>](https://cdn.example.com/.../<uuid>.png)` |
| `![image-001.png](./image-001.png)` | `![<新文件名.png>](https://cdn.example.com/.../<uuid>.png)` |
| `![我喜欢的猫](./image-001.png)` | `![我喜欢的猫](https://cdn.example.com/.../<uuid>.png)` |

## 目录结构

```
src/
├── index.js      # CLI 入口与流程编排
├── cli.js        # 参数解析、帮助、引导、汇总打印
├── config.js     # 用户目录配置加载与模板生成
├── logger.js     # 实时彩色日志
├── markdown.js   # 正则提取与就地替换
└── uploader.js   # R2 客户端、对象 key 生成、上传
```

## 本地开发

```bash
yarn install
yarn start ./path/to/some.md
# 或直接
node src/index.js init
```

## 许可证

MIT
