import {
  getSettingsListTheme,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  SettingsList,
  Text,
  type SettingItem,
} from "@earendil-works/pi-tui";
import {
  DEFAULT_SERVICE_TIER_CONFIG,
  SERVICE_TIER_PROVIDER_DEFINITIONS,
  applyServiceTierToPayload,
  isServiceTierProvider,
  resolveEffectiveServiceTier,
  setProviderServiceTier,
  toggleFastServiceTier,
  type ServiceTierSelection,
  type ServiceTierSettings,
  type ServiceTierConfigSnapshot,
  type ServiceTierName,
} from "./domain.ts";
import {
  getServiceTierConfigPath,
  loadServiceTierConfig,
  writeServiceTierConfigSnapshot,
} from "./config.ts";
import { createServiceTierSections } from "./settings.ts";
import {
  SERVICE_TIER_SESSION_ENTRY,
  mergeServiceTierSettings,
  restoreServiceTierOverrides,
  type ServiceTierSessionState,
  type SessionServiceTierOverrides,
} from "./session-state.ts";

export const SERVICE_TIER_WIDGET_ID = "pi-service-tier.service-tier";

const FANCY_FOOTER_PROTOCOL = 1;
const FANCY_FOOTER_WIDGET_EVENT = "pi-fancy-footer:widget";
const FANCY_FOOTER_READY_EVENT = "pi-fancy-footer:ready";

function warnOnce(message: string, lastWarning: string): string {
  if (message !== lastWarning) console.warn(`pi-service-tier: ${message}`);
  return message;
}

function formatModel(model: ExtensionContext["model"]): string {
  if (!model) return "the current model";
  return `${model.provider}/${model.id}`;
}

function notifyConfigWriteError(ctx: ExtensionCommandContext, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.notify(`Failed to save service tier config: ${message}`, "error");
}

function createServiceTierSettingItems(
  config: ServiceTierConfigSnapshot,
  model: ExtensionContext["model"],
): SettingItem[] {
  return createServiceTierSections(config, model).flatMap((section) =>
    section.items.map((item) => ({
      id: item.id,
      label: section.id === "current" ? `Current: ${item.label}` : item.label,
      description: item.description,
      currentValue: item.currentValue,
      values: [...item.values],
    })),
  );
}

export default function (pi: ExtensionAPI) {
  let currentServiceTier: ServiceTierSelection = "";
  let lastConfigWarning = "";
  let sessionOverrides: SessionServiceTierOverrides = {};

  const publishFancyFooterWidget = (): void => {
    pi.events.emit(FANCY_FOOTER_WIDGET_EVENT, {
      protocol: FANCY_FOOTER_PROTOCOL,
      type: "upsert",
      widget: {
        id: SERVICE_TIER_WIDGET_ID,
        label: "Service tier",
        description: "Shows a bolt when a provider service tier is active.",
        content: { type: "text", text: currentServiceTier ? "⚡" : "" },
        icon: false,
        layout: {
          row: 1,
          position: 8,
          align: "right",
          fill: "none",
        },
      },
    });
  };

  const stopFancyFooterReady = pi.events.on(
    FANCY_FOOTER_READY_EVENT,
    (message) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("protocol" in message) ||
        message.protocol !== FANCY_FOOTER_PROTOCOL
      ) {
        return;
      }
      publishFancyFooterWidget();
    },
  );

  // Covers the case where the footer installed its listener first. The ready
  // handler above covers the opposite load order.
  publishFancyFooterWidget();

  const loadConfigOrDefault = (): ServiceTierConfigSnapshot => {
    try {
      const config = loadServiceTierConfig();
      lastConfigWarning = "";
      return config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastConfigWarning = warnOnce(message, lastConfigWarning);
      return { ...DEFAULT_SERVICE_TIER_CONFIG };
    }
  };

  const loadConfigForCommand = (
    ctx: ExtensionCommandContext,
  ): ServiceTierConfigSnapshot | undefined => {
    try {
      const config = loadServiceTierConfig();
      lastConfigWarning = "";
      return config;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastConfigWarning = warnOnce(message, lastConfigWarning);
      ctx.ui.notify(`Invalid service tier config: ${message}`, "error");
      return undefined;
    }
  };

  const effectiveSettings = (
    defaults = loadConfigOrDefault(),
  ): ServiceTierSettings => mergeServiceTierSettings(defaults, sessionOverrides);

  const refreshServiceTier = (
    ctx: ExtensionContext,
    config = effectiveSettings(),
    forceRefresh = false,
  ): ServiceTierSelection => {
    const nextServiceTier = resolveEffectiveServiceTier(config, ctx.model);
    if (currentServiceTier === nextServiceTier && !forceRefresh) {
      return currentServiceTier;
    }

    currentServiceTier = nextServiceTier;
    publishFancyFooterWidget();
    return currentServiceTier;
  };

  const writeAndRefresh = (
    ctx: ExtensionCommandContext,
    config: ServiceTierConfigSnapshot,
  ): boolean => {
    try {
      writeServiceTierConfigSnapshot(config);
      refreshServiceTier(ctx, effectiveSettings(config), true);
      return true;
    } catch (error) {
      notifyConfigWriteError(ctx, error);
      return false;
    }
  };

  pi.registerCommand("fast", {
    description: "Toggle fast service tier for the current provider in this session.",
    handler: async (_args, ctx) => {
      const config = loadConfigForCommand(ctx);
      if (!config) return;

      const result = toggleFastServiceTier(effectiveSettings(config), ctx.model);
      if (!result) {
        ctx.ui.notify(
          `Service tier is not supported for ${formatModel(ctx.model)}.`,
          "warning",
        );
        return;
      }

      const state: ServiceTierSessionState = {
        version: 1,
        overrides: { ...sessionOverrides, [result.provider]: result.serviceTier },
      };
      try {
        pi.appendEntry(SERVICE_TIER_SESSION_ENTRY, state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to save session service tier: ${message}`, "error");
        return;
      }
      sessionOverrides = state.overrides;
      refreshServiceTier(ctx, effectiveSettings(config), true);

      const providerLabel =
        SERVICE_TIER_PROVIDER_DEFINITIONS[result.provider].label;
      ctx.ui.notify(
        `${providerLabel} service tier for this session: ${result.serviceTier || "off"}`,
        "info",
      );
    },
  });

  pi.registerCommand("service-tier", {
    description: "Configure global provider service tier defaults.",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/service-tier requires interactive UI mode", "warning");
        return;
      }

      const config = loadConfigForCommand(ctx);
      if (!config) return;

      await ctx.ui.custom((tui, theme, _keybindings, done) => {
        let currentConfig = config;
        const items = createServiceTierSettingItems(currentConfig, ctx.model);
        const container = new Container();
        container.addChild(
          new Text(
            `${theme.fg("accent", theme.bold("Global service tier defaults"))}\n${theme.fg(
              "dim",
              `${getServiceTierConfigPath()}\nSession /fast overrides take precedence.`,
            )}`,
            0,
            0,
          ),
        );

        let settingsList: SettingsList;
        settingsList = new SettingsList(
          items,
          Math.min(items.length, 12),
          getSettingsListTheme(),
          (id, newValue) => {
            if (!isServiceTierProvider(id)) return;

            const previousValue = currentConfig[id] ?? "off";
            const nextConfig = setProviderServiceTier(
              currentConfig,
              id,
              newValue === "off" ? "" : (newValue as ServiceTierName),
            );
            if (!writeAndRefresh(ctx, nextConfig)) {
              settingsList.updateValue(id, previousValue);
              return;
            }

            currentConfig = nextConfig;
          },
          () => done(undefined),
        );
        container.addChild(settingsList);

        return {
          render: (width: number) => container.render(width),
          invalidate: () => container.invalidate(),
          handleInput(data: string) {
            settingsList.handleInput(data);
            tui.requestRender();
          },
        };
      });
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    sessionOverrides = restoreServiceTierOverrides(ctx.sessionManager.getBranch());
    refreshServiceTier(ctx, effectiveSettings(), true);
  });

  pi.on("session_tree", async (_event, ctx) => {
    sessionOverrides = restoreServiceTierOverrides(ctx.sessionManager.getBranch());
    refreshServiceTier(ctx, effectiveSettings(), true);
  });

  pi.on("model_select", async (_event, ctx) => {
    refreshServiceTier(ctx);
  });

  pi.on("before_provider_request", async (event, ctx) => {
    const config = effectiveSettings();
    refreshServiceTier(ctx, config);
    return applyServiceTierToPayload(event.payload, config, ctx.model);
  });

  pi.on("session_shutdown", async () => {
    currentServiceTier = "";
    stopFancyFooterReady();
    pi.events.emit(FANCY_FOOTER_WIDGET_EVENT, {
      protocol: FANCY_FOOTER_PROTOCOL,
      type: "remove",
      id: SERVICE_TIER_WIDGET_ID,
    });
  });
}
