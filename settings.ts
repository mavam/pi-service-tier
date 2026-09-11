import {
  SERVICE_TIER_PROVIDERS,
  SERVICE_TIER_PROVIDER_DEFINITIONS,
  getConfiguredServiceTier,
  getServiceTierProviderForModel,
  type ServiceTierConfigSnapshot,
  type ServiceTierModel,
  type ServiceTierName,
  type ServiceTierProvider,
} from "./domain.ts";

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
  currentModel?: ServiceTierModel,
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
  model: ServiceTierModel | undefined,
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
