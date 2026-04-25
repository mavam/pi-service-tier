import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

export const SERVICE_TIER_CONFIG_FILE = "service-tier.json";

export const SERVICE_TIER_PROVIDERS = [
  "openai",
  "openai-codex",
  "anthropic",
  "google",
  "google-vertex",
] as const;
export type ServiceTierProvider = (typeof SERVICE_TIER_PROVIDERS)[number];

export type ServiceTierName = "flex" | "priority" | "standard";
export type ServiceTierConfigSnapshot = Partial<
  Record<ServiceTierProvider, ServiceTierName>
>;

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

function tier(name: ServiceTierName, value = name): ServiceTier {
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

function serviceTierNames(provider: ServiceTierProvider): ServiceTierName[] {
  return SERVICE_TIER_PROVIDER_DEFINITIONS[provider].tiers.map(
    (serviceTier) => serviceTier.name,
  );
}

function literalUnion(values: readonly ServiceTierName[]) {
  return Type.Union(values.map((value) => Type.Literal(value)));
}

const serviceTierConfigSchema = Type.Object(
  {
    openai: Type.Optional(literalUnion(serviceTierNames("openai"))),
    "openai-codex": Type.Optional(
      literalUnion(serviceTierNames("openai-codex")),
    ),
    anthropic: Type.Optional(literalUnion(serviceTierNames("anthropic"))),
    google: Type.Optional(literalUnion(serviceTierNames("google"))),
    "google-vertex": Type.Optional(
      literalUnion(serviceTierNames("google-vertex")),
    ),
  },
  { additionalProperties: false },
);
const validateServiceTierConfig = Compile(serviceTierConfigSchema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatValidationErrors(filePath: string, value: unknown): string {
  const errors = Array.from(validateServiceTierConfig.Errors(value));
  const unknownKeys = isRecord(value)
    ? Object.keys(value).filter(
        (key) =>
          !(SERVICE_TIER_PROVIDERS as readonly string[]).includes(key),
      )
    : [];
  if (unknownKeys.length > 0) {
    return `Invalid ${filePath}: unknown setting ${unknownKeys.map((key) => `"${key}"`).join(", ")}`;
  }
  return `Invalid ${filePath}: ${errors
    .map((error) => `${error.path || "/"} ${error.message}`)
    .join(", ")}`;
}

export function getDefaultAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function getServiceTierConfigPath(
  agentDir = getDefaultAgentDir(),
): string {
  return join(agentDir, SERVICE_TIER_CONFIG_FILE);
}

export function isServiceTierProvider(
  value: unknown,
): value is ServiceTierProvider {
  return (
    typeof value === "string" &&
    (SERVICE_TIER_PROVIDERS as readonly string[]).includes(value)
  );
}

export function parseServiceTierConfigValue(
  filePath: string,
  value: unknown,
): ServiceTierConfigSnapshot {
  if (value === undefined) return { ...DEFAULT_SERVICE_TIER_CONFIG };
  if (!validateServiceTierConfig.Check(value)) {
    throw new Error(formatValidationErrors(filePath, value));
  }

  const config = value as ServiceTierConfigSnapshot;
  const result: ServiceTierConfigSnapshot = {};
  for (const provider of SERVICE_TIER_PROVIDERS) {
    const serviceTier = config[provider];
    if (serviceTier !== undefined) result[provider] = serviceTier;
  }
  return result;
}

export function loadServiceTierConfig(
  configPath = getServiceTierConfigPath(),
): ServiceTierConfigSnapshot {
  if (!existsSync(configPath)) return { ...DEFAULT_SERVICE_TIER_CONFIG };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${configPath}: ${message}`);
  }

  return parseServiceTierConfigValue(configPath, parsed);
}

export function writeServiceTierConfigSnapshot(
  config: ServiceTierConfigSnapshot,
  configPath = getServiceTierConfigPath(),
): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

export function modelSupportsServiceTier(
  model: { api?: unknown; provider?: unknown } | undefined,
): boolean {
  return getServiceTierProviderForModel(model) !== undefined;
}

export function getServiceTierProviderForModel(
  model: { api?: unknown; provider?: unknown } | undefined,
): ServiceTierProvider | undefined {
  if (!model || !isServiceTierProvider(model.provider)) return undefined;
  const definition = SERVICE_TIER_PROVIDER_DEFINITIONS[model.provider];
  return model.api === definition.api ? model.provider : undefined;
}

export function getConfiguredServiceTier(
  config: ServiceTierConfigSnapshot,
  provider: ServiceTierProvider | undefined,
): ServiceTierName | "" {
  return provider ? (config[provider] ?? "") : "";
}

export function resolveEffectiveServiceTier(
  config: ServiceTierConfigSnapshot,
  model: { api?: unknown; provider?: unknown } | undefined,
): ServiceTierName | "" {
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
  config: ServiceTierConfigSnapshot,
  model: { api?: unknown; provider?: unknown } | undefined,
): unknown | undefined {
  const provider = getServiceTierProviderForModel(model);
  const serviceTierName = getConfiguredServiceTier(config, provider);
  if (!provider || !serviceTierName || !isRecord(payload)) return undefined;

  const serviceTier = getTier(provider, serviceTierName);
  if (!serviceTier) return undefined;

  return applyPayloadServiceTier(payload, provider, serviceTier.value);
}

export interface FastToggleResult {
  config: ServiceTierConfigSnapshot;
  provider: ServiceTierProvider;
  serviceTier: ServiceTierName | "";
  fast: boolean;
}

export function toggleFastServiceTier(
  config: ServiceTierConfigSnapshot,
  model: { api?: unknown; provider?: unknown } | undefined,
): FastToggleResult | undefined {
  const provider = getServiceTierProviderForModel(model);
  if (!provider) return undefined;

  const definition = SERVICE_TIER_PROVIDER_DEFINITIONS[provider];
  if (!definition.fastTier) return undefined;

  const current = getConfiguredServiceTier(config, provider);
  const fast = current !== definition.fastTier;
  const serviceTier = fast ? definition.fastTier : "";
  return {
    config: setProviderServiceTier(config, provider, serviceTier),
    provider,
    serviceTier,
    fast,
  };
}

export function setProviderServiceTier(
  config: ServiceTierConfigSnapshot,
  provider: ServiceTierProvider,
  value: ServiceTierName | "",
): ServiceTierConfigSnapshot {
  const next = { ...config };
  if (value === "") delete next[provider];
  else next[provider] = value;
  return next;
}

export type ServiceTierSectionId = "current" | "providers";

export interface ServiceTierSectionItem {
  id: ServiceTierProvider;
  label: string;
  currentValue: ServiceTierName | "off";
  values: readonly (ServiceTierName | "off")[];
  description: string;
}

export interface ServiceTierSection {
  id: ServiceTierSectionId;
  title: string;
  items: ServiceTierSectionItem[];
}

function buildSectionItem(
  provider: ServiceTierProvider,
  config: ServiceTierConfigSnapshot,
  currentModel?: { id?: unknown; name?: unknown },
): ServiceTierSectionItem {
  const definition = SERVICE_TIER_PROVIDER_DEFINITIONS[provider];
  const modelLabel =
    typeof currentModel?.name === "string" && currentModel.name
      ? currentModel.name
      : typeof currentModel?.id === "string" && currentModel.id
        ? currentModel.id
        : "";
  const label = modelLabel
    ? `${definition.label} (${modelLabel})`
    : definition.label;
  const configuredValue = getConfiguredServiceTier(config, provider);
  const currentValue = configuredValue || "off";
  const tierNames = definition.tiers.map((serviceTier) => serviceTier.name);
  return {
    id: provider,
    label,
    currentValue,
    values: ["off", ...tierNames],
    description: `${definition.label} supports ${tierNames.join(", ")}.`,
  };
}

export function createServiceTierSections(
  config: ServiceTierConfigSnapshot,
  model: { api?: unknown; provider?: unknown; id?: unknown; name?: unknown } | undefined,
): ServiceTierSection[] {
  const currentProvider = getServiceTierProviderForModel(model);
  const otherProviders = SERVICE_TIER_PROVIDERS.filter(
    (provider) => provider !== currentProvider,
  );
  const sections: ServiceTierSection[] = [];

  if (currentProvider) {
    sections.push({
      id: "current",
      title: "Current Model",
      items: [buildSectionItem(currentProvider, config, model)],
    });
  }

  sections.push({
    id: "providers",
    title: currentProvider ? "Other Providers" : "Providers",
    items: otherProviders.map((provider) => buildSectionItem(provider, config)),
  });

  return sections;
}
