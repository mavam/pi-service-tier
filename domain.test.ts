import assert from "node:assert/strict";
import test from "node:test";
import {
  setProviderServiceTier,
  toggleServiceTierSpeed,
} from "./domain.ts";

const model = { provider: "openai", api: "openai-responses" };

test("fast and ultrafast select one tier and toggle the active tier off", () => {
  const cases = [
    { current: "", speed: "ultrafast", next: "ultrafast" },
    { current: "flex", speed: "ultrafast", next: "ultrafast" },
    { current: "priority", speed: "ultrafast", next: "ultrafast" },
    { current: "ultrafast", speed: "ultrafast", next: "" },
    { current: "ultrafast", speed: "fast", next: "priority" },
  ] as const;
  for (const { current, speed, next } of cases) {
    assert.deepEqual(toggleServiceTierSpeed({ openai: current }, model, speed), {
      provider: "openai", serviceTier: next, enabled: next !== "",
    });
  }
});

test("speed toggles leave settings unchanged", () => {
  const settings = Object.freeze({ openai: "flex", anthropic: "standard" } as const);
  assert.deepEqual(toggleServiceTierSpeed(settings, model), {
    provider: "openai",
    serviceTier: "priority",
    enabled: true,
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
