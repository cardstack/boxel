import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import ENV from '@cardstack/host/config/environment';
import type {
  CredentialFields,
  CredentialForm,
} from '@cardstack/host/lib/credential-fields';
import { isTrustedMessageOrigin } from '@cardstack/host/utils/trusted-message-origin';

// Hosts the frame on the secure origin that a form's password fields are
// typed into (see `lib/credential-fields.ts`). The frame is meant to be
// invisible: it sits where the fields would, takes the height of its content,
// and draws the fields with the styles in force here, which this component
// reads off its own element and sends over. A layout that changes with the
// space around the fields sets `--credential-layout` to `narrow` here.

interface Signature {
  Element: HTMLDivElement;
  Args: {
    form: CredentialForm;
    fields: CredentialFields;
  };
}

// The text styles the fields inherit from the page.
const INHERITED_PROPERTIES = [
  'color',
  'color-scheme',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-rendering',
  '-webkit-font-smoothing',
];

// The solid colour painted behind `element`, if what shows through there is
// one. The frame paints it too: text on an opaque background is drawn the
// way the page draws its own, where on a transparent one the browser falls
// back to coarser antialiasing.
function backdropColor(element: HTMLElement): string | undefined {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    let style = getComputedStyle(node);
    if (style.backgroundImage !== 'none') {
      return undefined;
    }
    let color = style.backgroundColor;
    let alpha = color.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1];
    if (alpha === undefined) {
      return color;
    }
    if (Number(alpha) !== 0) {
      return undefined;
    }
  }
  return undefined;
}

// Where `frame` falls on the device's pixels. The browser starts a frame's
// content on a whole device pixel and cuts its width down to one, so the
// frame moves its content by the part of a pixel it lost and lays it out at
// the exact width, which puts each edge and glyph where the page would have.
function framePlacement(frame: HTMLIFrameElement) {
  let { left, top, width } = frame.getBoundingClientRect();
  let scale = window.devicePixelRatio || 1;
  let part = (position: number) =>
    (position * scale - Math.floor(position * scale)) / scale;
  return { offset: { x: part(left), y: part(top) }, width };
}

// A frame that never answers still lets a test settle, and fails on what it
// was waiting to see.
const LOAD_WAIT_LIMIT_MS = 15000;

const loadWaiter = buildWaiter('credential-fields:load');

export default class CredentialFieldsFrame extends Component<Signature> {
  <template>
    <div
      class='credential-fields credential-fields--{{@form}}'
      data-test-credential-fields={{@form}}
      ...attributes
      {{this.connectFrame}}
    >
      <iframe
        class='credential-fields-frame'
        src={{this.src}}
        title='Password fields'
        referrerpolicy='no-referrer'
        data-test-credential-fields-frame={{@form}}
      ></iframe>
    </div>
    <style scoped>
      /* Until the frame reports the height of its fields, it takes the
         height they will have, worked out from the same tokens, so nothing
         around it moves when they arrive. A layout that changes that height
         sets --credential-fields-height. */
      .credential-fields {
        --credential-layout: wide;
        --_control: calc(
          var(--boxel-outline-width) * 2 + var(--boxel-form-control-height)
        );
        --_label: calc(var(--boxel-body-font-size) * 1.1);
        --_auth-field: calc(
          var(--boxel-sp) + var(--_label) + var(--boxel-sp-4xs) +
            var(--_control)
        );
        display: block;
        width: 100%;
      }
      .credential-fields--login,
      .credential-fields--cli-login,
      .credential-fields--register,
      .credential-fields--reset {
        --_reserved: calc(var(--_auth-field) * 2);
      }
      .credential-fields--change-password {
        --_reserved: calc(
          var(--_control) * 3 + var(--settings-modal-gap, 0px) * 2
        );
      }
      .credential-fields--confirm-password {
        --_reserved: calc(var(--boxel-sp-4xs) + var(--_control));
      }
      .credential-fields-frame {
        display: block;
        width: 100%;
        height: var(--credential-fields-height, var(--_reserved, 0));
        border: 0;
        background: transparent;
      }
    </style>
  </template>

  private get src() {
    let base = ENV.secureOriginURL.endsWith('/')
      ? ENV.secureOriginURL
      : `${ENV.secureOriginURL}/`;
    let url = new URL('credentials', base);
    url.searchParams.set('form', this.args.form);
    url.searchParams.set('origin', window.location.origin);
    return url.href;
  }

  private connectFrame = modifier((element: HTMLDivElement) => {
    let fields = this.args.fields;
    let frame = element.querySelector('iframe')!;
    let secureOrigin = new URL(ENV.secureOriginURL).origin;
    let requested: string[] | undefined;

    let loadToken: unknown = loadWaiter.beginAsync();
    let endLoadWait = () => {
      if (loadToken) {
        loadWaiter.endAsync(loadToken);
        loadToken = undefined;
      }
    };
    let loadTimer = setTimeout(endLoadWait, LOAD_WAIT_LIMIT_MS);

    let post = (message: Record<string, unknown>) =>
      frame.contentWindow?.postMessage(message, secureOrigin);

    let sendStyle = () => {
      if (!requested) {
        return;
      }
      let computed = getComputedStyle(element);
      post({
        type: 'style',
        properties: Object.fromEntries(
          requested.map((name) => [name, computed.getPropertyValue(name)]),
        ),
        inherited: Object.fromEntries(
          INHERITED_PROPERTIES.map((name) => [
            name,
            computed.getPropertyValue(name),
          ]),
        ),
        backdrop: backdropColor(element),
        ...framePlacement(frame),
      });
    };

    let onMessage = (event: MessageEvent) => {
      if (
        event.source !== frame.contentWindow ||
        !isTrustedMessageOrigin(event.origin, ENV.secureOriginURL)
      ) {
        return;
      }
      let message = event.data;
      if (!message || typeof message !== 'object') {
        return;
      }
      switch (message.type) {
        case 'ready':
          requested = Array.isArray(message.properties)
            ? message.properties.filter(
                (name: unknown): name is string =>
                  typeof name === 'string' && name.startsWith('--'),
              )
            : [];
          sendStyle();
          fields.connect({ post });
          break;
        case 'size':
          frame.style.height = `${Math.max(0, Number(message.height) || 0)}px`;
          if (requested) {
            endLoadWait();
          }
          break;
        default:
          fields.receive(message);
      }
    };
    window.addEventListener('message', onMessage);

    // Layouts that follow the space around the fields change their styles
    // here as that space changes.
    let resizeObserver = new ResizeObserver(sendStyle);
    resizeObserver.observe(element);
    // A layout centred in the window moves the fields as the window resizes.
    window.addEventListener('resize', sendStyle);

    return () => {
      window.removeEventListener('message', onMessage);
      resizeObserver.disconnect();
      window.removeEventListener('resize', sendStyle);
      clearTimeout(loadTimer);
      endLoadWait();
      fields.disconnect();
    };
  });
}
