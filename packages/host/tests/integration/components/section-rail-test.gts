import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  click,
  find,
  findAll,
  focus,
  triggerEvent,
  triggerKeyEvent,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { IconPlus } from '@cardstack/boxel-ui/icons';

import SectionRail from '@cardstack/host/components/operator-mode/dashboard/section-rail';
import DashboardSections, {
  type DashboardSection,
  type SectionFlyoutSignature,
} from '@cardstack/host/components/operator-mode/dashboard/sections';

import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

const ShelfFlyout: TemplateOnlyComponent<SectionFlyoutSignature> = <template>
  <span id={{@titleId}}>Shelf picks</span>
</template>;

module('Integration | section-rail', function (hooks) {
  setupRenderingTest(hooks);

  test('lists sections in page order, each named by its tooltip, and names a flyout by its title', async function (assert) {
    let sections = new DashboardSections();
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
      flyout: ShelfFlyout,
    };
    let notes: DashboardSection = {
      id: 'notes',
      label: 'Notes',
      icon: IconPlus,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{! Registered in the reverse of page order. }}
          <section {{sections.register notes}} data-test-notes></section>
          <section {{sections.register shelf}} data-test-shelf></section>
          <SectionRail @sections={{sections}} />
        </template>
      },
    );

    assert.deepEqual(
      findAll('[data-test-section-rail-entry]').map((el) =>
        el.getAttribute('data-test-section-rail-entry'),
      ),
      ['notes', 'shelf'],
      'entries follow the page',
    );
    assert
      .dom(
        '[data-test-section-rail-item="shelf"] [data-test-pretui-tooltip] [role="tooltip"]',
      )
      .hasText('Shelf');
    assert
      .dom('[data-test-section-rail-entry="shelf"]')
      .hasAttribute(
        'aria-labelledby',
        find('[data-test-section-rail-item="shelf"] [role="tooltip"]')!.id,
        'the tooltip names the icon',
      );
    assert
      .dom('[data-test-section-rail-item="notes"] [role="tooltip"]')
      .hasText('Notes');
    assert
      .dom('[data-test-section-rail-entry="notes"]')
      .hasAttribute('aria-current', 'location', 'the first section is current');

    await focus('[data-test-section-rail-entry="shelf"]');
    assert
      .dom('[data-test-section-rail-flyout]')
      .doesNotExist('focus alone leaves the flyout closed');

    // As a browser does for Enter on a button: the key, then its click.
    await triggerKeyEvent(
      '[data-test-section-rail-entry="shelf"]',
      'keydown',
      'Enter',
    );
    await click('[data-test-section-rail-entry="shelf"]');
    assert
      .dom('[data-test-section-rail-entry="shelf"]')
      .hasAttribute('aria-expanded', 'true');
    let flyout = find('[data-test-section-rail-flyout="shelf"]')!;
    let title = document.getElementById(
      flyout.getAttribute('aria-labelledby')!,
    );
    assert.strictEqual(title?.textContent, 'Shelf picks');

    await triggerKeyEvent(
      '[data-test-section-rail-entry="shelf"]',
      'keydown',
      'Enter',
    );
    await click('[data-test-section-rail-entry="shelf"]');
    assert
      .dom('[data-test-section-rail-flyout]')
      .doesNotExist('pressing Enter again closes it');
    assert
      .dom('[data-test-section-rail-entry="shelf"]')
      .hasAttribute('aria-expanded', 'false');
  });

  test('hovering an entry shows its tooltip and opens no flyout; a press opens the flyout and hides the tooltips', async function (assert) {
    let sections = new DashboardSections();
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
      flyout: ShelfFlyout,
    };
    let notes: DashboardSection = {
      id: 'notes',
      label: 'Notes',
      icon: IconPlus,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <section {{sections.register shelf}}></section>
          <section {{sections.register notes}}></section>
          <SectionRail @sections={{sections}} />
        </template>
      },
    );

    const SHELF_TIP =
      '[data-test-section-rail-item="shelf"] [data-test-pretui-tooltip]';
    const NOTES_TIP =
      '[data-test-section-rail-item="notes"] [data-test-pretui-tooltip]';

    await triggerEvent(SHELF_TIP, 'mouseenter');
    assert
      .dom(`${SHELF_TIP} [role="tooltip"]`)
      .hasAttribute('data-open', 'true', 'hover shows the tooltip');
    assert
      .dom('[data-test-section-rail-flyout]')
      .doesNotExist('hover alone opens no flyout');

    await click('[data-test-section-rail-entry="shelf"]');
    assert.dom('[data-test-section-rail-flyout="shelf"]').exists();
    assert
      .dom(`${SHELF_TIP} [role="tooltip"]`)
      .doesNotHaveAttribute('data-open', 'the flyout names it instead');

    await triggerEvent(SHELF_TIP, 'mouseleave');
    await triggerEvent(NOTES_TIP, 'mouseenter');
    assert
      .dom(`${NOTES_TIP} [role="tooltip"]`)
      .doesNotHaveAttribute(
        'data-open',
        'no tooltip shows over the open flyout',
      );

    await click('[data-test-section-rail-entry="shelf"]');
    assert
      .dom('[data-test-section-rail-flyout]')
      .doesNotExist('pressing again closes it');
    assert
      .dom(`${NOTES_TIP} [role="tooltip"]`)
      .hasAttribute('data-open', 'true', 'tooltips come back once it closes');
  });

  test('a press on another entry switches flyouts, and a press outside the rail closes it', async function (assert) {
    let sections = new DashboardSections();
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
      flyout: ShelfFlyout,
    };
    let notes: DashboardSection = {
      id: 'notes',
      label: 'Notes',
      icon: IconPlus,
      flyout: ShelfFlyout,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <section {{sections.register shelf}}></section>
          <section {{sections.register notes}}></section>
          <SectionRail @sections={{sections}} />
          <div data-test-outside></div>
        </template>
      },
    );

    await click('[data-test-section-rail-entry="shelf"]');
    await click('[data-test-section-rail-entry="notes"]');
    assert.dom('[data-test-section-rail-flyout="notes"]').exists();
    assert.dom('[data-test-section-rail-flyout="shelf"]').doesNotExist();

    await triggerEvent('[data-test-outside]', 'pointerdown');
    assert.dom('[data-test-section-rail-flyout]').doesNotExist();
  });

  test('Escape that closes a flyout reaches no other listener on the page', async function (assert) {
    let sections = new DashboardSections();
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
      flyout: ShelfFlyout,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <section {{sections.register shelf}}></section>
          <SectionRail @sections={{sections}} />
        </template>
      },
    );

    let heard = 0;
    let listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        heard++;
      }
    };
    document.addEventListener('keydown', listener);
    try {
      await click('[data-test-section-rail-entry="shelf"]');
      await triggerKeyEvent(document.body, 'keydown', 'Escape');
      assert.dom('[data-test-section-rail-flyout]').doesNotExist();
      assert.strictEqual(heard, 0, 'the page never hears it');

      await triggerKeyEvent(document.body, 'keydown', 'Escape');
      assert.strictEqual(heard, 1, 'with no flyout open, Escape goes on');
    } finally {
      document.removeEventListener('keydown', listener);
    }
  });

  test('marks the section being read as the page scrolls, and holds a jumped-to section until the user scrolls', async function (assert) {
    let sections = new DashboardSections();
    let intro: DashboardSection = {
      id: 'intro',
      label: 'Intro',
      icon: IconPlus,
    };
    let shelf: DashboardSection = {
      id: 'shelf',
      label: 'Shelf',
      icon: IconPlus,
    };
    let notes: DashboardSection = {
      id: 'notes',
      label: 'Notes',
      icon: IconPlus,
    };

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <div class='scroller' {{sections.trackScroller}} data-test-scroller>
            {{! Ahead of the page, as the dashboard's frosted band is. }}
            <div></div>
            <div>
              <section
                class='tall'
                {{sections.register intro}}
                data-test-intro
              ></section>
              <section
                class='tall'
                {{sections.register shelf}}
                data-test-shelf
              ></section>
              {{! Too short to reach the reading line, even at the bottom. }}
              <section class='short' {{sections.register notes}}></section>
            </div>
          </div>
          <SectionRail @sections={{sections}} />
          <style scoped>
            .scroller {
              position: relative;
              height: 10rem;
              overflow-y: auto;
            }
            .tall {
              height: 20rem;
            }
            .short {
              height: 2rem;
            }
          </style>
        </template>
      },
    );

    let scroller = find('[data-test-scroller]') as HTMLElement;
    let scrollTo = async (top: number) => {
      scroller.scrollTop = top;
      await triggerEvent(scroller, 'scroll');
    };
    let current = () =>
      find(
        '[data-test-section-rail-entry][aria-current="location"]',
      )?.getAttribute('data-test-section-rail-entry');
    let maxScrollTop = scroller.scrollHeight - scroller.clientHeight;

    assert.strictEqual(current(), 'intro', 'the top of the page is the first');

    await scrollTo((find('[data-test-shelf]') as HTMLElement).offsetTop);
    assert.strictEqual(current(), 'shelf', 'past the reading line');

    await scrollTo(maxScrollTop);
    assert.strictEqual(
      current(),
      'notes',
      'the bottom of the page is the last',
    );

    await scrollTo(0);
    assert.strictEqual(current(), 'intro');

    await click('[data-test-section-rail-entry="notes"]');
    assert.strictEqual(current(), 'notes', 'a jump marks its section at once');
    await waitUntil(() => scroller.scrollTop >= maxScrollTop - 1, {
      timeout: 5000,
    });

    await scrollTo(0);
    assert.strictEqual(
      current(),
      'notes',
      'a scroll the user did not make keeps the jumped-to section',
    );

    await triggerEvent(scroller, 'wheel');
    assert.strictEqual(
      current(),
      'intro',
      'a scroll by hand hands the section back to the scroll-spy',
    );

    // The reading line sits in the intro, short of the shelf.
    await scrollTo((find('[data-test-shelf]') as HTMLElement).offsetTop / 2);
    assert.strictEqual(current(), 'intro');
    // The intro shrinks and pulls the shelf up past the reading line, with
    // no scroll.
    (find('[data-test-intro]') as HTMLElement).style.height = '5rem';
    await waitUntil(() => current() === 'shelf', { timeout: 2000 });
    assert.strictEqual(current(), 'shelf', 'a section resizing moves the mark');
  });
});
