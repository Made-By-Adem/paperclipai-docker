# Plugin Authoring Smoke Example

A AgentsAI plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

## Install Into AgentsAI

```bash
pnpm agentsai plugin install ./
```

## Build Options

- `pnpm build` uses esbuild presets from `@agentsai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
