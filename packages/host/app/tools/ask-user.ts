import HostBaseTool from '../lib/host-base-tool';

import type * as BaseToolModule from '@cardstack/base/command';

// The assistant asks the user to pick, and waits. The transcript shows the
// options as a picker in the call's own row (cards, color swatches or
// pills); the user's click runs the call with their pick as `answer`, and
// the pick is the call's result, which is how the model reads it.
export default class AskUserTool extends HostBaseTool<
  typeof BaseToolModule.AskUserInput,
  typeof BaseToolModule.AskUserResult
> {
  static actionVerb = 'Answer';
  // Never run by Act mode: only the user's pick runs it.
  static neverAutoExecutes = true;

  description =
    'Ask the user to choose before you continue. Give a short question and ' +
    'two to six options. kind "cards" shows each option as a card (set ' +
    'cardId to the card URL), kind "swatches" shows colors (set color), ' +
    'kind "options" shows labelled choices. kind "recommend" proposes one: ' +
    'put your pick first, give each option a detail (the reason) and a ' +
    'confidence ("high", "medium" or "low"); the user accepts it or opens ' +
    'the alternatives. Set allowOther to let the user ' +
    'type their own answer. Never set answer: the host fills it from the ' +
    "user's pick. Use this rather than asking in prose when the answer is " +
    'one of a known set.';

  requireInputFields = ['question', 'options'];

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { AskUserInput } = commandModule;
    return AskUserInput;
  }

  protected async run(
    input: BaseToolModule.AskUserInput,
  ): Promise<BaseToolModule.AskUserResult> {
    let answer = typeof input.answer === 'string' ? input.answer.trim() : '';
    if (!answer) {
      throw new Error(
        'The user has not picked yet. ask-user runs only from the user’s pick.',
      );
    }
    let option = (input.options ?? []).find(
      (candidate) => (candidate.value ?? candidate.label) === answer,
    );
    let { AskUserResult } = await this.loadToolModule();
    return new AskUserResult({
      question: input.question,
      answer,
      label: option?.label ?? answer,
    });
  }
}
