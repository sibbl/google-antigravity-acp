# google-antigravity-acp

An [Agent Client Protocol (ACP)](https://agentclientprotocol.com) server for Google Antigravity.

This project enables any ACP-compatible client (such as Zed, OpenClaw, Neovim, and other developer tools) to communicate with Google Antigravity using standard JSON-RPC 2.0 over `stdio`.

This package focuses on the ACP server and JSONL command-line adapter. The
OpenClaw native CLI backend is maintained separately in
[google-antigravity-openclaw-plugin](https://github.com/sibbl/google-antigravity-openclaw-plugin)
so its Plugin SDK and host compatibility can track OpenClaw releases without
coupling ACP users to that release cycle.

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

### OpenClaw backend

```bash
openclaw plugins install google-antigravity-openclaw-plugin
openclaw config set plugins.entries.google-antigravity-cli.enabled true
```

The separate plugin depends on this package for its runtime executable. It
also contains the OpenClaw-specific model catalog, SDK integration, and exact
tool-cap enforcement.

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
