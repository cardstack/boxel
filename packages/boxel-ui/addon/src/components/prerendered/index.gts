import Component from '@glimmer/component';

interface Signature {
  Args: {
    css?: string;
    html?: string;
  };
  Blocks: {
    default: [];
  };
}

export default class Prerendered extends Component<Signature> {
  constructor(owner: unknown, args: Signature['Args']) {
    super(owner, args);

    if (this.args.css) {
      let styleElement = document.createElement('style');
      document.head.appendChild(styleElement);
      styleElement.textContent = this.args.css;
      let randomId = Math.random().toString(36).substring(7);
      styleElement.setAttribute('data-prerendered-card-css', randomId);
    }
  }

  <template>
    {{! Ideally, rendering passed in css would look like this: }}

    {{!--  <style unscoped>
              {{@css}}
            </style>
    --}}

    {{! but using \`unscoped\` attribute produces the following build error in host:
          (Build Error (PackagerRunner) in ../../../../boxel-ui/addon/dist/index-629a5edd.js
          Module not found: Error: @cardstack/boxel-ui is trying to import from style-loader!css-loader!glimmer-scoped-css but that is not one of its explicit dependencies) }}

    {{! We are using a workaround with the constructor until we fix the above - tracking this issue in CS-6989  }}

    {{{@html}}}

    {{yield}}
  </template>
}
