import { setupRenderingTest } from 'ember-qunit';
import { module } from 'qunit';
import { test } from 'qunit';
import { renderComponent } from '../../helpers/render-component';
import PrerenderedCardComponent from '@cardstack/host/components/prerendered';

module('Integration | prerendered-card-component', function (hooks) {
  setupRenderingTest(hooks);

  test('it renders a prerendered card', async function (assert) {
    let prerenderedCard1 = {
      url: 'http://test-realm/person/michael.json',
      html: "<div class='person-container'><div class='person'>Michael</div></div>",
      cssModuleUrls: [
        encodeUrl('.person-container { border: 1px solid red; }'),
        encodeUrl('.person { color: red; }'),
      ],
    };

    let prerenderedCard2 = {
      url: 'http://test-realm/person/scotty.json',
      html: "<div class='person-container'><div class='person'>Scotty</div></div>",
      cssModuleUrls: [
        encodeUrl('.person-container { border: 1px solid red; }'),
        encodeUrl('.person { color: red; }'),
        encodeUrl('.footer { size: 12px; }'),
      ],
    };

    let cardsWithCssLoaded = 0;

    let onCssLoaded = () => {
      cardsWithCssLoaded++;
    };

    await renderComponent(<template>
      <PrerenderedCardComponent
        @card={{prerenderedCard1}}
        @onCssLoaded={{onCssLoaded}}
      />
      <PrerenderedCardComponent
        @card={{prerenderedCard2}}
        @onCssLoaded={{onCssLoaded}}
      />

      {{! Repeat to test that css does not get inserted twice }}
      <PrerenderedCardComponent
        @card={{prerenderedCard1}}
        @onCssLoaded={{onCssLoaded}}
      />
      <PrerenderedCardComponent
        @card={{prerenderedCard2}}
        @onCssLoaded={{onCssLoaded}}
      />
    </template>);

    while (cardsWithCssLoaded < 4) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.dom('.person-container').exists({ count: 4 });

    let assertOnlyOneStyleTagExistsWithContent = (
      styleTags: NodeListOf<HTMLStyleElement>,
      content: string,
    ) => {
      let tags = Array.from(styleTags).filter((tag) =>
        tag.textContent?.includes(content),
      );
      assert.strictEqual(tags.length, 1);
    };

    let styleTags = document.querySelectorAll('style');

    assertOnlyOneStyleTagExistsWithContent(
      styleTags,
      '.person-container { border: 1px solid red; }',
    );
    assertOnlyOneStyleTagExistsWithContent(
      styleTags,
      '.person { color: red; }',
    );
    assertOnlyOneStyleTagExistsWithContent(
      styleTags,
      '.footer { size: 12px; }',
    );
  });
});

function encodeUrl(
  css: string,
  baseUrl = 'http://localhost:4201/drafts/person.gts',
) {
  // Encode the CSS to Base64
  let encodedCss = btoa(css)
    // Make Base64 URL-safe
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${baseUrl}.${encodedCss}.glimmer-scoped.css`;
}
