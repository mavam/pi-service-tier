import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { parseServiceTierConfigValue } from "./config.ts";
import {
  applyServiceTierToPayload,
  isRecord,
  isServiceTierProvider,
  type ServiceTierConfigSnapshot,
  type ServiceTierModel,
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

/** Stored settings are authoritative; never merge today's defaults on resume. */
function readSettings(state: unknown): ServiceTierSettings {
  if (!isRecord(state) || state.version !== 1 || !isRecord(state.settings)) {
    throw new Error("Unsupported or invalid pi-service-tier agent state");
  }
  const entries = Object.entries(state.settings);
  if (entries.some(([key]) => !isServiceTierProvider(key))) {
    throw new Error("Unknown provider in pi-service-tier agent state");
  }
  // The global schema validates non-empty values. Empty values explicitly
  // disable injection and must survive the snapshot too.
  parseServiceTierConfigValue(
    "pi-service-tier agent state",
    Object.fromEntries(entries.filter(([, value]) => value !== "")),
  );
  return state.settings as ServiceTierSettings;
}

export function registerAgentHooks(
  events: ExtensionAPI["events"],
  loadDefaults: () => ServiceTierConfigSnapshot,
): () => void {
  const hooks = createAgentHooks(loadDefaults);
  return events.on("pi-agents:hooks:discover", (request) => {
    if (!isRecord(request) || request.protocol !== 1 || typeof request.register !== "function") {
      return;
    }
    request.register(hooks);
  });
}
