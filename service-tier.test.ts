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
} from "@earendil-works/pi-coding-agent";

import { initTheme, SessionManager, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import serviceTierExtension from "./service-tier.ts";
import { SERVICE_TIER_SESSION_ENTRY } from "./session-state.ts";
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

function setupExtension(sessionManager = SessionManager.inMemory()): {
  sessionManager: SessionManager;
  commands: Map<string, RegisteredCommand>;
  emitExtensionEvent: (event: string, payload: unknown) => void;
  emitPiEvent: (event: string, payload: unknown, ctx: ExtensionContext) => Promise<unknown[]>;
  extensionEvents: Array<{ event: string; payload: unknown }>;
  notifications: CapturedNotification[];
  context: (model: ExtensionContext["model"]) => ExtensionCommandContext;
} {
  const commands = new Map<string, RegisteredCommand>();
  const handlers = new Map<string, ((event: unknown, ctx: ExtensionContext) => unknown)[]>();
  const eventHandlers = new Map<string, ((payload: unknown) => void)[]>();
  const extensionEvents: Array<{ event: string; payload: unknown }> = [];
  const notifications: CapturedNotification[] = [];

  serviceTierExtension({
    appendEntry(customType: string, data: unknown) {
      sessionManager.appendCustomEntry(customType, data);
    },
    registerCommand(name: string, options: RegisteredCommand) {
      commands.set(name, options);
    },
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
      const entries = handlers.get(event) ?? [];
      entries.push(handler as (event: unknown, ctx: ExtensionContext) => unknown);
      handlers.set(event, entries);
    },
    events: {
      on(event: string, handler: (payload: unknown) => void) {
        const entries = eventHandlers.get(event) ?? [];
        const typedHandler = handler as (payload: unknown) => void;
        entries.push(typedHandler);
        eventHandlers.set(event, entries);
        return () => {
          const index = entries.indexOf(typedHandler);
          if (index >= 0) entries.splice(index, 1);
        };
      },
      emit(event: string, payload: unknown) {
        extensionEvents.push({ event, payload });
        for (const handler of eventHandlers.get(event) ?? []) handler(payload);
      },
    },
  } as unknown as ExtensionAPI);

  return {
    sessionManager,
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
    extensionEvents,
    notifications,
    context(model) {
      return {
        cwd: process.cwd(),
        hasUI: true,
        model,
        sessionManager,
        ui: {
          notify(message: string, type?: CapturedNotification["type"]) {
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

test("fancy footer receives a complete snapshot for an active tier", async () =>
  withAgentDir(async (dir) => {
    writeFileSync(
      join(dir, SERVICE_TIER_CONFIG_FILE),
      JSON.stringify({ anthropic: "priority" }),
    );

    const { extensionEvents, emitPiEvent, context } = setupExtension();
    await emitPiEvent(
      "session_start",
      { type: "session_start" },
      context({
        provider: "anthropic",
        api: "anthropic-messages",
        id: "claude-sonnet-4-5",
      } as ExtensionContext["model"]),
    );

    assert.deepEqual(extensionEvents.at(-1), {
      event: "pi-fancy-footer:widget",
      payload: {
        protocol: 1,
        type: "upsert",
        widget: {
          id: "pi-service-tier.service-tier",
          label: "Service tier",
          description: "Shows a bolt when a provider service tier is active.",
          content: { type: "text", text: "⚡" },
          icon: false,
          layout: {
            row: 1,
            position: 8,
            align: "right",
            fill: "none",
          },
        },
      },
    });
  }));

test("fancy footer keeps an inactive widget configurable with empty text", async () =>
  withAgentDir(async (dir) => {
    writeFileSync(
      join(dir, SERVICE_TIER_CONFIG_FILE),
      JSON.stringify({}),
    );

    const { extensionEvents, emitPiEvent, context } = setupExtension();
    await emitPiEvent(
      "session_start",
      { type: "session_start" },
      context({
        provider: "openai",
        api: "openai-responses",
        id: "gpt-5.5",
      } as ExtensionContext["model"]),
    );

    const message = extensionEvents.at(-1) as {
      event: string;
      payload: { widget: { content: { text: string } } };
    };
    assert.equal(message.event, "pi-fancy-footer:widget");
    assert.equal(message.payload.widget.content.text, "");
  }));

test("fancy footer snapshots republish on ready and are removed on shutdown", async () =>
  withAgentDir(async () => {
    const {
      emitExtensionEvent,
      emitPiEvent,
      extensionEvents,
      context,
    } = setupExtension();
    const initialCount = extensionEvents.length;

    emitExtensionEvent("pi-fancy-footer:ready", {
      protocol: 2,
      version: "2.0.0",
    });
    assert.equal(extensionEvents.length, initialCount);

    emitExtensionEvent("pi-fancy-footer:ready", {
      protocol: 1,
      version: "2.0.0",
    });
    assert.equal(extensionEvents.length, initialCount + 1);
    assert.equal(extensionEvents.at(-1)?.event, "pi-fancy-footer:widget");

    await emitPiEvent("session_shutdown", {}, context(undefined));
    assert.deepEqual(extensionEvents.at(-1), {
      event: "pi-fancy-footer:widget",
      payload: {
        protocol: 1,
        type: "remove",
        id: "pi-service-tier.service-tier",
      },
    });
  }));

const codexModel = {
  provider: "openai-codex",
  api: "openai-codex-responses",
  id: "gpt-5.5-codex",
} as ExtensionContext["model"];
const anthropicModel = {
  provider: "anthropic",
  api: "anthropic-messages",
  id: "claude-sonnet-4-5",
} as ExtensionContext["model"];

type Harness = ReturnType<typeof setupExtension>;

async function toggle(harness: Harness, model = codexModel) {
  await harness.commands.get("fast")!.handler("", harness.context(model));
}

async function request(harness: Harness, model = codexModel) {
  const payload = { model: model?.id };
  const results = await harness.emitPiEvent(
    "before_provider_request", { payload }, harness.context(model),
  );
  return results.at(-1) ?? payload;
}

function footerText(harness: Harness): string {
  const last = harness.extensionEvents.at(-1)!.payload as {
    widget: { content: { text: string } };
  };
  return last.widget.content.text;
}

test("/fast isolates sessions and providers without creating a global file", async () =>
  withAgentDir(async (dir) => {
    const first = setupExtension();
    const second = setupExtension();
    await toggle(first);
    assert.equal(existsSync(join(dir, SERVICE_TIER_CONFIG_FILE)), false);
    assert.deepEqual(await request(first), {
      model: codexModel?.id, service_tier: "priority",
    });
    assert.deepEqual(await request(second), { model: codexModel?.id });
    assert.equal(footerText(first), "⚡");
    assert.equal(footerText(second), "");
    assert.equal(first.notifications.at(-1)?.message,
      "OpenAI Codex service tier for this session: priority");

    await toggle(first, anthropicModel);
    await first.emitPiEvent("model_select", {}, first.context(anthropicModel));
    assert.deepEqual(await request(first, anthropicModel), {
      model: anthropicModel?.id, service_tier: "auto",
    });
    await toggle(first);
    assert.deepEqual(await request(first), { model: codexModel?.id });
    assert.equal(footerText(first), "");
    assert.equal(first.notifications.at(-1)?.message,
      "OpenAI Codex service tier for this session: off");
    await first.emitPiEvent("model_select", {}, first.context(anthropicModel));
    assert.equal(footerText(first), "⚡");
    const entry = first.sessionManager.getLeafEntry();
    assert.equal(entry?.type, "custom");
    if (entry?.type !== "custom") throw new Error("Missing session snapshot");
    assert.equal(entry.customType, SERVICE_TIER_SESSION_ENTRY);
    assert.deepEqual(entry.data, {
      version: 1, overrides: { "openai-codex": "", anthropic: "priority" },
    });
    assert.deepEqual(first.sessionManager.buildSessionContext().messages, []);
  }));

test("explicit off masks global defaults while untouched providers keep inheriting", async () =>
  withAgentDir(async (dir) => {
    const configPath = join(dir, SERVICE_TIER_CONFIG_FILE);
    writeServiceTierConfigSnapshot({ "openai-codex": "priority", anthropic: "standard" });
    const original = readFileSync(configPath, "utf8");
    const first = setupExtension();
    await toggle(first);
    assert.equal(readFileSync(configPath, "utf8"), original);
    assert.deepEqual(await request(first), { model: codexModel?.id });
    const restored = setupExtension(first.sessionManager);
    await restored.emitPiEvent("session_start", { reason: "reload" }, restored.context(codexModel));
    assert.deepEqual(await request(restored), { model: codexModel?.id });
    assert.equal(footerText(restored), "");
    assert.deepEqual(await request(setupExtension()), {
      model: codexModel?.id, service_tier: "priority",
    });

    writeServiceTierConfigSnapshot({ "openai-codex": "flex", anthropic: "priority" });
    assert.deepEqual(await request(first), { model: codexModel?.id });
    assert.deepEqual(await request(first, anthropicModel), {
      model: anthropicModel?.id, service_tier: "auto",
    });
    assert.deepEqual(await request(setupExtension()), {
      model: codexModel?.id, service_tier: "flex",
    });
    await toggle(first);
    assert.deepEqual(await request(first), {
      model: codexModel?.id, service_tier: "priority",
    });
    assert.equal(loadServiceTierConfig()["openai-codex"], "flex");
  }));

test("session restoration survives reload, resume, compaction, forks, and tree navigation", async () =>
  withAgentDir(async (dir) => {
    const sm = SessionManager.create(dir, join(dir, "sessions"));
    const root = sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
    // Pi flushes sessions after an assistant response; use a real persisted session.
    sm.appendMessage({
      role: "assistant", content: [], api: "openai-codex-responses",
      provider: "openai-codex", model: "gpt-5.5-codex", stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      timestamp: Date.now(),
    });
    const original = setupExtension(sm);
    await toggle(original);
    const on = sm.getLeafId()!;
    await toggle(original);
    const off = sm.getLeafId()!;

    const reopened = SessionManager.open(sm.getSessionFile()!);
    const resumed = setupExtension(reopened);
    await resumed.emitPiEvent("session_start", { reason: "resume" }, resumed.context(codexModel));
    assert.deepEqual(await request(resumed), { model: codexModel?.id });
    await toggle(resumed);
    assert.deepEqual(await request(resumed), { model: codexModel?.id, service_tier: "priority" });

    sm.branch(on);
    await original.emitPiEvent("session_tree", {}, original.context(codexModel));
    assert.equal(footerText(original), "⚡");
    assert.deepEqual(await request(original), { model: codexModel?.id, service_tier: "priority" });
    sm.appendCompaction("summary", root, 100);
    const reloaded = setupExtension(sm);
    await reloaded.emitPiEvent("session_start", { reason: "reload" }, reloaded.context(codexModel));
    assert.equal(footerText(reloaded), "⚡");

    const forkPath = sm.createBranchedSession(on)!;
    const forked = setupExtension(SessionManager.open(forkPath));
    await forked.emitPiEvent("session_start", { reason: "fork" }, forked.context(codexModel));
    assert.equal(footerText(forked), "⚡");
    await toggle(forked);
    assert.deepEqual(await request(reloaded), { model: codexModel?.id, service_tier: "priority" });

    // Use the reopened original because createBranchedSession switches its manager.
    reopened.branch(off);
    await resumed.emitPiEvent("session_tree", {}, resumed.context(codexModel));
    assert.equal(footerText(resumed), "");
    reopened.branch(root);
    await resumed.emitPiEvent("session_tree", {}, resumed.context(codexModel));
    await toggle(resumed);
    assert.equal(footerText(resumed), "⚡");

    const fresh = setupExtension();
    await fresh.emitPiEvent("session_start", { reason: "new" }, fresh.context(codexModel));
    assert.deepEqual(await request(fresh), { model: codexModel?.id });
  }));

test("unsupported models and invalid global configuration do not persist overrides", async () =>
  withAgentDir(async (dir) => {
    const harness = setupExtension();
    for (const model of [undefined, { provider: "openrouter", api: "openai-responses" },
      { provider: "openai", api: "openai-completions" }]) {
      await harness.commands.get("fast")!.handler("", harness.context(model as ExtensionContext["model"]));
      assert.equal(harness.notifications.at(-1)?.type, "warning");
    }
    assert.deepEqual(harness.sessionManager.getEntries(), []);
    const configPath = join(dir, SERVICE_TIER_CONFIG_FILE);
    writeFileSync(configPath, '{"serviceTier":"priority"}');
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await toggle(harness);
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(harness.notifications.at(-1)?.type, "error");
    assert.deepEqual(harness.sessionManager.getEntries(), []);
    assert.equal(readFileSync(configPath, "utf8"), '{"serviceTier":"priority"}');
  }));

test("failed session persistence does not activate fast mode", async () =>
  withAgentDir(async () => {
    const harness = setupExtension();
    harness.sessionManager.appendCustomEntry = () => { throw new Error("disk full"); };
    await toggle(harness);
    assert.equal(harness.notifications.at(-1)?.type, "error");
    assert.match(harness.notifications.at(-1)?.message ?? "", /disk full/);
    assert.deepEqual(await request(harness), { model: codexModel?.id });
  }));

test("/service-tier edits global defaults without overwriting session overrides", async () =>
  withAgentDir(async () => {
    initTheme("dark");
    const harness = setupExtension();
    await toggle(harness); // Session priority; global still off.
    const ctx = harness.context(codexModel);
    let closed = false;
    ctx.ui.custom = async (factory) => {
      const component = await factory(
        { requestRender() {} } as TUI,
        { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme,
        {} as KeybindingsManager,
        () => { closed = true; },
      );
      assert.match(component.render(100).join("\n"), /Global service tier defaults/);
      component.handleInput!(" "); // Global off -> flex, not session priority -> off.
      component.handleInput!("\x1b");
      return undefined as never;
    };
    await harness.commands.get("service-tier")!.handler("", ctx);
    assert.equal(closed, true);
    assert.deepEqual(loadServiceTierConfig(), { "openai-codex": "flex" });
    assert.deepEqual(await request(harness), { model: codexModel?.id, service_tier: "priority" });
    assert.equal(footerText(harness), "⚡");
    assert.deepEqual(await request(setupExtension()), { model: codexModel?.id, service_tier: "flex" });
    assert.equal(harness.sessionManager.getEntries().length, 1);
  }));
