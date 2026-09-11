import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  SERVICE_TIER_SESSION_ENTRY,
  mergeServiceTierSettings,
  restoreServiceTierOverrides,
} from "./session-state.ts";

test("merging preserves explicit off without changing either layer", () => {
  const defaults = Object.freeze({ openai: "priority", anthropic: "standard" } as const);
  const overrides = Object.freeze({ openai: "", google: "priority" } as const);
  assert.deepEqual(mergeServiceTierSettings(defaults, overrides), {
    openai: "", anthropic: "standard", google: "priority",
  });
  assert.equal(defaults.openai, "priority");
  assert.deepEqual(overrides, { openai: "", google: "priority" });
});

test("restoration uses the latest valid snapshot on the active branch", () => {
  const sm = SessionManager.inMemory();
  assert.deepEqual(restoreServiceTierOverrides(sm.getBranch()), {});
  const on = sm.appendCustomEntry(SERVICE_TIER_SESSION_ENTRY, {
    version: 1, overrides: { openai: "priority", anthropic: "standard" },
  });
  const off = sm.appendCustomEntry(SERVICE_TIER_SESSION_ENTRY, {
    version: 1, overrides: { openai: "" },
  });
  assert.deepEqual(restoreServiceTierOverrides(sm.getBranch()), { openai: "" });
  sm.branch(on);
  assert.deepEqual(restoreServiceTierOverrides(sm.getBranch()), {
    openai: "priority", anthropic: "standard",
  });
  sm.branch(off);
  sm.appendCustomEntry(SERVICE_TIER_SESSION_ENTRY, { version: 1, overrides: {} });
  assert.deepEqual(restoreServiceTierOverrides(sm.getBranch()), {});
});

test("malformed or future session entries cannot replace a valid override", () => {
  const sm = SessionManager.inMemory();
  sm.appendCustomEntry(SERVICE_TIER_SESSION_ENTRY, { version: 1, overrides: { openai: "" } });
  for (const data of [
    undefined, null, [], {}, { version: 2, overrides: { openai: "priority" } },
    { version: 1, overrides: null }, { version: 1, overrides: [] },
    { version: 1, overrides: { unknown: "priority" } },
    { version: 1, overrides: { openai: "standard" } },
    { version: 1, overrides: { anthropic: "auto" } },
    { version: 1, overrides: { openai: undefined } },
    { version: 1, overrides: { openai: null } },
  ]) {
    sm.appendCustomEntry(SERVICE_TIER_SESSION_ENTRY, data);
    assert.deepEqual(restoreServiceTierOverrides(sm.getBranch()), { openai: "" });
  }
  sm.appendCustomEntry("another-extension", { version: 1, overrides: { openai: "priority" } });
  assert.deepEqual(restoreServiceTierOverrides(sm.getBranch()), { openai: "" });
});
