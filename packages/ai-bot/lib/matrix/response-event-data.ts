export default class ResponseEventData {
  needsContinuation = false;
  eventId?: string;
  contentStartIndex: number = 0;
  contentEndIndex: number = 0;
  reasoningStartIndex: number = 0;
  reasoningEndIndex: number = 0;

  constructor(
    eventId: string | undefined,
    readonly eventSizeMax: number,
    contentStartIndex: number = 0,
  ) {
    this.eventId = eventId;
    this.contentStartIndex = contentStartIndex;
  }

  wouldExceedMaxSize(reasoning: string, content: string): boolean {
    let proposedSize = reasoning.length - this.reasoningStartIndex;
    proposedSize += content.length - this.contentStartIndex;
    return proposedSize > this.eventSizeMax;
  }

  reasoningAndContentForNextMessage(
    reasoning: string,
    content: string,
  ): { reasoning: string; content: string } {
    let reasoningForNextMessage = reasoning.slice(
      this.reasoningStartIndex,
      this.reasoningStartIndex + this.eventSizeMax,
    );
    let remainingBudget = this.eventSizeMax - reasoningForNextMessage.length;
    if (remainingBudget <= 0) {
      return {
        reasoning: reasoningForNextMessage,
        content: '',
      };
    }
    let contentForNextMessage = content.slice(
      this.contentStartIndex,
      this.contentStartIndex + remainingBudget,
    );
    return {
      reasoning: reasoningForNextMessage,
      content: contentForNextMessage,
    };
  }

  updateEndIndices(reasoningAndContent: {
    reasoning: string;
    content: string;
  }): void {
    this.reasoningEndIndex =
      this.reasoningStartIndex + reasoningAndContent.reasoning.length;
    this.contentEndIndex =
      this.contentStartIndex + reasoningAndContent.content.length;
  }

  buildNextEvent(): ResponseEventData {
    let nextEvent = new ResponseEventData(undefined, this.eventSizeMax);
    nextEvent.contentStartIndex = this.contentEndIndex;
    nextEvent.reasoningStartIndex = this.reasoningEndIndex;
    return nextEvent;
  }
}
