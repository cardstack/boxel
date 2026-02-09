import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { htmlSafe } from '@ember/template';

class AuthenticatedImageTesterIsolated extends Component<
  typeof AuthenticatedImageTester
> {
  get backgroundStyle() {
    let url = this.args.model.imageUrl;
    if (!url) {
      return undefined;
    }
    return htmlSafe(
      `background-image: url("${url}"); background-size: contain; background-repeat: no-repeat; background-position: center;`,
    );
  }

  <template>
    <div class='tester'>
      <h2>Authenticated Image Loading Tester</h2>
      <p class='description'>
        This card tests that the auth service worker injects Authorization
        headers for realm-hosted images. Enter a URL to an image stored in an
        authenticated realm below.
      </p>

      <div class='field-group'>
        <label class='label'>Image URL</label>
        <@fields.imageUrl @format='edit' />
      </div>

      {{#if @model.imageUrl}}
        <div class='tests'>
          <div class='test-section'>
            <h3>&lt;img&gt; tag</h3>
            <p class='hint'>
              Uses a plain &lt;img src&gt; &#8212; the service worker should
              intercept this and add the Authorization header.
            </p>
            <div class='image-container'>
              <img
                class='test-image'
                src={{@model.imageUrl}}
                alt='Test image loaded via img tag'
                loading='lazy'
              />
            </div>
          </div>

          <div class='test-section'>
            <h3>CSS background-image</h3>
            <p class='hint'>
              Uses background-image: url(...) &#8212; the service worker should
              also intercept this.
            </p>
            <div class='image-container'>
              <div
                class='background-image-test'
                role='img'
                aria-label='Test image loaded via CSS background-image'
                style={{this.backgroundStyle}}
              />
            </div>
          </div>
        </div>

        <div class='instructions'>
          <h3>How to verify</h3>
          <ol>
            <li>Open DevTools &rarr; Application &rarr; Service Workers</li>
            <li>Confirm <code>auth-service-worker.js</code> is active</li>
            <li>Open DevTools &rarr; Network tab</li>
            <li>Look for the image request to the realm URL</li>
            <li>Check that the request has an <code>Authorization: Bearer ...</code>
              header</li>
            <li>If both images above render correctly, the service worker is
              working</li>
          </ol>
        </div>
      {{else}}
        <div class='empty-state'>
          Enter a realm image URL above to test. Try a relative path like
          <code>./logo.png</code> or an absolute realm URL.
        </div>
      {{/if}}
    </div>

    <style scoped>
      .tester {
        display: grid;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
        max-width: 720px;
      }

      h2 {
        margin: 0;
        font: 700 var(--boxel-font-lg);
      }

      h3 {
        margin: 0 0 var(--boxel-sp-xs);
        font: 600 var(--boxel-font);
      }

      .description {
        margin: 0;
        color: var(--boxel-500);
        font: var(--boxel-font-sm);
      }

      .field-group {
        display: grid;
        gap: var(--boxel-sp-xxs);
      }

      .label {
        font: 600 var(--boxel-font-sm);
        color: var(--boxel-700);
      }

      .tests {
        display: grid;
        gap: var(--boxel-sp-lg);
      }

      .test-section {
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }

      .hint {
        margin: 0 0 var(--boxel-sp-sm);
        font: var(--boxel-font-xs);
        color: var(--boxel-400);
      }

      .image-container {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 200px;
        background: var(--boxel-50);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }

      .test-image {
        max-width: 100%;
        max-height: 400px;
        object-fit: contain;
      }

      .background-image-test {
        width: 100%;
        height: 300px;
      }

      .instructions {
        background: var(--boxel-50);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }

      .instructions ol {
        margin: var(--boxel-sp-xs) 0 0;
        padding-left: var(--boxel-sp-lg);
      }

      .instructions li {
        font: var(--boxel-font-sm);
        margin-bottom: var(--boxel-sp-xxs);
      }

      .instructions code {
        background: var(--boxel-200);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 0.9em;
      }

      .empty-state {
        padding: var(--boxel-sp-lg);
        text-align: center;
        color: var(--boxel-400);
        background: var(--boxel-50);
        border-radius: var(--boxel-border-radius);
        font: var(--boxel-font-sm);
      }

      .empty-state code {
        background: var(--boxel-200);
        padding: 1px 4px;
        border-radius: 3px;
      }
    </style>
  </template>
}

export default class AuthenticatedImageTester extends CardDef {
  static displayName = 'Authenticated Image Tester';

  @field imageUrl = contains(StringField);

  static isolated = AuthenticatedImageTesterIsolated;
}
