/**
 * Chat provider abstraction — xAI default today; Wave 4+ can add DeepSeek/Gemini adapters.
 */
import {
  chatCompletion,
  chatCompletionWithTools,
  type ChatMessage,
  type ChatOptions,
  type ChatCompletionWithToolsResult,
  type ToolDefinition,
} from "../xai/client.js";

export type ChatProviderName = "xai";

export interface ChatProvider {
  readonly name: ChatProviderName;
  complete(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: ChatOptions,
  ): Promise<string>;
  completeWithTools(
    messages: ChatMessage[],
    options?: ChatOptions & { tools?: ToolDefinition[] },
  ): Promise<ChatCompletionWithToolsResult>;
}

class XaiChatProvider implements ChatProvider {
  readonly name = "xai" as const;

  complete(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: ChatOptions,
  ): Promise<string> {
    return chatCompletion(messages, options);
  }

  completeWithTools(
    messages: ChatMessage[],
    options?: ChatOptions & { tools?: ToolDefinition[] },
  ): Promise<ChatCompletionWithToolsResult> {
    return chatCompletionWithTools(messages, options);
  }
}

let activeProvider: ChatProvider = new XaiChatProvider();

export function getChatProvider(): ChatProvider {
  return activeProvider;
}

export function setChatProvider(provider: ChatProvider): void {
  activeProvider = provider;
}
