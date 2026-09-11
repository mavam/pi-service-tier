export const SERVICE_TIER_PROVIDERS = [
  "openai",
  "openai-codex",
  "anthropic",
  "google",
  "google-vertex",
] as const;
export type ServiceTierProvider = (typeof SERVICE_TIER_PROVIDERS)[number];

export type ServiceTierName = "flex" | "priority" | "standard";
/** An omitted provider leaves the provider's default behavior unchanged. */
export type ServiceTierConfigSnapshot = Partial<
  Record<ServiceTierProvider, ServiceTierName>
>;

export type ServiceTierSelection = ServiceTierName | "";

/** Read-only policy input, independent of where settings are stored. */
export type ServiceTierSettings = Readonly<
  Partial<Record<ServiceTierProvider, ServiceTierSelection>>
>;

/** Only the model fields this extension needs, including untrusted inputs. */
export interface ServiceTierModel {
  readonly provider?: unknown;
  readonly api?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
}

export interface ServiceTier {
  name: ServiceTierName;
  value: string;
}

export const DEFAULT_SERVICE_TIER_CONFIG: ServiceTierConfigSnapshot = {};

export interface ServiceTierProviderDefinition {
  label: string;
  api: string;
  tiers: readonly ServiceTier[];
  fastTier?: ServiceTierName;
}

function tier(name: ServiceTierName, value: string = name): ServiceTier {
  return { name, value };
}

export const SERVICE_TIER_PROVIDER_DEFINITIONS: Record<
  ServiceTierProvider,
  ServiceTierProviderDefinition
> = {
  openai: {
    label: "OpenAI",
    api: "openai-responses",
    tiers: [tier("flex"), tier("priority")],
    fastTier: "priority",
  },
  "openai-codex": {
    label: "OpenAI Codex",
    api: "openai-codex-responses",
    tiers: [tier("flex"), tier("priority")],
    fastTier: "priority",
  },
  anthropic: {
    label: "Anthropic",
    api: "anthropic-messages",
    tiers: [tier("priority", "auto"), tier("standard", "standard_only")],
    fastTier: "priority",
  },
  google: {
    label: "Google Gemini",
    api: "google-generative-ai",
    tiers: [tier("flex"), tier("priority")],
    fastTier: "priority",
  },
  "google-vertex": {
    label: "Google Vertex AI",
    api: "google-vertex",
    tiers: [tier("flex"), tier("priority")],
    fastTier: "priority",
  },
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isServiceTierProvider(
  value: unknown,
): value is ServiceTierProvider {
  return (
    typeof value === "string" &&
    (SERVICE_TIER_PROVIDERS as readonly string[]).includes(value)
  );
}

export function modelSupportsServiceTier(
  model: ServiceTierModel | undefined,
): boolean {
  return getServiceTierProviderForModel(model) !== undefined;
}

export function getServiceTierProviderForModel(
  model: ServiceTierModel | undefined,
): ServiceTierProvider | undefined {
  if (!model || !isServiceTierProvider(model.provider)) return undefined;
  const definition = SERVICE_TIER_PROVIDER_DEFINITIONS[model.provider];
  return model.api === definition.api ? model.provider : undefined;
}

export function getConfiguredServiceTier(
  config: ServiceTierSettings,
  provider: ServiceTierProvider | undefined,
): ServiceTierSelection {
  return provider ? (config[provider] ?? "") : "";
}

export function resolveEffectiveServiceTier(
  config: ServiceTierSettings,
  model: ServiceTierModel | undefined,
): ServiceTierSelection {
  return getConfiguredServiceTier(config, getServiceTierProviderForModel(model));
}

function getTier(
  provider: ServiceTierProvider,
  serviceTierName: ServiceTierName,
): ServiceTier | undefined {
  return SERVICE_TIER_PROVIDER_DEFINITIONS[provider].tiers.find(
    (serviceTier) => serviceTier.name === serviceTierName,
  );
}

function applyPayloadServiceTier(
  payload: Record<string, unknown>,
  provider: ServiceTierProvider,
  value: string,
): Record<string, unknown> {
  if (provider === "google" || provider === "google-vertex") {
    return {
      ...payload,
      config: {
        ...(isRecord(payload.config) ? payload.config : {}),
        serviceTier: value,
      },
    };
  }

  return { ...payload, service_tier: value };
}

export function applyServiceTierToPayload(
  payload: unknown,
  config: ServiceTierSettings,
  model: ServiceTierModel | undefined,
): unknown | undefined {
  const provider = getServiceTierProviderForModel(model);
  const serviceTierName = getConfiguredServiceTier(config, provider);
  if (!provider || !serviceTierName || !isRecord(payload)) return undefined;

  const serviceTier = getTier(provider, serviceTierName);
  if (!serviceTier) return undefined;

  return applyPayloadServiceTier(payload, provider, serviceTier.value);
}

export interface FastToggleResult {
  provider: ServiceTierProvider;
  serviceTier: ServiceTierSelection;
  fast: boolean;
}

export function toggleFastServiceTier(
  config: ServiceTierSettings,
  model: ServiceTierModel | undefined,
): FastToggleResult | undefined {
  const provider = getServiceTierProviderForModel(model);
  if (!provider) return undefined;

  const definition = SERVICE_TIER_PROVIDER_DEFINITIONS[provider];
  if (!definition.fastTier) return undefined;

  const current = getConfiguredServiceTier(config, provider);
  const fast = current !== definition.fastTier;
  const serviceTier = fast ? definition.fastTier : "";
  return {
    provider,
    serviceTier,
    fast,
  };
}

export function setProviderServiceTier(
  config: ServiceTierConfigSnapshot,
  provider: ServiceTierProvider,
  value: ServiceTierSelection,
): ServiceTierConfigSnapshot {
  const next = { ...config };
  if (value === "") delete next[provider];
  else next[provider] = value;
  return next;
}
