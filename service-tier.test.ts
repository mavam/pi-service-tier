import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  RegisteredCommand,
} from "@mariozechner/pi-coding-agent";

import serviceTierExtension from "./service-tier.ts";
import {
  DEFAULT_SERVICE_TIER_CONFIG,
  SERVICE_TIER_CONFIG_FILE,
  applyServiceTierToPayload,
  createServiceTierSections,
  getServiceTierConfigPath,
  loadServiceTierConfig,
  modelSupportsServiceTier,
  parseServiceTierConfigValue,
  resolveEffectiveServiceTier,
  toggleFastServiceTier,
  writeServiceTierConfigSnapshot,
} from "./shared.ts";

interface CapturedNotification {
  message: string;
  type?: "info" | "warning" | "error";
}

async function withAgentDir<T>(
  fn: (dir: string) => T | Promise<T>,
): Promise<T> {
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const dir = mkdtempSync(join(tmpdir(), "pi-service-tier-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return await fn(dir);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

function setupExtension(): {
  commands: Map<string, RegisteredCommand>;
  emitExtensionEvent: (event: string, payload: unknown) => void;
  emitPiEvent: (event: string, payload: unknown, ctx: ExtensionContext) => Promise<unknown[]>;
  notifications: CapturedNotification[];
  context: (model: ExtensionContext["model"]) => ExtensionCommandContext;
} {
  const commands = new Map<string, RegisteredCommand>();
  const handlers = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
  const eventHandlers = new Map<string, ((payload: unknown) => void)[]>();
  const notifications: CapturedNotification[] = [];

  serviceTierExtension({
    registerCommand(name, options) {
      commands.set(name, options as RegisteredCommand);
    },
    on(event, handler) {
      const entries = handlers.get(event) ?? [];
      entries.push(handler as (event: unknown, ctx: ExtensionContext) => unknown);
      handlers.set(event, entries);
    },
    events: {
      on(event, handler) {
        const entries = eventHandlers.get(event) ?? [];
        entries.push(handler as (payload: unknown) => void);
        eventHandlers.set(event, entries);
      },
      emit(event, payload) {
        for (const handler of eventHandlers.get(event) ?? []) handler(payload);
      },
    },
  } as unknown as ExtensionAPI);

  return {
    commands,
    emitExtensionEvent(event, payload) {
      for (const handler of eventHandlers.get(event) ?? []) handler(payload);
    },
    async emitPiEvent(event, payload, ctx) {
      const results = [];
      for (const handler of handlers.get(event) ?? []) {
        results.push(await handler(payload, ctx));
      }
      return results;
    },
    notifications,
    context(model) {
      return {
        cwd: process.cwd(),
        hasUI: true,
        model,
        ui: {
          notify(message, type) {
            notifications.push({ message, type });
          },
          custom: async () => undefined,
        },
      } as unknown as ExtensionCommandContext;
    },
  };
}

test("parseServiceTierConfigValue accepts current provider keys and tiers", () => {
  assert.deepEqual(parseServiceTierConfigValue("config", undefined), {
    ...DEFAULT_SERVICE_TIER_CONFIG,
  });
  assert.deepEqual(parseServiceTierConfigValue("config", {}), {});
  assert.deepEqual(
    parseServiceTierConfigValue("config", {
      openai: "priority",
      "openai-codex": "flex",
      anthropic: "priority",
      google: "priority",
      "google-vertex": "flex",
    }),
    {
      openai: "priority",
      "openai-codex": "flex",
      anthropic: "priority",
      google: "priority",
      "google-vertex": "flex",
    },
  );
  assert.deepEqual(
    parseServiceTierConfigValue("config", {
      anthropic: "standard",
    }),
    { anthropic: "standard" },
  );
});

test("parseServiceTierConfigValue rejects unknown settings and invalid tiers", () => {
  assert.throws(
    () => parseServiceTierConfigValue("config", { serviceTier: "priority" }),
    /unknown setting "serviceTier"/,
  );
  assert.throws(
    () => parseServiceTierConfigValue("config", { anthropic: "batch" }),
    /Invalid config:/,
  );
  assert.throws(
    () => parseServiceTierConfigValue("config", { anthropic: "auto" }),
    /Invalid config:/,
  );
  assert.throws(
    () => parseServiceTierConfigValue("config", { anthropic: "standard_only" }),
    /Invalid config:/,
  );
  assert.throws(
    () => parseServiceTierConfigValue("config", { openai: "auto" }),
    /Invalid config:/,
  );
  assert.throws(
    () => parseServiceTierConfigValue("config", { openai: "default" }),
    /Invalid config:/,
  );
  assert.throws(
    () => parseServiceTierConfigValue("config", { openai: "" }),
    /Invalid config:/,
  );
  assert.throws(
    () => parseServiceTierConfigValue("config", { google: "standard" }),
    /Invalid config:/,
  );
  assert.throws(
    () => parseServiceTierConfigValue("config", ["not", "an", "object"]),
    /Invalid config:/,
  );
});

test("loadServiceTierConfig reads and writes service-tier.json", () =>
  withAgentDir((dir) => {
    const configPath = join(dir, SERVICE_TIER_CONFIG_FILE);
    writeFileSync(
      configPath,
      JSON.stringify({ openai: "priority", anthropic: "priority", google: "flex" }),
    );

    assert.equal(getServiceTierConfigPath(dir), configPath);
    assert.deepEqual(loadServiceTierConfig(configPath), {
      openai: "priority",
      anthropic: "priority",
      google: "flex",
    });

    writeServiceTierConfigSnapshot(
      { "openai-codex": "priority", "google-vertex": "flex" },
      configPath,
    );
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")), {
      "openai-codex": "priority",
      "google-vertex": "flex",
    });
  }));

test("resolveEffectiveServiceTier only enables matching built-in providers", () => {
  const config = {
    openai: "priority",
    "openai-codex": "flex",
    anthropic: "priority",
    google: "priority",
    "google-vertex": "flex",
  } as const;

  assert.equal(
    resolveEffectiveServiceTier(config, {
      provider: "openai",
      api: "openai-responses",
    }),
    "priority",
  );
  assert.equal(
    resolveEffectiveServiceTier(config, {
      provider: "openai-codex",
      api: "openai-codex-responses",
    }),
    "flex",
  );
  assert.equal(
    resolveEffectiveServiceTier(config, {
      provider: "anthropic",
      api: "anthropic-messages",
    }),
    "priority",
  );
  assert.equal(
    resolveEffectiveServiceTier(config, {
      provider: "google",
      api: "google-generative-ai",
    }),
    "priority",
  );
  assert.equal(
    resolveEffectiveServiceTier(config, {
      provider: "google-vertex",
      api: "google-vertex",
    }),
    "flex",
  );
  assert.equal(
    resolveEffectiveServiceTier(config, {
      provider: "openai",
      api: "openai-completions",
    }),
    "",
  );
  assert.equal(
    resolveEffectiveServiceTier(config, {
      provider: "openrouter",
      api: "openai-responses",
    }),
    "",
  );

  assert.equal(
    modelSupportsServiceTier({ provider: "openai", api: "openai-responses" }),
    true,
  );
  assert.equal(
    modelSupportsServiceTier({ provider: "openai", api: "anthropic-messages" }),
    false,
  );
  assert.equal(
    modelSupportsServiceTier({
      provider: "google",
      api: "google-generative-ai",
    }),
    true,
  );
});

test("applyServiceTierToPayload injects provider-specific service tier values", () => {
  const config = {
    openai: "priority",
    "openai-codex": "flex",
    anthropic: "priority",
    google: "priority",
    "google-vertex": "flex",
  } as const;

  assert.deepEqual(
    applyServiceTierToPayload(
      { model: "gpt-5.5", stream: true },
      config,
      { provider: "openai", api: "openai-responses" },
    ),
    { model: "gpt-5.5", stream: true, service_tier: "priority" },
  );
  assert.deepEqual(
    applyServiceTierToPayload(
      { model: "gpt-5.5-codex" },
      config,
      { provider: "openai-codex", api: "openai-codex-responses" },
    ),
    { model: "gpt-5.5-codex", service_tier: "flex" },
  );
  assert.deepEqual(
    applyServiceTierToPayload(
      { model: "claude-sonnet-4-5" },
      config,
      { provider: "anthropic", api: "anthropic-messages" },
    ),
    { model: "claude-sonnet-4-5", service_tier: "auto" },
  );
  assert.deepEqual(
    applyServiceTierToPayload(
      { model: "claude-sonnet-4-5" },
      { anthropic: "standard" },
      { provider: "anthropic", api: "anthropic-messages" },
    ),
    { model: "claude-sonnet-4-5", service_tier: "standard_only" },
  );
  assert.deepEqual(
    applyServiceTierToPayload(
      { model: "gemini-3-pro", config: { temperature: 0.2 } },
      config,
      { provider: "google", api: "google-generative-ai" },
    ),
    {
      model: "gemini-3-pro",
      config: { temperature: 0.2, serviceTier: "priority" },
    },
  );
  assert.deepEqual(
    applyServiceTierToPayload(
      { model: "gemini-3-pro" },
      config,
      { provider: "google-vertex", api: "google-vertex" },
    ),
    {
      model: "gemini-3-pro",
      config: { serviceTier: "flex" },
    },
  );
  assert.equal(
    applyServiceTierToPayload(
      { model: "gpt-5.5" },
      {},
      { provider: "openai", api: "openai-responses" },
    ),
    undefined,
  );
  assert.equal(
    applyServiceTierToPayload(
      { model: "gpt-5.5" },
      config,
      { provider: "openrouter", api: "openai-responses" },
    ),
    undefined,
  );
  assert.equal(
    applyServiceTierToPayload(
      ["not", "a", "payload"],
      config,
      { provider: "openai", api: "openai-responses" },
    ),
    undefined,
  );
});

test("toggleFastServiceTier maps providers to fast and off", () => {
  assert.deepEqual(
    toggleFastServiceTier({}, { provider: "openai", api: "openai-responses" }),
    {
      config: { openai: "priority" },
      provider: "openai",
      serviceTier: "priority",
      fast: true,
    },
  );
  assert.deepEqual(
    toggleFastServiceTier(
      { openai: "priority" },
      { provider: "openai", api: "openai-responses" },
    ),
    {
      config: {},
      provider: "openai",
      serviceTier: "",
      fast: false,
    },
  );
  assert.deepEqual(
    toggleFastServiceTier(
      {},
      { provider: "anthropic", api: "anthropic-messages" },
    ),
    {
      config: { anthropic: "priority" },
      provider: "anthropic",
      serviceTier: "priority",
      fast: true,
    },
  );
  assert.deepEqual(
    toggleFastServiceTier(
      {},
      { provider: "google", api: "google-generative-ai" },
    ),
    {
      config: { google: "priority" },
      provider: "google",
      serviceTier: "priority",
      fast: true,
    },
  );
  assert.equal(
    toggleFastServiceTier({}, { provider: "openrouter", api: "openai-responses" }),
    undefined,
  );
});

test("/fast persists fast mode or removes the current provider", async () =>
  withAgentDir(async (dir) => {
    const { commands, notifications, context } = setupExtension();
    const fastCommand = commands.get("fast");
    if (!fastCommand) throw new Error("/fast command was not registered");

    await fastCommand.handler(
      "",
      context({
        provider: "openai-codex",
        api: "openai-codex-responses",
        id: "gpt-5.5-codex",
      } as ExtensionContext["model"]),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, SERVICE_TIER_CONFIG_FILE), "utf8")),
      { "openai-codex": "priority" },
    );
    assert.equal(
      notifications.at(-1)?.message,
      "OpenAI Codex service tier: priority",
    );

    await fastCommand.handler(
      "",
      context({
        provider: "openai-codex",
        api: "openai-codex-responses",
        id: "gpt-5.5-codex",
      } as ExtensionContext["model"]),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, SERVICE_TIER_CONFIG_FILE), "utf8")),
      {},
    );
    assert.equal(
      notifications.at(-1)?.message,
      "OpenAI Codex service tier: off",
    );

    rmSync(join(dir, SERVICE_TIER_CONFIG_FILE), { force: true });
    await fastCommand.handler(
      "",
      context({
        provider: "openrouter",
        api: "openai-responses",
        id: "openai/gpt-5.5",
      } as ExtensionContext["model"]),
    );
    assert.equal(existsSync(join(dir, SERVICE_TIER_CONFIG_FILE)), false);
    assert.equal(notifications.at(-1)?.type, "warning");
    assert.match(notifications.at(-1)?.message ?? "", /not supported/);

    await fastCommand.handler(
      "",
      context({
        provider: "anthropic",
        api: "anthropic-messages",
        id: "claude-sonnet-4-5",
      } as ExtensionContext["model"]),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, SERVICE_TIER_CONFIG_FILE), "utf8")),
      { anthropic: "priority" },
    );
    assert.equal(notifications.at(-1)?.message, "Anthropic service tier: priority");

    await fastCommand.handler(
      "",
      context({
        provider: "anthropic",
        api: "anthropic-messages",
        id: "claude-sonnet-4-5",
      } as ExtensionContext["model"]),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, SERVICE_TIER_CONFIG_FILE), "utf8")),
      {},
    );
    assert.equal(notifications.at(-1)?.message, "Anthropic service tier: off");

    await fastCommand.handler(
      "",
      context({
        provider: "google",
        api: "google-generative-ai",
        id: "gemini-3-pro",
      } as ExtensionContext["model"]),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, SERVICE_TIER_CONFIG_FILE), "utf8")),
      { google: "priority" },
    );
    assert.equal(
      notifications.at(-1)?.message,
      "Google Gemini service tier: priority",
    );

    writeFileSync(
      join(dir, SERVICE_TIER_CONFIG_FILE),
      JSON.stringify({ serviceTier: "priority" }),
    );
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await fastCommand.handler(
        "",
        context({
          provider: "openai",
          api: "openai-responses",
          id: "gpt-5.5",
        } as ExtensionContext["model"]),
      );
    } finally {
      console.warn = originalWarn;
    }
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, SERVICE_TIER_CONFIG_FILE), "utf8")),
      { serviceTier: "priority" },
    );
    assert.equal(notifications.at(-1)?.type, "error");
    assert.match(notifications.at(-1)?.message ?? "", /Invalid service tier config/);
  }));

test("createServiceTierSections puts the current model first with provider-specific options", () => {
  const sections = createServiceTierSections(
    { openai: "priority", anthropic: "priority", google: "flex" },
    {
      provider: "anthropic",
      api: "anthropic-messages",
      id: "claude-sonnet-4-5",
      name: "Claude Sonnet 4.5",
    },
  );

  assert.equal(sections[0]?.id, "current");
  assert.equal(sections[0]?.items[0]?.id, "anthropic");
  assert.equal(sections[0]?.items[0]?.currentValue, "priority");
  assert.deepEqual(sections[0]?.items[0]?.values, [
    "off",
    "priority",
    "standard",
  ]);
  assert.equal(sections[1]?.id, "providers");
  assert.deepEqual(
    sections[1]?.items.find((item) => item.id === "openai")?.values,
    ["off", "flex", "priority"],
  );
  assert.deepEqual(
    sections[1]?.items.find((item) => item.id === "openai-codex")?.values,
    ["off", "flex", "priority"],
  );
  assert.deepEqual(
    sections[1]?.items.find((item) => item.id === "google")?.values,
    ["off", "flex", "priority"],
  );
  assert.equal(
    sections[1]?.items.find((item) => item.id === "google")?.currentValue,
    "flex",
  );
});

test("fancy footer widget renders the active tier name without markup", async () =>
  withAgentDir(async (dir) => {
    writeFileSync(
      join(dir, SERVICE_TIER_CONFIG_FILE),
      JSON.stringify({ anthropic: "priority" }),
    );

    const { emitExtensionEvent, emitPiEvent, context } = setupExtension();
    await emitPiEvent(
      "session_start",
      { type: "session_start" },
      context({
        provider: "anthropic",
        api: "anthropic-messages",
        id: "claude-sonnet-4-5",
      } as ExtensionContext["model"]),
    );

    const widgets: Array<{
      id: string;
      styled?: boolean;
      visible?: (ctx: unknown) => boolean;
      renderText: (ctx: unknown) => string;
    }> = [];
    emitExtensionEvent("pi-fancy-footer:discover-widgets", {
      registerWidget(widget: (typeof widgets)[number]) {
        widgets.push(widget);
      },
    });

    const widget = widgets.find(
      (entry) => entry.id === "pi-service-tier.service-tier",
    );
    assert.equal(widget?.styled, undefined);
    assert.equal(widget?.visible?.({}), true);
    assert.equal(widget?.renderText({}), "priority");
  }));

test("fancy footer widget is hidden when the current provider is off", async () =>
  withAgentDir(async (dir) => {
    writeFileSync(
      join(dir, SERVICE_TIER_CONFIG_FILE),
      JSON.stringify({}),
    );

    const { emitExtensionEvent, emitPiEvent, context } = setupExtension();
    await emitPiEvent(
      "session_start",
      { type: "session_start" },
      context({
        provider: "openai",
        api: "openai-responses",
        id: "gpt-5.5",
      } as ExtensionContext["model"]),
    );

    const widgets: Array<{
      id: string;
      visible?: (ctx: unknown) => boolean;
      renderText: (ctx: unknown) => string;
    }> = [];
    emitExtensionEvent("pi-fancy-footer:discover-widgets", {
      registerWidget(widget: (typeof widgets)[number]) {
        widgets.push(widget);
      },
    });

    const widget = widgets.find(
      (entry) => entry.id === "pi-service-tier.service-tier",
    );
    assert.equal(widget?.visible?.({}), false);
    assert.equal(widget?.renderText({}), "");
  }));
