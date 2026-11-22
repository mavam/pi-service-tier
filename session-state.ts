import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  SERVICE_TIER_PROVIDER_DEFINITIONS,
  isRecord,
  isServiceTierProvider,
  type ServiceTierConfigSnapshot,
  type ServiceTierSettings,
} from "./domain.ts";

export const SERVICE_TIER_SESSION_ENTRY = "pi-service-tier";

/** Missing means inherit the global default; an empty string explicitly disables it. */
export type SessionServiceTierOverrides = ServiceTierSettings;

export interface ServiceTierSessionState {
  version: 1;
  overrides: SessionServiceTierOverrides;
}

export function mergeServiceTierSettings(
  defaults: ServiceTierConfigSnapshot,
  overrides: SessionServiceTierOverrides,
): ServiceTierSettings {
  return { ...defaults, ...overrides };
}

function parseSessionState(data: unknown): ServiceTierSessionState | undefined {
  if (!isRecord(data) || data.version !== 1 || !isRecord(data.overrides)) {
    return undefined;
  }
  for (const [provider, value] of Object.entries(data.overrides)) {
    if (!isServiceTierProvider(provider)) return undefined;
    if (
      value !== "" &&
      !SERVICE_TIER_PROVIDER_DEFINITIONS[provider].tiers.some(
        (tier) => tier.name === value,
      )
    ) {
      return undefined;
    }
  }
  return {
    version: 1,
    overrides: { ...data.overrides } as SessionServiceTierOverrides,
  };
}

/** Read the full active branch, not compacted context or abandoned branches. */
export function restoreServiceTierOverrides(
  branch: readonly SessionEntry[],
): SessionServiceTierOverrides {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "custom" || entry.customType !== SERVICE_TIER_SESSION_ENTRY) {
      continue;
    }
    const state = parseSessionState(entry.data);
    if (state) return state.overrides;
  }
  return {};
}
