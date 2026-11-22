import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";

import {
  DEFAULT_SERVICE_TIER_CONFIG,
  SERVICE_TIER_PROVIDERS,
  SERVICE_TIER_PROVIDER_DEFINITIONS,
  isRecord,
  type ServiceTierConfigSnapshot,
  type ServiceTierName,
  type ServiceTierProvider,
  type ServiceTierSelection,
  type ServiceTierSettings,
  isServiceTierName,
  isServiceTierProvider,
} from "./domain.ts";

export const SERVICE_TIER_CONFIG_FILE = "service-tier.json";

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
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
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

/**
 * Parse `--service-tier`: `off` disables every provider; otherwise a
 * comma-separated list of `provider:tier` pairs, where `off` disables one.
 */
export function parseServiceTierFlag(value: string): ServiceTierSettings {
  if (value.trim() === "off") {
    return Object.fromEntries(SERVICE_TIER_PROVIDERS.map((provider) => [provider, ""]));
  }
  const settings: Partial<Record<ServiceTierProvider, ServiceTierSelection>> = {};
  for (const item of value.split(",")) {
    const [provider, serviceTier, ...rest] = item.trim().split(":");
    if (rest.length > 0 || !isServiceTierProvider(provider)) {
      throw new Error(`--service-tier: expected off or provider:tier pairs, got "${item.trim()}"`);
    }
    if (provider in settings) {
      throw new Error(`--service-tier: ${provider} is set more than once`);
    }
    if (serviceTier !== "off" && !isServiceTierName(provider, serviceTier)) {
      throw new Error(`--service-tier: ${provider} has no service tier "${serviceTier}"`);
    }
    settings[provider] = serviceTier === "off" ? "" : serviceTier;
  }
  return settings;
}
