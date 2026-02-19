type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface JsonSchema {
  readonly [key: string]: JsonValue;
}

export type FinishReason = 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';

export interface LanguageModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
}

export interface LanguageModelRequestMetadata {
  readonly body: Record<string, unknown>;
}

export interface LanguageModelResponseMetadata {
  readonly id?: string;
  readonly modelId?: string;
  readonly timestamp?: Date;
  readonly headers?: Headers;
}

export type ProviderMetadata = Record<string, Record<string, unknown>>;

export interface FunctionToolDefinition<INPUT = unknown, OUTPUT = unknown> {
  readonly type?: 'function';
  readonly description?: string;
  readonly inputSchema?: JsonSchema;
  readonly execute?: (input: INPUT) => Promise<OUTPUT> | OUTPUT;
  readonly dynamic?: boolean;
  readonly title?: string;
}

export interface AnthropicProviderToolDefinition {
  readonly type: 'provider';
  readonly provider: 'anthropic';
  readonly anthropicType: string;
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: JsonSchema;
  readonly settings?: Record<string, JsonValue>;
  readonly dynamic?: boolean;
  readonly title?: string;
}

export type ToolDefinition<INPUT = unknown, OUTPUT = unknown> =
  | FunctionToolDefinition<INPUT, OUTPUT>
  | AnthropicProviderToolDefinition;

export type ToolSet = Record<string, ToolDefinition<unknown, unknown>>;

type ToolName<TOOLS extends ToolSet> = Extract<keyof TOOLS, string>;

export interface TypedToolCall<TOOLS extends ToolSet> {
  readonly toolCallId: string;
  readonly toolName: ToolName<TOOLS> | string;
  readonly input: unknown;
  readonly providerExecuted?: boolean;
  readonly dynamic?: boolean;
  readonly providerMetadata?: ProviderMetadata;
  readonly title?: string;
  readonly invalid?: boolean;
  readonly error?: string;
}

export interface TypedToolResult<TOOLS extends ToolSet> {
  readonly toolCallId: string;
  readonly toolName: ToolName<TOOLS> | string;
  readonly output: unknown;
  readonly input?: unknown;
  readonly providerExecuted?: boolean;
  readonly preliminary?: boolean;
  readonly dynamic?: boolean;
}

export interface TypedToolError<TOOLS extends ToolSet> {
  readonly toolCallId: string;
  readonly toolName: ToolName<TOOLS> | string;
  readonly error: unknown;
  readonly input?: unknown;
  readonly providerExecuted?: boolean;
  readonly dynamic?: boolean;
}

export interface TextContentPart {
  readonly type: 'text';
  readonly text: string;
}

export interface AssistantToolCallPart {
  readonly type: 'tool-call';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export interface ToolResultContentPart {
  readonly type: 'tool-result';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
  readonly isError?: boolean;
}

interface SystemModelMessage {
  readonly role: 'system';
  readonly content: string;
}

interface UserModelMessage {
  readonly role: 'user';
  readonly content: string | TextContentPart[];
}

export interface AssistantModelMessage {
  readonly role: 'assistant';
  readonly content: string | (TextContentPart | AssistantToolCallPart)[];
}

export interface ToolModelMessage {
  readonly role: 'tool';
  readonly content: ToolResultContentPart[];
}

export type ModelMessage =
  | SystemModelMessage
  | UserModelMessage
  | AssistantModelMessage
  | ToolModelMessage;

export interface HarnessAnthropicModel {
  readonly provider: 'harness.anthropic';
  readonly modelId: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly headers: Record<string, string>;
  readonly fetch: typeof fetch;
}

export type StreamTextPart<TOOLS extends ToolSet> =
  | {
      readonly type: 'start';
    }
  | {
      readonly type: 'start-step';
      readonly request: LanguageModelRequestMetadata;
      readonly warnings: string[];
    }
  | {
      readonly type: 'text-start';
      readonly id: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'text-delta';
      readonly id: string;
      readonly text: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'text-end';
      readonly id: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'reasoning-start';
      readonly id: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'reasoning-delta';
      readonly id: string;
      readonly text: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'reasoning-end';
      readonly id: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'tool-input-start';
      readonly id: string;
      readonly toolName: ToolName<TOOLS> | string;
      readonly providerExecuted?: boolean;
      readonly dynamic?: boolean;
      readonly title?: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'tool-input-delta';
      readonly id: string;
      readonly delta: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'tool-input-end';
      readonly id: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | ({ readonly type: 'tool-call' } & TypedToolCall<TOOLS>)
  | ({ readonly type: 'tool-result' } & TypedToolResult<TOOLS>)
  | ({ readonly type: 'tool-error' } & TypedToolError<TOOLS>)
  | {
      readonly type: 'source';
      readonly id: string;
      readonly sourceType: 'url' | 'document';
      readonly url?: string;
      readonly title?: string;
      readonly mediaType?: string;
      readonly filename?: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'raw';
      readonly rawValue: unknown;
    }
  | {
      readonly type: 'finish-step';
      readonly response: LanguageModelResponseMetadata;
      readonly usage: LanguageModelUsage;
      readonly finishReason: FinishReason;
      readonly rawFinishReason?: string;
      readonly providerMetadata?: ProviderMetadata;
    }
  | {
      readonly type: 'finish';
      readonly finishReason: FinishReason;
      readonly rawFinishReason?: string;
      readonly totalUsage: LanguageModelUsage;
    }
  | {
      readonly type: 'abort';
      readonly reason?: string;
    }
  | {
      readonly type: 'error';
      readonly error: unknown;
    };

export interface UIMessageChunk {
  readonly type:
    | 'start'
    | 'start-step'
    | 'finish-step'
    | 'abort'
    | 'message-metadata'
    | 'error'
    | 'text-start'
    | 'text-delta'
    | 'text-end'
    | 'reasoning-start'
    | 'reasoning-delta'
    | 'reasoning-end'
    | 'tool-input-start'
    | 'tool-input-delta'
    | 'tool-input-available'
    | 'tool-input-error'
    | 'tool-output-available'
    | 'tool-output-error'
    | 'source-url'
    | 'source-document'
    | 'finish';
  readonly [key: string]: unknown;
}

export type AsyncIterableStream<T> = ReadableStream<T> & AsyncIterable<T>;

export interface StreamTextResult<TOOLS extends ToolSet> {
  readonly fullStream: AsyncIterableStream<StreamTextPart<TOOLS>>;
  readonly textStream: AsyncIterableStream<string>;
  readonly text: Promise<string>;
  readonly toolCalls: Promise<TypedToolCall<TOOLS>[]>;
  readonly toolResults: Promise<Array<TypedToolResult<TOOLS> | TypedToolError<TOOLS>>>;
  readonly finishReason: Promise<FinishReason>;
  readonly usage: Promise<LanguageModelUsage>;
  readonly response: Promise<LanguageModelResponseMetadata>;
  toUIMessageStream(): AsyncIterableStream<UIMessageChunk>;
  toUIMessageStreamResponse(init?: ResponseInit): Response;
  consumeStream(): Promise<void>;
}

export interface GenerateTextResult<TOOLS extends ToolSet> {
  readonly text: string;
  readonly finishReason: FinishReason;
  readonly usage: LanguageModelUsage;
  readonly response: LanguageModelResponseMetadata;
  readonly toolCalls: TypedToolCall<TOOLS>[];
  readonly toolResults: Array<TypedToolResult<TOOLS> | TypedToolError<TOOLS>>;
}

export interface StreamObjectResult<T> {
  readonly partialObjectStream: AsyncIterableStream<Partial<T>>;
  readonly object: Promise<T>;
  readonly text: Promise<string>;
  readonly finishReason: Promise<FinishReason>;
}

export interface StreamTextOptions<TOOLS extends ToolSet> {
  readonly model: HarnessAnthropicModel;
  readonly prompt?: string;
  readonly messages?: ModelMessage[];
  readonly system?: string;
  readonly tools?: TOOLS;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stopSequences?: string[];
  readonly includeRawChunks?: boolean;
  readonly abortSignal?: AbortSignal;
  readonly maxToolRoundtrips?: number;
}

export interface GenerateTextOptions<TOOLS extends ToolSet> extends StreamTextOptions<TOOLS> {}

export interface StreamObjectOptions<T, TOOLS extends ToolSet> extends StreamTextOptions<TOOLS> {
  readonly schema: JsonSchema;
  readonly validate?: (value: unknown) => value is T;
}
