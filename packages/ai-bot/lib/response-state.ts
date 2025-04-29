import { cleanContent } from '../helpers';
import { thinkingMessage } from '../constants';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';

export default class ResponseState {
  latestReasoning: string = '';
  latestContent: string = '';
  toolCalls: ChatCompletionSnapshot.Choice.Message.ToolCall[] = [];
  private toolCallsJson: string | undefined;
  isStreamingFinished = false;

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
      return true;
    }
    return false;
  }

  updateIsStreamingFinished(isStreamingFinished: boolean) {
    if (this.isStreamingFinished !== isStreamingFinished) {
      this.isStreamingFinished = isStreamingFinished;
      return true;
    }
    return false;
  }
}
