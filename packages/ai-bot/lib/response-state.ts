import { cleanContent } from '../helpers';
import { thinkingMessage } from '../constants';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';

export default class ResponseState {
  latestReasoning: string = '';
  latestContent: string = '';
  toolCalls: ChatCompletionSnapshot.Choice.Message.ToolCall[] = [];
  private toolCallsJson: string | undefined;
  isStreamingFinished = false;

  updateToolCalls(
    toolCallsSnapshot: ChatCompletionSnapshot.Choice.Message.ToolCall[],
  ) {
    let latestToolCallsJson = JSON.stringify(toolCallsSnapshot);
    if (this.toolCallsJson !== latestToolCallsJson) {
      this.toolCalls = toolCallsSnapshot;
      this.toolCallsJson = latestToolCallsJson;
      return true;
    }
    return false;
  }

  updateContent(contentSnapshot: string | null | undefined) {
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

  updateReasoning(newReasoningContent: string | undefined) {
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
