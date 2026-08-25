# dsh-opencode-go-sub

**让 DeepSeek Harness 像 opencode 官方客户端一样，直接显示 OpenCode Go 订阅 + OpenCode Zen 免费档的完整模型目录。**

服务端插件：注册 `opencode-go`（订阅）与 `opencode-zen`（免费）两个 provider 路由。

- 🧾 **动态模型列表**：`listModels()` 实时拉取 `https://opencode.ai/zen/go/v1/models`（公开端点，与 opencode 客户端 `/models` 同源），网关新增/下架模型会自动同步；端点不可达时回退到内置快照，列表永不为空。
- 🔑 **零配置密钥（核心）**：插件自动从 **DeepSeek Harness 自身**发现订阅 key，**不依赖任何 cordis 服务注入**——解析链：
  ① 环境变量 `OPENCODE_GO_API_KEY` / `OPENCODE_ZEN_API_KEY` / `OPENCODE_API_KEY`（与 DSH 凭证层同款优先级：env 优先）；
  ② `~/.dsh/.credentials.yaml`（DSH 凭证文件，用户在 DSH 内填一次即可，**无需安装 opencode 客户端、无需设置环境变量**）；
  ③ dsh-api-key-pool 的 `pool-config.json`（`pools.opencode-go` / `pools.opencode` 下的 keys）。
  插件启动时会在日志打印 key 来源（如 `key resolved from dsh-credentials:OPENCODE_GO_API_KEY`），便于确认。
- 🚦 **错误原样透出**：403（区域封锁、未开启 "Enable models hosted in China" 等）会把网关返回的原文显示在 GUI 里。

## 安装

**从 GitHub 安装**：

```sh
dsh plugin --profile web add github:Yuanloss/dsh-opencode-go-sub
```

> 若从本地克隆目录安装：`dsh plugin --profile web add file:/你克隆的目录/dsh-opencode-go-sub`

**重启 `dsh web`** 后，模型选择器出现两个分组：`OpenCode Go（订阅）` 与 `OpenCode Zen（免费）`（模型以 `opencode-go/<model>`、`opencode-zen/<model>` 形式出现）。

## 配置密钥

**只要在 DSH 里把 key 填过一次，插件就自动读取，不需要再手动编辑任何文件。**

模型设置/凭证界面里填的 API key，会由 DSH 凭证服务写入 `~/.dsh/.credentials.yaml`；插件直接读取这个文件（键名 `OPENCODE_GO_API_KEY`）。所以三种入口**任选其一**即可，殊途同归：

1. **在 DSH 界面里填（推荐）**：在 DSH 的凭证/模型设置界面输入 key（等价于往 `~/.dsh/.credentials.yaml` 写一行）：
   ```yaml
   OPENCODE_GO_API_KEY: sk-你的Go订阅key
   ```
   key 在 opencode.ai 控制台 → 你的 workspace → OpenCode Go 页面复制。**装了这个插件，只要在 DSH 里填过这一项就能直接用**。
2. 环境变量（重启 `dsh web` 前设置）：
   ```sh
   OPENCODE_GO_API_KEY=sk-你的Go订阅key
   ```
3. 安装 [dsh-api-key-pool](https://github.com/xiaozhe7772222/dsh-api-key-pool) 后，在其 `pool-config.json` 的 `pools.opencode-go.keys` 中配置。

> 解析优先级：**环境变量 > `~/.dsh/.credentials.yaml` > key pool**。插件直接读凭证文件，不依赖任何 cordis 服务注入。启动日志会打印 key 来源（如 `key resolved from dsh-credentials:OPENCODE_GO_API_KEY`）。

> ⚠️ **重要（区分"配置密钥"和"添加 provider 路由"）**：
> - **配置密钥**：在任何界面输入 key / 设置凭证，都可以，插件会自动读取。
> - **添加 provider 路由**：不要手动新增一个**命名为 `opencode-go`** 的自定义提供商模型 provider——插件已在内部注册 `opencode-go`（订阅）与 `opencode-zen`（免费）两个路由，再加同名的会触发 `DUPLICATE_ADAPTER` 冲突，可能导致插件加载失败。
> - 插件自带订阅 + 免费两组，**无需手动添加**。若确需接入**其他**第三方 OpenAI 兼容端点，请用**别的路由名**（如 `ocgo`、`my-gateway`）。

## 模型呈现（两个分组，有序 + 友好命名）

模型选择器里会以 **provider 分组**出现两组（与 opencode 官方客户端一致）：

- **OpenCode Go（订阅）**：订阅档 30 个模型，按厂商分组有序排列，并有中文友好命名与说明。
- **OpenCode Zen（免费）**：免费档 5 个模型（key=`public`，**无需订阅**），名称带「（免费）」标注。

订阅档列表会实时同步网关目录（`/zen/go/v1/models`），已收录的按内置目录顺序渲染，**新出现的模型自动追加到组内末尾**；端点不可达时回退内置快照。


## 已知限制

- **gpt-5.6-luna / grok-4.5 走 Responses API**：网关的 chat/completions 路由对它们恒 500 / "Endpoint is unavailable"，插件已自动把它们路由到 `/v1/responses`。二者由 OpenAI / xAI 托管，**中国大陆区域会被上游拒绝**（403 `unsupported_country_region_territory`）——需要走受支持区域的网络出口（VPN 需系统级 TUN 模式，浏览器级代理对 dsh web 进程无效）。
- **qwen3.7-max** 上游走 Anthropic `/messages` 方言，当前版本经 chat/completions 调用可能失败——可自行在 `MESSAGES_ONLY` 逻辑上扩展，或换用 qwen3.8-max / qwen3.7-plus。
- 图片附件暂不转发（image block 会被忽略，与 dsh-opencode-zen 一致）；纯文本会话不受影响。
- 模型调用受订阅额度与上游区域限制：中国大陆访问 GPT / Grok 系列会 403；DeepSeek 新版需先在 opencode.ai 控制台开启 "Enable models hosted in China"。

---

[中文版 README](README.md) · [English README](README.en.md)