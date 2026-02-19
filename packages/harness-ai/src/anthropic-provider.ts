import type { AnthropicProviderToolDefinition, HarnessAnthropicModel, JsonValue } from './types.ts';

export interface CreateAnthropicOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly headers?: Record<string, string>;
  readonly fetch?: typeof fetch;
}

export type AnthropicModelFactory = ((modelId: string) => HarnessAnthropicModel) & {
  readonly tools: typeof anthropicTools;
};

function normalizeBaseUrl(value: string | undefined): string {
  const base = value?.trim() || 'https://api.anthropic.com/v1';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function createProviderTool(
  anthropicType: string,
  name: string,
  settings?: Record<string, JsonValue>,
): AnthropicProviderToolDefinition {
  const tool: AnthropicProviderToolDefinition = {
    type: 'provider',
    provider: 'anthropic',
    anthropicType,
    name,
  };
  return settings === undefined ? tool : { ...tool, settings };
}

export const anthropicTools = {
  webSearch_20250305(settings?: Record<string, JsonValue>): AnthropicProviderToolDefinition {
    return createProviderTool('web_search_20250305', 'web_search', settings);
  },
  webFetch_20250910(settings?: Record<string, JsonValue>): AnthropicProviderToolDefinition {
    return createProviderTool('web_fetch_20250910', 'web_fetch', settings);
  },
  toolSearchRegex_20251119(settings?: Record<string, JsonValue>): AnthropicProviderToolDefinition {
    return createProviderTool('tool_search_tool_regex_20251119', 'tool_search', settings);
  },
  toolSearchBm25_20251119(settings?: Record<string, JsonValue>): AnthropicProviderToolDefinition {
    return createProviderTool('tool_search_tool_bm25_20251119', 'tool_search', settings);
  },
};

export const anthropic = {
  tools: anthropicTools,
} as const;

export function createAnthropic(options: CreateAnthropicOptions): AnthropicModelFactory {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const defaultHeaders = {
    ...(options.headers ?? {}),
  };
  const runtimeFetch = options.fetch ?? fetch;

  const factory = ((modelId: string): HarnessAnthropicModel => {
    if (modelId.trim().length === 0) {
      throw new Error('modelId is required');
    }

    return {
      provider: 'harness.anthropic',
      modelId,
      apiKey: options.apiKey,
      baseUrl,
      headers: defaultHeaders,
      fetch: runtimeFetch,
    };
  }) as AnthropicModelFactory;

  Object.defineProperty(factory, 'tools', {
    configurable: false,
    enumerable: true,
    writable: false,
    value: anthropicTools,
  });

  return factory;
}
