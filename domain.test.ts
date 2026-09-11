import assert from "node:assert/strict";
import test from "node:test";
import {
  setProviderServiceTier,
  toggleFastServiceTier,
} from "./domain.ts";

const model = { provider: "openai", api: "openai-responses" };

test("fast decisions do not mutate or carry a storage snapshot", () => {
  const settings = Object.freeze({ openai: "flex", anthropic: "standard" } as const);
  assert.deepEqual(toggleFastServiceTier(settings, model), {
    provider: "openai",
    serviceTier: "priority",
    fast: true,
  });
  assert.deepEqual(settings, { openai: "flex", anthropic: "standard" });
});

test("global updates omit off and preserve other providers without mutation", () => {
  const settings = Object.freeze({ openai: "priority", anthropic: "standard" } as const);
  assert.deepEqual(setProviderServiceTier(settings, "openai", ""), {
    anthropic: "standard",
  });
  assert.equal(settings.openai, "priority");
});
