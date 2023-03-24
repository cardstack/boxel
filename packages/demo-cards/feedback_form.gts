import {
  contains,
  field,
  Card,
  Component,
  containsMany,
  relativeTo,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';

class FeedbackQuestion extends Card {
  @field question = contains(TextAreaCard); // required
  @field rating = contains(StringCard); // dropdown
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='feedback-question-card'>
        <FieldContainer @label='Question'>
          <@fields.question />
        </FieldContainer>
        <FieldContainer @label='Rating'>
          <@fields.rating />
        </FieldContainer>
      </CardContainer>
    </template>
  };
}

export class FeedbackForm extends Card {
  @field title = contains(StringCard); // required
  @field description = contains(TextAreaCard);
  @field questions = containsMany(FeedbackQuestion); // required
  @field customTextField = contains(TextAreaCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='feedback-form-card--embedded'>
        <h2><@fields.title /></h2>
        <p><@fields.description /></p>
        <@fields.questions />
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='feedback-form-card'>
        <section>
          <h2>Feedback Form</h2>
          <h3><@fields.title /></h3>
          <p><@fields.description /></p>
          <@fields.questions />
          <FieldContainer @label='Custom Text Field'>
            <@fields.customTextField />
          </FieldContainer>
        </section>
      </CardContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer class='feedback-form-card'>
        <section>
          <h2>Feedback Form</h2>
          <FieldContainer @label='Title'>
            <@fields.title />
          </FieldContainer>
          <FieldContainer @label='Description'>
            <@fields.description />
          </FieldContainer>
          <FieldContainer @label='Questions'>
            <@fields.questions />
          </FieldContainer>
          <FieldContainer @label='Custom Text Field'>
            <@fields.customTextField />
          </FieldContainer>
        </section>
      </CardContainer>
    </template>
  };
}