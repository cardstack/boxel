export default class ResponseEventData {
  needsContinuation = false;
  eventId?: string;
  contentStartIndex: number = 0;
  contentEndIndex: number = 0;
  reasoningStartIndex: number = 0;
  reasoningEndIndex: number = 0;
  readonly eventSizeMax: number;

  constructor(
    eventId: string | undefined,
    eventSizeMax: number,
    contentStartIndex: number = 0,
  ) {
    this.eventSizeMax = eventSizeMax;
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
    let contentEnd = this.contentStartIndex + remainingBudget;
    if (contentEnd < content.length) {
      contentEnd = cutOutsideCodeBlocks(
        content,
        this.contentStartIndex,
        contentEnd,
      );
    }
    let contentForNextMessage = content.slice(
      this.contentStartIndex,
      contentEnd,
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

// A SEARCH/REPLACE block that is cut across two events is never applied: the
// host reads patches per event, so each half is a malformed block. When the
// cut would land inside a fenced code block, move it back to the start of
// that block (the opening fence line, or the URL line the host expects right
// after it), so the whole block moves to the next event. A block bigger than
// one event still has to be cut; the hard cut stays as the fallback.
export function cutOutsideCodeBlocks(
  content: string,
  start: number,
  proposedEnd: number,
): number {
  let piece = content.slice(start, proposedEnd);
  let fences = piece.match(/^```/gm) ?? [];
  if (fences.length % 2 === 0) {
    return proposedEnd; // the cut is not inside a fence
  }
  let lastFence = piece.lastIndexOf('\n```');
  if (lastFence === -1) {
    lastFence = piece.startsWith('```') ? 0 : -1;
  } else {
    lastFence += 1; // the fence line itself starts after the newline
  }
  if (lastFence <= 0) {
    return proposedEnd; // the open block is the whole piece; cut anyway
  }
  return start + lastFence;
}
