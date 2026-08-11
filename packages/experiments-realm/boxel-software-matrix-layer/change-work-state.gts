import {
  CardDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { MatrixConcept } from './matrix-concept';
import { ConceptReview } from './concept-review';
import { Teammate } from './teammate';

const WORK_STATES = ['Done', 'In Progress', 'Next', 'Blocked'];

export class ChangeWorkStateInput extends CardDef {
  @field concept = linksTo(() => MatrixConcept);
  @field author = linksTo(() => Teammate);
  @field newState = contains(StringField);
  @field reason = contains(StringField);
  @field realm = contains(StringField);
}

export class ChangeWorkStateResult extends CardDef {
  @field review = linksTo(() => ConceptReview);
  @field message = contains(StringField);
}

// One step, two writes: the state change lands on the concept AND leaves an
// attributed entry in its review thread, so history never depends on memory.
export default class ChangeWorkStateCommand extends Command<
  typeof ChangeWorkStateInput,
  typeof ChangeWorkStateResult
> {
  static actionVerb = 'Change State';
  static displayName = 'Change Work State';

  async getInputType() {
    return ChangeWorkStateInput;
  }

  protected async run(
    input: ChangeWorkStateInput,
  ): Promise<ChangeWorkStateResult> {
    let { concept, author, newState, reason, realm } = input;
    if (!concept) throw new Error('A concept is required');
    if (!realm) throw new Error('A realm is required');
    if (!WORK_STATES.includes(newState ?? '')) {
      throw new Error(`newState must be one of: ${WORK_STATES.join(', ')}`);
    }

    let save = async <T extends CardDef>(card: T): Promise<T> =>
      (await new SaveCardCommand(this.commandContext).execute({
        card,
        realm,
      } as any)) as T;

    let previous = concept.workState ?? 'unset';
    concept.workState = newState;
    await save(concept);

    let review = await save(
      new ConceptReview({
        concept,
        reviewer: author,
        verdict: 'comment',
        body: `**State:** ${previous} → ${newState}${
          reason?.trim() ? ` — ${reason.trim()}` : ''
        }`,
        createdAt: new Date(),
        resolved: true,
      }),
    );

    return new ChangeWorkStateResult({
      review,
      message: `${concept.concept}: ${previous} → ${newState}`,
    });
  }
}
