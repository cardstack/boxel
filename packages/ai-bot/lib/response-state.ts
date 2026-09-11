import { thinkingMessage } from '../constants.ts';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import { cleanContent } from '@cardstack/runtime-common/ai';

export default class ResponseState {
  latestReasoning: string = '';
  latestContent: string = '';
  toolCalls: ChatCompletionSnapshot.Choice.Message.ToolCall[] = [];
  private toolCallsJson: string | undefined;
  private allowedToolNames: Set<string> | undefined;
  isStreamingFinished = false;
  isCanceled = false;
  // The provider's finish_reason for this turn. Only the chunk that ends the
  // generation carries one; keep the last non-null value so trailing chunks
  // (e.g. the usage report) cannot clear it. OpenRouter normalizes the
  // upstream reason: a generation that hit the output-token limit while
  // emitting a tool call arrives as 'tool_calls', with the cut visible only
  // in `native_finish_reason` ('max_output_tokens' / 'length'). Record that
  // here as 'length' so the cut is reported to the user either way.
  finishReason: string | undefined;

  updateFinishReason(
    finishReason: string | null | undefined,
    nativeFinishReason?: string | null,
  ) {
    if (
      nativeFinishReason === 'max_output_tokens' ||
      nativeFinishReason === 'length'
    ) {
      this.finishReason = 'length';
      return;
    }
    if (finishReason) {
      this.finishReason = finishReason;
    }
  }

  setAllowedToolNames(names: Iterable<string> | undefined) {
    this.allowedToolNames = names ? new Set(names) : undefined;
  }

  update(
    newReasoning: string | undefined,
    contentSnapshot: string | null | undefined,
    toolCallsSnapshot:
      | ChatCompletionSnapshot.Choice.Message.ToolCall[]
      | undefined,
    isStreamingFinished: boolean,
  ): boolean {
    let updated = false;
    updated = this.updateReasoning(newReasoning) || updated;
    updated = this.updateContent(contentSnapshot) || updated;
    updated = this.updateToolCalls(toolCallsSnapshot) || updated;
    updated = this.updateIsStreamingFinished(isStreamingFinished) || updated;
    return updated;
  }

  private updateToolCalls(
    toolCallsSnapshot:
      | ChatCompletionSnapshot.Choice.Message.ToolCall[]
      | undefined,
  ) {
    if (toolCallsSnapshot?.length) {
      // In lengthy conversations, the LLM will sometimes call checkCorrectness
      // tool on its own, even when we explicitly disallow this in our prompts.
      // The LLM will usually place this tool call after code patches are offered
      // but the user hasn't accepted them yet. When this happens, ignore these
      // tool calls. We only allow them when we construct them ourselves (in the
      // ai bot's code), at the point where we know the user has accepted the
      // card/code patches.
      toolCallsSnapshot = toolCallsSnapshot.filter((call) => {
        let name = (call as any)?.function?.name;
        if (!name) {
          return false;
        }
        if (name === 'checkCorrectness') {
          return false;
        }
        if (this.allowedToolNames && !this.allowedToolNames.has(name)) {
          return false;
        }
        return true;
      });
      let latestToolCallsJson = JSON.stringify(toolCallsSnapshot);
      if (this.toolCallsJson !== latestToolCallsJson) {
        this.toolCalls = toolCallsSnapshot;
        this.toolCallsJson = latestToolCallsJson;
        return true;
      }
    }
    return false;
  }

  private updateContent(contentSnapshot: string | null | undefined) {
    if (contentSnapshot?.length) {
      contentSnapshot = cleanContent(contentSnapshot);
      if (this.latestContent !== contentSnapshot) {
        if (this.latestReasoning === thinkingMessage) {
          this.latestReasoning = '';
        }
        this.latestContent = contentSnapshot;
        return true;
      }
    }
    return false;
  }

  private updateReasoning(newReasoningContent: string | undefined) {
    if (newReasoningContent?.length) {
      if (this.latestReasoning === thinkingMessage) {
        this.latestReasoning = '';
      }
      this.latestReasoning = this.latestReasoning + newReasoningContent;
      // gpt-5 has an annoying habit of beginning new headers without a preceding blank line
      this.latestReasoning = this.latestReasoning.replace(
        /(\S)(\*\*[^*]+\*\*\n\n)/,
        '$1\n\n$2',
      );
      return true;
    }
    return false;
  }

  updateIsStreamingFinished(
    isStreamingFinished: boolean,
    isCanceled?: boolean,
  ) {
    if (this.isStreamingFinished !== isStreamingFinished) {
      this.isStreamingFinished = isStreamingFinished;
      this.isCanceled = isCanceled ?? false;
      return true;
    }
    return false;
  }

  snapshot() {
    return {
      reasoning: this.latestReasoning,
      content: this.latestContent,
      toolCalls: this.toolCalls,
      isStreamingFinished: this.isStreamingFinished,
      isCanceled: this.isCanceled,
      finishReason: this.finishReason,
    };
  }
}
