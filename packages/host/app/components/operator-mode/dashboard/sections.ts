import { schedule } from '@ember/runloop';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import type { Icon } from '@cardstack/boxel-ui/icons';

import type { ComponentLike } from '@glint/template';

export interface SectionFlyoutSignature {
  Args: {
    // Closes the flyout, as when a pick inside it navigates.
    close: () => void;
    // The id the flyout's visible title takes, which names the flyout.
    titleId: string;
  };
}

// What a dashboard section shows in the rail. A section registers its own
// entry, so a new section adds itself without the rail knowing about it.
export interface DashboardSection {
  id: string;
  label: string;
  icon: Icon;
  // Read as the rail renders, so it follows the section's own count.
  count?: () => number | undefined;
  flyout?: ComponentLike<SectionFlyoutSignature>;
}

interface Registration {
  element: HTMLElement;
  section: DashboardSection;
}

// A section counts as the one being read once its top passes this far down
// the scroller.
const READING_LINE = 0.35;

// Input that scrolls the page by hand, which hands the current section back
// to the scroll-spy after a jump.
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

// Below this width the dashboard tightens its page and the rail stays as
// icons. One measure of the scroller decides both, so they never disagree.
const COMPACT_WIDTH_REM = 80;

// The dashboard's sections, in page order, and the one being read. Sections
// register with `register`, the page's scroller with `trackScroller`, and the
// rail reads `sections` and `currentId` and jumps with `scrollTo`.
export default class DashboardSections {
  @tracked private registrations: Registration[] = [];
  @tracked private spiedId: string | undefined;
  @tracked isCompact = false;

  private scroller: HTMLElement | null = null;

  // After a jump, the section jumped to stays current until the user scrolls:
  // a short last section can't reach the reading line, and a smooth scroll
  // passes over the sections between.
  private heldId: string | undefined;

  // In page order, so a section that moves follows without registering again.
  get sections(): DashboardSection[] {
    return this.ordered.map(({ section }) => section);
  }

  get currentId(): string | undefined {
    let ids = this.registrations.map(({ section }) => section.id);
    return this.spiedId && ids.includes(this.spiedId)
      ? this.spiedId
      : this.sections[0]?.id;
  }

  private get ordered(): Registration[] {
    return [...this.registrations].sort((a, b) =>
      a.element.compareDocumentPosition(b.element) &
      Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );
  }

  // Registration lands after render, so it never writes state the render
  // that installed it has already read.
  register = modifier((element: HTMLElement, [section]: [DashboardSection]) => {
    let registration = { element, section };
    schedule('afterRender', () => {
      this.registrations = [...this.registrations, registration];
      this.readCurrentSection();
    });
    return () => {
      schedule('afterRender', () => {
        this.registrations = this.registrations.filter(
          (r) => r !== registration,
        );
      });
    };
  });

  trackScroller = modifier((scroller: HTMLElement) => {
    this.scroller = scroller;
    let onScroll = () => this.readCurrentSection();
    let release = () => {
      if (this.heldId) {
        this.heldId = undefined;
        this.readCurrentSection();
      }
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    for (let type of USER_SCROLL_EVENTS) {
      scroller.addEventListener(type, release, { passive: true });
    }
    // A resize, or a section growing or shrinking, moves the sections
    // without a scroll.
    let resizeObserver = new ResizeObserver(() => {
      this.readCompact();
      this.readCurrentSection();
    });
    schedule('afterRender', () => this.readCompact());
    resizeObserver.observe(scroller);
    if (scroller.firstElementChild) {
      resizeObserver.observe(scroller.firstElementChild);
    }
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      for (let type of USER_SCROLL_EVENTS) {
        scroller.removeEventListener(type, release);
      }
      resizeObserver.disconnect();
      this.scroller = null;
      this.heldId = undefined;
      schedule('afterRender', () => {
        this.spiedId = undefined;
      });
    };
  });

  scrollTo(id: string) {
    let registration = this.ordered.find(({ section }) => section.id === id);
    if (!registration || !this.scroller) {
      return;
    }
    this.heldId = id;
    this.spiedId = id;
    let behavior: ScrollBehavior = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
      ? 'auto'
      : 'smooth';
    // The first section opens the page, greeting and all, so it goes to the
    // top.
    if (registration === this.ordered[0]) {
      this.scroller.scrollTo({ top: 0, behavior });
    } else {
      registration.element.scrollIntoView({ behavior, block: 'start' });
    }
  }

  private readCompact() {
    if (!this.scroller) {
      return;
    }
    let rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    let isCompact = this.scroller.offsetWidth < COMPACT_WIDTH_REM * rem;
    if (isCompact !== this.isCompact) {
      this.isCompact = isCompact;
    }
  }

  // The page's top is the first section and its bottom the last; between,
  // it's the last section whose top has passed the reading line.
  private readCurrentSection() {
    let scroller = this.scroller;
    let ordered = this.ordered;
    if (!scroller || ordered.length === 0 || this.heldId) {
      return;
    }
    let { scrollTop, scrollHeight, clientHeight } = scroller;
    let current = ordered[0];
    if (scrollTop + clientHeight >= scrollHeight - 1 && scrollTop > 0) {
      current = ordered[ordered.length - 1];
    } else if (scrollTop > 0) {
      let readingLine =
        scroller.getBoundingClientRect().top + clientHeight * READING_LINE;
      for (let registration of ordered) {
        if (registration.element.getBoundingClientRect().top <= readingLine) {
          current = registration;
        }
      }
    }
    if (current.section.id !== this.spiedId) {
      this.spiedId = current.section.id;
    }
  }
}
