import type Anthropic from "@anthropic-ai/sdk";

const EPHEMERAL: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

/**
 * Prompt-cache breakpoints for one request: end of tools, end of system, and the
 * last block of the last message. The API allows at most 4 per request, and
 * history must stay unmarked or breakpoints would pile up across turns.
 */
export function cachedSystem(text: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text, cache_control: EPHEMERAL }];
}

export function cachedTools(tools: Anthropic.Tool[]): Anthropic.Tool[] {
  if (tools.length === 0) return tools;
  const copy = tools.slice();
  copy[copy.length - 1] = { ...copy[copy.length - 1], cache_control: EPHEMERAL };
  return copy;
}

export function cachedMessages(
  history: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  if (history.length === 0) return history;
  const copy = history.slice();
  const last = copy[copy.length - 1];

  if (typeof last.content === "string") {
    copy[copy.length - 1] = {
      ...last,
      content: [{ type: "text", text: last.content, cache_control: EPHEMERAL }],
    };
    return copy;
  }

  const blocks = last.content.slice();
  const index = blocks.length - 1;
  if (index < 0 || !supportsCacheControl(blocks[index])) return history;
  blocks[index] = { ...blocks[index], cache_control: EPHEMERAL } as Anthropic.ContentBlockParam;
  copy[copy.length - 1] = { ...last, content: blocks };
  return copy;
}

function supportsCacheControl(block: Anthropic.ContentBlockParam): boolean {
  return block.type !== "thinking" && block.type !== "redacted_thinking";
}
