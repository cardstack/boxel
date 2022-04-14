import Component from '@glint/environment-ember-loose/glimmer-component';

export interface Signature {
  Args: {
    model: Record<string, any> | any;
  };
}

class _CardComponent extends Component<Signature> {}

export type CardComponent = typeof _CardComponent;
export type Format = 'isolated' | 'embedded' | 'edit';

class _Schema {
  // TODO add schema members here...
}
export type Schema = typeof _Schema;

export class Card {
  data: Record<string, any>;
  schema: Schema;
  isolated: CardComponent;
  edit: CardComponent;
  embedded: CardComponent;

  constructor(params: {
    data?: Record<string, any>;
    schema?: Schema;
    isolated?: CardComponent;
    edit?: CardComponent;
    embedded?: CardComponent;
  }) {
    this.data = params.data || {};
    this.schema = params.schema ?? _Schema;
    this.isolated = params.isolated ?? _CardComponent;
    this.edit = params.edit ?? _CardComponent;
    this.embedded = params.embedded ?? _CardComponent;
  }
  async inFormat(format: Format): Promise<CardView> {
    return new CardView(this, format);
  }
}


class _Wrapper extends Component {}

export class CardView {
  constructor(private card: Card, format: Format) {
    let CardComponent = card[format];
    let self: CardView = this;
    this.component = class Wrapper extends Component {
      <template><CardComponent @model={{self.data}}/></template>
    }
  }

  component: typeof _Wrapper;

  get data() {
    return this.card.data;
  }
}

export function contains(field: Card) {
  // TODO unsure how to wire this up....
  return function(target, key) {

  }
}