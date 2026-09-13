# google-antigravity-acp

An [Agent Client Protocol (ACP)](https://agentclientprotocol.com) server for Google Antigravity.

This project enables any ACP-compatible client (such as Zed, OpenClaw, Neovim, and other developer tools) to communicate with Google Antigravity using standard JSON-RPC 2.0 over `stdio`.

The same npm package also ships a native OpenClaw CLI backend. It exposes
Antigravity models under the `google-antigravity-cli/*` model namespace while
preserving Antigravity conversation IDs, streamed responses, native tool-call
events, cancellation, and usage reporting.

---

## How It Works

Google Antigravity ships with an official command-line executable (`agy`). Under the hood, `agy` includes a headless streaming mode that exchanges newline-delimited JSON (NDJSON) over standard input and output:

```bash
agy --input-format=stream-json --output-format=stream-json
```

`google-antigravity-acp` bridges this interface to the open **Agent Client Protocol (ACP)** standard:

- Exposes standard ACP JSON-RPC 2.0 lifecycle methods (`initialize`, `session/new`, `session/prompt`, `session/cancel`, `session/close`).
- Maps incoming ACP user messages into `stream-json` input events.
- Translates `agy` streaming events into real-time ACP `session/update` notifications (message chunks, tool calls, and usage stats).
- Automatically discovers the system `agy` binary (or downloads the official release if missing).

---

## Prerequisites

- [Node.js](https://nodejs.org) (v18 or higher)
- Google Antigravity CLI (`agy`) installed and authenticated, or internet access on first run so the official binary can be downloaded automatically.

---

## Usage

### Run via npx

```bash
npx google-antigravity-acp
```

### Install Globally

```bash
npm install -g google-antigravity-acp
google-antigravity-acp
```

### Install as an OpenClaw plugin

```bash
openclaw plugins install google-antigravity-acp
openclaw config set plugins.entries.google-antigravity-cli.enabled true
```

Then select an Antigravity model and require the plugin-owned runtime:

```json5
{
  agents: {
    entries: {
      fast: {
        model: {
          primary: "google-antigravity-cli/gemini-3.8-flash-low",
          fallbacks: [],
        },
        models: {
          "google-antigravity-cli/gemini-3.8-flash-low": {
            agentRuntime: { id: "google-antigravity-cli" },
          },
        },
      },
    },
  },
}
```

Authentication remains owned by the official `agy` installation. Normal agent
turns use Antigravity's native tools, and their start/result events are surfaced
to OpenClaw.

For OpenClaw runs with an exact tool cap, the backend creates a private
per-run Antigravity home, denies all native file, shell, and web permissions,
passes through only the minimum authentication and conversation state, and
exposes only OpenClaw's host-isolated MCP bridge. Antigravity and the bridge
both enforce the requested OpenClaw tool list. Ambient user/workspace plugins,
skills, hooks, rules, and agents are excluded. Exact-cap runs require
Antigravity CLI 1.1.9 or newer and fail closed when native tools are requested;
unrestricted turns keep the normal native tool behavior and additionally receive
the OpenClaw MCP bridge.

### Client Configuration

Configure your ACP-compatible editor or client to launch `google-antigravity-acp` over stdio:

```json
{
  "command": "npx",
  "args": ["-y", "google-antigravity-acp"]
}
```

---

## CLI Options

```
Usage: google-antigravity-acp [options]

Agent Client Protocol (ACP) server for Google Antigravity

Options:
  -V, --version             output the version number
  -b, --binary-path <path>  Path to custom agy binary
  -m, --model <model>       Default model for agent sessions
  -e, --effort <effort>     Reasoning effort (low, medium, high)
  --no-skip-permissions     Do not auto-approve permissions in agy
  -h, --help                display help for command
```

---

## License

[MIT](LICENSE)
