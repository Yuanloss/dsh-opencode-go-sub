# dsh-opencode-go-sub

**Full OpenCode Go subscription + OpenCode Zen free-tier model catalog directly in DeepSeek Harness — same experience as the official opencode client.**

Server-side plugin that registers two provider routes: `opencode-go` (subscription) and `opencode-zen` (free).

- 🧾 **Live model list** — `listModels()` fetches `https://opencode.ai/zen/go/v1/models` in real time (same source as the opencode client's `/models`). Models added/removed upstream sync automatically; if the endpoint is unreachable it falls back to a built-in snapshot, so the list is never empty.
- 🔑 **Zero-config key (core)** — the plugin discovers the subscription key from DeepSeek Harness itself, **with no dependency on any cordis service injection** (never fails with `without inject`). Resolution chain:
  1. Environment variables `OPENCODE_GO_API_KEY` / `OPENCODE_ZEN_API_KEY` / `OPENCODE_API_KEY` (env wins, matching the DSH credentials layer);
  2. `~/.dsh/.credentials.yaml` — the DSH credentials file. Enter the key once inside DSH and you're done; **no opencode client, no terminal env vars needed**;
  3. dsh-api-key-pool's `pool-config.json` (keys under `pools.opencode-go` / `pools.opencode`).
  On startup the plugin logs the key source (e.g. `key resolved from dsh-credentials:OPENCODE_GO_API_KEY`) so you can confirm.
- ⚡ **Full capability** — streaming, `reasoning_content` passthrough, tool calls, token usage (incl. cache hits), 429/5xx auto-retry.
- 🚦 **Errors surface verbatim** — 403s (region block, "Enable models hosted in China" not enabled, etc.) show the gateway's original message in the GUI.
- 🔧 **Version compatibility** — implements the newer DSH adapter interface (`prepareCall`), compatible with `dsh-llm` 0.1.0-rc.6 through 0.1.1-rc.x (works on both older and newer DeepSeek Harness releases).

## Installation

From GitHub:

```sh
dsh plugin --profile web add github:Yuanloss/dsh-opencode-go-sub
```

From a local clone:

```sh
dsh plugin --profile web add file:/path/to/your/clone/dsh-opencode-go-sub
```

After a **restart of `dsh web`**, the model picker shows two groups: `OpenCode Go（订阅）` (subscription) and `OpenCode Zen（免费）` (free), with models addressed as `opencode-go/<model>` and `opencode-zen/<model>`.

## Key configuration

**As long as you enter the key once anywhere inside DSH, the plugin reads it automatically — no manual file editing needed.**

An API key entered in the DSH settings/credentials UI is written by the DSH credentials service into `~/.dsh/.credentials.yaml`; the plugin reads that file directly (key name `OPENCODE_GO_API_KEY`). Any of the three entry points below works — they all end up the same way:

1. **Enter it in the DSH UI (recommended)** — paste the key in the credentials/model settings (equivalent to writing one line into `~/.dsh/.credentials.yaml`):
   ```yaml
   OPENCODE_GO_API_KEY: sk-your-go-subscription-key
   ```
   Get the key at opencode.ai console → your workspace → OpenCode Go.
2. Environment variable (set before restarting `dsh web`):
   ```sh
   OPENCODE_GO_API_KEY=sk-your-go-subscription-key
   ```
3. Install [dsh-api-key-pool](https://github.com/xiaozhe7772222/dsh-api-key-pool) and add the key under `pools.opencode-go.keys` in its `pool-config.json`.

> Resolution priority: **env vars > `~/.dsh/.credentials.yaml` > key pool**. The plugin reads the credentials file directly and does not depend on any cordis service injection.

> ⚠️ **Important — configuring the key vs. adding a provider route:**
> - **Configuring the key**: entering the key in any UI / credential setting is fine; the plugin picks it up automatically.
> - **Adding a provider route**: do **not** manually add a custom provider named **`opencode-go`** in Settings → Models. The plugin already registers the `opencode-go` (subscription) and `opencode-zen` (free) routes; a same-named entry triggers a `DUPLICATE_ADAPTER` conflict and can prevent the plugin from loading.
> - **DSH's built-in pi-ai ships a same-named catalog entry (the common trap)**: DSH's built-in multi-provider adapter pi-ai itself ships a provider whose id is `opencode-go`, and the Models page offers it as a one-click "installed provider". Enabling it writes an `opencode-go` entry (usually only `apiKeyEnv`) under `llm-pi-ai.providers` in `~/.dsh/settings.yaml` — colliding with this plugin's `opencode-go` route. Because llm-pi-ai registers **all** of its providers (e.g. the Volcano Engine (Agent Plan) / SiliconFlow providers you added) **in one all-or-nothing batch**, one duplicate `opencode-go` makes the whole batch fail — your other added model providers silently disappear from the picker. **Fix**: delete that same-named `opencode-go` provider on the Models page (or remove the whole `llm-pi-ai.providers.opencode-go` block from `settings.yaml`, keeping `OPENCODE_GO_API_KEY` in `.credentials.yaml`). The plugin scans for this conflict at startup and prints deletion guidance; pi-ai re-registers automatically on save, no restart needed.
> - The plugin ships both groups — **no manual provider entry needed**. If you do want to reach another OpenAI-compatible endpoint, use a different route name (e.g. `ocgo`, `my-gateway`).

## Model presentation (two groups, ordered, friendly names)

The picker shows two groups by provider (matching the official opencode client):

- **OpenCode Go (subscription)** — 30 models, ordered by vendor, with friendly names and descriptions.
- **OpenCode Zen (free)** — 5 free models (key=`public`, **no subscription required**), marked "（免费）".

The subscription list syncs the live gateway catalog (`/zen/go/v1/models`); known models render in the built-in order, **newly appearing models append to the end of the group**; offline fallback to the snapshot.

## Known limitations

- **gpt-5.6-luna / grok-4.5 go through the Responses API** — the gateway's chat/completions route returns 500 / "Endpoint is unavailable" for them, so the plugin auto-routes them to `/v1/responses`. Both are hosted by OpenAI / xAI and are **blocked from mainland China** (403 `unsupported_country_region_territory`) — you need an exit in a supported region (the VPN must be system-wide TUN mode; a browser-only proxy does not affect the dsh web process).
- **qwen3.7-max** is served upstream through the Anthropic `/messages` dialect and may fail via chat/completions in this version — extend the `MESSAGES_ONLY` logic yourself, or use qwen3.8-max / qwen3.7-plus instead.
- **Image attachments are not forwarded** (image blocks are ignored, same as dsh-opencode-zen); text-only conversations are unaffected.
- Calls are subject to subscription quotas and upstream region policy: GPT / Grok models return 403 from mainland China; newer DeepSeek versions require enabling "Enable models hosted in China" in the opencode.ai console first.

---

[中文版 README](README.md) · [English README](README.en.md)