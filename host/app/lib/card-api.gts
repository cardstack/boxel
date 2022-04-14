import Component from '@glimmer/component';

export interface Signature {
  Args: {
    model: Record<string, any>;
  };
}

class _CardComponent extends Component<Signature> {}

export type CardComponent = typeof _CardComponent;
export type Format = 'isolated' | 'embedded' | 'edit';

export class Card {
  isolated: CardComponent;
  edit: CardComponent;
  embedded: CardComponent;

  constructor(params: {
    isolated?: CardComponent;
    edit?: CardComponent;
    embedded?: CardComponent;
  }) {
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
  constructor(card: Card, format: Format) {
    let CardComponent = card[format];
    let self: CardView = this;
    this.component = class Wrapper extends Component {
      <template><CardComponent @model={{self.model}} /></template>
    }
  }

  component: typeof _Wrapper;

  get model() {
    return { title: 'the title' };
  }
}
