import assert from "node:assert/strict";
import test from "node:test";
import { createEventBus, SessionManager } from "@earendil-works/pi-coding-agent";
import { createAgentHooks, registerAgentHooks } from "./agent-hooks.ts";
import type { ServiceTierConfigSnapshot } from "./domain.ts";
import { SERVICE_TIER_SESSION_ENTRY } from "./session-state.ts";

const codex = { provider: "openai-codex", api: "openai-codex-responses" };
const anthropic = { provider: "anthropic", api: "anthropic-messages" };

test("agent snapshots use the supplied branch and stay fixed across changes", () => {
  let defaults: ServiceTierConfigSnapshot = { "openai-codex": "priority", anthropic: "priority" };
  const hooks = createAgentHooks(() => defaults);
  const parent = SessionManager.inMemory();
  parent.appendCustomEntry(SERVICE_TIER_SESSION_ENTRY, {
    version: 1, overrides: { "openai-codex": "" },
  });
  const state = hooks.onAgentCreate({ parent: { branch: parent.getBranch() } });
  assert.equal(hooks.onAgentRequest({ state, model: codex }, {}), undefined);
  assert.deepEqual(hooks.onAgentRequest({ state, model: anthropic }, {}), { service_tier: "auto" });
  parent.appendCustomEntry(SERVICE_TIER_SESSION_ENTRY, {
    version: 1, overrides: { "openai-codex": "flex" },
  });
  const next = hooks.onAgentCreate({ parent: { branch: parent.getBranch() } });
  assert.deepEqual(hooks.onAgentRequest({ state: next, model: codex }, {}), { service_tier: "flex" });
  defaults = {};
  // The old snapshot remains authoritative, even with a newly loaded adapter.
  const resumed = createAgentHooks(() => defaults);
  assert.deepEqual(resumed.onAgentRequest({ state: JSON.parse(JSON.stringify(state)), model: anthropic }, {}), { service_tier: "auto" });
  assert.equal(resumed.onAgentRequest({ state, model: codex }, {}), undefined);
  assert.equal(resumed.onAgentRequest({ state, model: { provider: "other", api: "anthropic-messages" } }, {}), undefined);
});

test("undefined state passes through; unknown versions and malformed state fail", () => {
  const hooks = createAgentHooks(() => ({}));
  assert.equal(hooks.onAgentRequest({ state: undefined, model: codex }, {}), undefined);
  for (const state of [{ version: 2, settings: {} }, { version: 1 }, { version: 1, settings: { anthropic: 1 } }]) {
    assert.throws(() => hooks.onAgentRequest({ state, model: codex }, {}));
  }
});

test("version 1 snapshots from newer versions apply what this version knows", () => {
  const hooks = createAgentHooks(() => ({}));
  const state = {
    version: 1,
    settings: { "future-provider": "turbo", anthropic: "turbo", "openai-codex": "priority" },
  };
  assert.deepEqual(hooks.onAgentRequest({ state, model: codex }, {}), { service_tier: "priority" });
  assert.equal(hooks.onAgentRequest({ state, model: anthropic }, {}), undefined);
});

test("optional discovery is synchronous and independent of session_start", () => {
  const events = createEventBus();
  registerAgentHooks(events, () => ({ "openai-codex": "priority" }));
  const discovered: ReturnType<typeof createAgentHooks>[] = [];
  const register = (hooks: ReturnType<typeof createAgentHooks>) => discovered.push(hooks);
  events.emit("pi-agents:hooks:discover", { protocol: 2, register });
  events.emit("pi-agents:hooks:discover", null);
  assert.equal(discovered.length, 0);
  events.emit("pi-agents:hooks:discover", { protocol: 1, register });
  assert.equal(discovered.length, 1);
  const hooks = discovered[0];
  const state = hooks.onAgentCreate({ parent: { branch: [] } });
  assert.deepEqual(hooks.onAgentRequest({ state, model: codex }, {}), { service_tier: "priority" });
});
