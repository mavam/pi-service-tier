import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  applyServiceTierToPayload,
  isRecord,
  isServiceTierName,
  isServiceTierProvider,
  type ServiceTierConfigSnapshot,
  type ServiceTierModel,
  type ServiceTierProvider,
  type ServiceTierSelection,
  type ServiceTierSettings,
} from "./domain.ts";
import {
  mergeServiceTierSettings,
  restoreServiceTierOverrides,
} from "./session-state.ts";

/** Structural implementation of pi-agents/hooks protocol 1; no dependency. */
export function createAgentHooks(loadDefaults: () => ServiceTierConfigSnapshot) {
  return {
    namespace: "pi-service-tier",
    onAgentCreate(ctx: { parent: { branch: readonly SessionEntry[] } }) {
      return {
        version: 1,
        settings: mergeServiceTierSettings(
          loadDefaults(),
          restoreServiceTierOverrides(ctx.parent.branch),
        ),
      };
    },
    onAgentRequest(
      ctx: { state: unknown; model: ServiceTierModel },
      payload: unknown,
    ) {
      if (ctx.state === undefined) return undefined;
      return applyServiceTierToPayload(payload, readSettings(ctx.state), ctx.model);
    },
  };
}

/**
 * Stored settings are authoritative; never merge today's defaults on resume.
 * Snapshots never change, so read every version 1 snapshot, also one a newer
 * version wrote: providers and tiers this version doesn't know apply nothing.
 */
function readSettings(state: unknown): ServiceTierSettings {
  if (!isRecord(state) || state.version !== 1 || !isRecord(state.settings)) {
    throw new Error("Unsupported or invalid pi-service-tier agent state");
  }
  const settings: Partial<Record<ServiceTierProvider, ServiceTierSelection>> = {};
  for (const [provider, value] of Object.entries(state.settings)) {
    if (typeof value !== "string") {
      throw new Error("Invalid service tier in pi-service-tier agent state");
    }
    if (!isServiceTierProvider(provider)) continue;
    // An empty value explicitly disables injection and must survive too.
    if (value === "" || isServiceTierName(provider, value)) {
      settings[provider] = value;
    }
  }
  return settings;
}

export function registerAgentHooks(
  events: ExtensionAPI["events"],
  loadDefaults: () => ServiceTierConfigSnapshot,
): void {
  const hooks = createAgentHooks(loadDefaults);
  events.on("pi-agents:hooks:discover", (request) => {
    if (!isRecord(request) || request.protocol !== 1 || typeof request.register !== "function") {
      return;
    }
    request.register(hooks);
  });
}
