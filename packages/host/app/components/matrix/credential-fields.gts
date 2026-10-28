import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import ENV from '@cardstack/host/config/environment';
import {
  credentialFieldsURL,
  type CredentialFields,
  type CredentialForm,
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

// The nearest container `element` scrolls in, when it has more to show than
// fits. The browser draws such a container's content as a layer of its own,
// which changes how both the page's text and the frame's line up.
function scroller(element: HTMLElement): HTMLElement | undefined {
  for (let node = element.parentElement; node; node = node.parentElement) {
    let { overflowX, overflowY } = getComputedStyle(node);
    if (
      /auto|scroll/.test(`${overflowX} ${overflowY}`) &&
      (node.scrollHeight > node.clientHeight ||
        node.scrollWidth > node.clientWidth)
    ) {
      return node;
    }
  }
  return undefined;
}

// The solid colour painted behind `element`, if what shows through there is
// one. The frame paints it too: text on an opaque background is drawn the
// way the page draws its own, where on a transparent one the browser falls
// back to coarser antialiasing. Text in a scrolling layer with no colour of
// its own gets the coarser antialiasing in the page too, so the frame keeps
// a transparent background there.
function backdropColor(element: HTMLElement): string | undefined {
  let scrolling = scroller(element);
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
    if (Number(alpha) !== 0 || node === scrolling) {
      return undefined;
    }
  }
  return undefined;
}

// The browser draws a frame's content from a whole pixel, where the fields
// it stands in for may start part of the way into one. So the frame box is
// put on the whole pixel at or before where the fields start, and made wide
// and tall enough to cover them, and the frame moves its content forward by
// the part of a pixel the box moved, at the width the fields have here. Each
// edge and glyph then lands where the page would have drawn it. In the page
// itself that pixel is a CSS pixel: a frame on a whole device pixel part of
// the way into a CSS pixel still draws its content off by one. In a
// scrolling layer it is a device pixel, counted from where the layer's
// content starts.
function placeFrame(element: HTMLElement, frame: HTMLIFrameElement) {
  let { left, top, width, height } = element.getBoundingClientRect();
  let origin = { x: 0, y: 0 };
  let pixel = 1;
  let scrolling = scroller(element);
  if (scrolling) {
    let box = scrolling.getBoundingClientRect();
    origin = {
      x: box.left + scrolling.clientLeft - scrolling.scrollLeft,
      y: box.top + scrolling.clientTop - scrolling.scrollTop,
    };
    pixel = 1 / (window.devicePixelRatio || 1);
  }
  let part = (position: number) =>
    position - Math.floor(position / pixel) * pixel;
  let offset = { x: part(left - origin.x), y: part(top - origin.y) };
  frame.style.left = `${-offset.x}px`;
  frame.style.top = `${-offset.y}px`;
  frame.style.width = `${Math.ceil(width + offset.x)}px`;
  frame.style.height = `${Math.ceil(height + offset.y)}px`;
  return { offset, width };
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
        position: relative;
        display: block;
        width: 100%;
        height: var(--credential-fields-height, var(--_reserved, 0));
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
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border: 0;
        background: transparent;
      }
    </style>
  </template>

  private get src() {
    return credentialFieldsURL(
      ENV.secureOriginURL,
      this.args.form,
      window.location.origin,
    );
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

    // Off the page, the element has no styles to read, and the frame would
    // draw the fields in none.
    let sendStyle = () => {
      if (!requested || !element.isConnected) {
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
        ...placeFrame(element, frame),
      });
    };

    // Script in this page can dispatch a MessageEvent of its own that names
    // any origin and source; only one the browser delivered is the frame's.
    let onMessage = (event: MessageEvent) => {
      if (
        !event.isTrusted ||
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
          element.style.height = `${Math.max(0, Number(message.height) || 0)}px`;
          sendStyle();
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
    // A stylesheet the page loads after the frame was styled can change the
    // values it was sent. Its `load` does not bubble, so it is heard on the
    // way down.
    let onStylesheetLoad = (event: Event) => {
      if (
        event.target instanceof HTMLLinkElement &&
        event.target.rel === 'stylesheet'
      ) {
        sendStyle();
      }
    };
    document.addEventListener('load', onStylesheetLoad, true);

    return () => {
      window.removeEventListener('message', onMessage);
      resizeObserver.disconnect();
      window.removeEventListener('resize', sendStyle);
      document.removeEventListener('load', onStylesheetLoad, true);
      clearTimeout(loadTimer);
      endLoadWait();
      fields.disconnect();
    };
  });
}
