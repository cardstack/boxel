import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

/**
 * Planes as iframes — the smallest cross-DOM choreography experiment
 * (docs/plane-frames-prototype.md; research lead in
 * docs/planes-as-iframes-note.md).
 *
 * Four documents, one screen:
 *   plane 1 (app)     — inert app chrome, its own process and clock
 *   plane 2 (Panel A) — a bento panel of bays
 *   plane 3 (Panel B) — its twin
 *   plane 4 (overlay) — the carried card and nothing else, pointer-events
 *                       none: it is a visual, never an input surface
 *
 * A drag never leaves the panel that owns the gesture — pointer capture
 * keeps events flowing to the source document even outside its bounds.
 * What crosses documents is an inert card record and page-space geometry;
 * the card VISUAL teleports into the overlay for the carry and into the
 * receiving panel at the drop, each redraw hidden by a crossfade.
 *
 * The protocol edge is shaped on the boxel sandbox surface API: bootstrap
 * announce over window.postMessage, then all authority on a transferred
 * MessagePort; enveloped, version-checked, type-guarded messages; confirms
 * carry a requestId and time out rather than hang (silence after a request
 * is a protocol violation, not a state).
 */

const PROTOCOL = 1;
const CONFIRM_TIMEOUT_MS = 3000;

interface PageRect {
  height: number;
  width: number;
  x: number;
  y: number;
}
interface PagePoint {
  x: number;
  y: number;
}
export interface PlaneCard {
  accent: string;
  id: string;
  note: string;
  title: string;
}
type PlaneName = 'app' | 'overlay' | 'panel-a' | 'panel-b';
type PanelName = 'panel-a' | 'panel-b';

interface Envelope {
  [key: string]: unknown;
  kind: string;
  protocolVersion: number;
}

function isEnvelope(value: unknown): value is Envelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Envelope).kind === 'string' &&
    (value as Envelope).protocolVersion === PROTOCOL
  );
}

function contains(rect: PageRect, point: PagePoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * One plane's edge as the host sees it: the iframe, its port, a pending map
 * for confirmed requests. The host owns every plane's geometry — a child
 * only ever learns where it sits from `plane-geometry`, never from ambient
 * DOM.
 */
class PlaneLink {
  element: HTMLIFrameElement;
  name: PlaneName;
  onMessage: (msg: Envelope) => void;
  port: MessagePort | null = null;
  ready = false;

  private nextRequest = 0;
  private pending = new Map<
    string,
    {
      reject: (error: Error) => void;
      resolve: (msg: Envelope) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    name: PlaneName,
    element: HTMLIFrameElement,
    onMessage: (msg: Envelope) => void
  ) {
    this.name = name;
    this.element = element;
    this.onMessage = onMessage;
  }

  adopt(port: MessagePort): void {
    this.port = port;
    port.addEventListener('message', (event: MessageEvent) => {
      const msg: unknown = event.data;
      if (!isEnvelope(msg)) {
        return;
      }
      if (msg.kind === 'plane-ready') {
        this.ready = true;
        return;
      }
      if (msg.kind === 'plane-ack') {
        const entry = this.pending.get(msg['requestId'] as string);
        if (entry) {
          this.pending.delete(msg['requestId'] as string);
          clearTimeout(entry.timeout);
          entry.resolve(msg);
        }
        return;
      }
      this.onMessage(msg);
    });
    port.start();
  }

  destroy(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error(`plane ${this.name} was destroyed`));
    }
    this.pending.clear();
    this.port?.close();
    this.port = null;
  }

  rect(): PageRect {
    const b = this.element.getBoundingClientRect();
    return { height: b.height, width: b.width, x: b.x, y: b.y };
  }

  /** Confirmed request: resolves on the child's ack, rejects on silence. */
  request(msg: Record<string, unknown>): Promise<Envelope> {
    const requestId = `${this.name}:${++this.nextRequest}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `plane ${this.name} did not confirm ${String(msg['kind'])} within ${CONFIRM_TIMEOUT_MS}ms`
          )
        );
      }, CONFIRM_TIMEOUT_MS);
      this.pending.set(requestId, { reject, resolve, timeout });
      this.send({ ...msg, requestId });
    });
  }

  send(msg: Record<string, unknown>): void {
    this.port?.postMessage({ protocolVersion: PROTOCOL, ...msg });
  }

  syncGeometry(): void {
    this.send({ kind: 'plane-geometry', rect: this.rect() });
  }
}

const PANEL_A_CARDS: PlaneCard[] = [
  {
    accent: '#22d3ee',
    id: 'atlas',
    note: 'A live document rendered in its own process.',
    title: 'Atlas',
  },
  {
    accent: '#a78bfa',
    id: 'kiln',
    note: 'Grab the grip and carry it across the seam.',
    title: 'Kiln',
  },
];
const PANEL_B_CARDS: PlaneCard[] = [
  {
    accent: '#fbbf24',
    id: 'meridian',
    note: 'Drops travel the other way too.',
    title: 'Meridian',
  },
];

interface CarryState {
  card: PlaneCard;
  from: PanelName;
  origin: PageRect;
  /** the bay the pointer is over right now, if it can take the card */
  target: { bay: number; bounds: PageRect; panel: PanelName } | null;
}

export class PlaneHost extends Component {
  @tracked phase: 'carrying' | 'idle' | 'landing' = 'idle';
  @tracked status = 'booting planes…';

  carry: CarryState | null = null;
  hover: PanelName | null = null;
  planes = new Map<PlaneName, PlaneLink>();
  /** serializes begin → move → end so a fast drop can't outrun its start */
  sequence: Promise<void> = Promise.resolve();

  constructor(owner: Owner, args: Record<string, never>) {
    super(owner, args);
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>)['__planeHost'] = this;
    }
    registerDestructor(this, () => {
      for (const plane of this.planes.values()) {
        plane.destroy();
      }
      this.planes.clear();
    });
  }

  panel(name: PanelName): PlaneLink {
    const plane = this.planes.get(name);
    if (!plane) {
      throw new Error(`panel ${name} is not connected`);
    }
    return plane;
  }

  /**
   * Bootstrap handshake, boxel-style: the child announces `plane-listening`
   * up through window.postMessage; the host answers with `plane-connect`
   * carrying one end of a private MessageChannel; everything after rides
   * the port.
   */
  attach = modifier((element: HTMLIFrameElement, [name]: [PlaneName]) => {
    const link = new PlaneLink(name, element, (msg) => this.route(name, msg));
    this.planes.set(name, link);

    const receive = (event: MessageEvent) => {
      const msg: unknown = event.data;
      if (
        event.source !== element.contentWindow ||
        !isEnvelope(msg) ||
        msg.kind !== 'plane-listening'
      ) {
        return;
      }
      window.removeEventListener('message', receive);
      const channel = new MessageChannel();
      link.adopt(channel.port1);
      element.contentWindow?.postMessage(
        { kind: 'plane-connect', protocolVersion: PROTOCOL },
        '*',
        [channel.port2]
      );
      link.syncGeometry();
      if (name === 'panel-a') {
        link.send({
          cards: PANEL_A_CARDS,
          kind: 'panel-init',
          label: 'plane 2 · its own document',
          tag: 'PANEL A',
        });
      } else if (name === 'panel-b') {
        link.send({
          cards: PANEL_B_CARDS,
          kind: 'panel-init',
          label: 'plane 3 · its own document',
          tag: 'PANEL B',
        });
      }
      if ([...this.planes.values()].every((p) => p.port !== null)) {
        this.status = 'four planes connected — drag a card';
      }
    };
    window.addEventListener('message', receive);

    const observer = new ResizeObserver(() => link.syncGeometry());
    observer.observe(element);
    const onResize = () => link.syncGeometry();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('message', receive);
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      link.destroy();
      this.planes.delete(name);
    };
  });

  route(name: PlaneName, msg: Envelope): void {
    if (name !== 'panel-a' && name !== 'panel-b') {
      return;
    }
    switch (msg.kind) {
      case 'drag-start':
        this.sequence = this.sequence.then(() =>
          this.beginCarry(name, msg).catch((error: Error) =>
            this.recover(error)
          )
        );
        break;
      case 'drag-move':
        if (this.carry?.from === name) {
          this.moveCarry(msg['point'] as PagePoint);
        }
        break;
      case 'drop-target':
        // only the panel currently hovered may set the target — a stale
        // reply from the panel just left must not clobber it
        if (this.carry !== null && this.hover === name) {
          this.carry.target =
            msg['bay'] === null
              ? null
              : {
                  bay: msg['bay'] as number,
                  bounds: msg['bounds'] as PageRect,
                  panel: name,
                };
        }
        break;
      case 'drag-end':
        if (this.carry !== null && this.carry.from !== name) {
          break;
        }
        this.sequence = this.sequence.then(() =>
          this.endCarry(msg['point'] as PagePoint).catch((error: Error) =>
            this.recover(error)
          )
        );
        break;
    }
  }

  async beginCarry(from: PanelName, msg: Envelope): Promise<void> {
    if (this.carry !== null) {
      return;
    }
    const card = msg['card'] as PlaneCard;
    const origin = msg['bounds'] as PageRect;
    this.carry = { card, from, origin, target: null };
    // teleport #1: the overlay redraws the card at the source's page rect;
    // only once it confirms does the source ghost its original
    await this.planes.get('overlay')?.request({
      bounds: origin,
      card,
      grab: msg['grab'],
      kind: 'carry-start',
    });
    this.panel(from).send({ cardId: card.id, kind: 'carry-confirmed' });
    for (const p of ['panel-a', 'panel-b'] as const) {
      this.panel(p).send({ kind: 'invite', on: true });
    }
    this.phase = 'carrying';
    this.status = `carrying ${card.title} out of ${from === 'panel-a' ? 'Panel A' : 'Panel B'}`;
  }

  moveCarry(point: PagePoint): void {
    if (this.phase !== 'carrying' || this.carry === null) {
      return;
    }
    this.planes.get('overlay')?.send({ kind: 'carry-move', point });
    const over =
      (['panel-a', 'panel-b'] as const).find((p) =>
        contains(this.panel(p).rect(), point)
      ) ?? null;
    if (this.hover !== null && this.hover !== over) {
      this.panel(this.hover).send({ kind: 'drag-leave' });
    }
    this.hover = over;
    if (over !== null) {
      this.panel(over).send({ kind: 'drag-over', point });
    } else if (this.carry.target !== null) {
      this.carry.target = null;
    }
  }

  async endCarry(_point: PagePoint): Promise<void> {
    const carry = this.carry;
    if (carry === null) {
      return;
    }
    this.phase = 'landing';
    const overlay = this.planes.get('overlay');
    const target =
      carry.target !== null && this.hover === carry.target.panel
        ? carry.target
        : null;
    if (target !== null) {
      // teleport #2: the receiver redraws the card in its bay (hidden),
      // reports the landed rect, the overlay flies there, and the
      // reveal-under-fade crossfade swallows the seam
      const adopted = await this.panel(target.panel).request({
        bay: target.bay,
        card: carry.card,
        kind: 'adopt',
      });
      await overlay?.request({
        bounds: adopted['bounds'],
        kind: 'land',
      });
      this.panel(target.panel).send({ cardId: carry.card.id, kind: 'reveal' });
      this.panel(carry.from).send({ cardId: carry.card.id, kind: 'release' });
      this.status = `${carry.card.title} landed in ${target.panel === 'panel-a' ? 'Panel A' : 'Panel B'}`;
    } else {
      await overlay?.request({ bounds: carry.origin, kind: 'carry-cancel' });
      this.panel(carry.from).send({ cardId: carry.card.id, kind: 'restore' });
      this.status = `${carry.card.title} went home`;
    }
    this.settle();
  }

  recover(error: Error): void {
    if (this.carry !== null) {
      this.panel(this.carry.from).send({
        cardId: this.carry.card.id,
        kind: 'restore',
      });
    }
    this.status = `recovered: ${error.message}`;
    this.settle();
  }

  settle(): void {
    this.carry = null;
    this.hover = null;
    this.phase = 'idle';
    for (const p of ['panel-a', 'panel-b'] as const) {
      this.planes.get(p)?.send({ kind: 'invite', on: false });
    }
  }

  <template>
    <div class="plane-stage">
      <iframe
        title="plane 1 — app"
        class="plane plane-app"
        src="/planes/plane.html?role=app"
        {{this.attach "app"}}
      ></iframe>
      <iframe
        title="plane 2 — Panel A"
        class="plane plane-panel plane-panel-a"
        src="/planes/plane.html?role=panel&name=a"
        {{this.attach "panel-a"}}
      ></iframe>
      <iframe
        title="plane 3 — Panel B"
        class="plane plane-panel plane-panel-b"
        src="/planes/plane.html?role=panel&name=b"
        {{this.attach "panel-b"}}
      ></iframe>
      <iframe
        title="plane 4 — carry overlay"
        class="plane plane-overlay"
        src="/planes/plane.html?role=overlay"
        {{this.attach "overlay"}}
      ></iframe>
      <div class="plane-hud" data-phase={{this.phase}}>
        <span class="plane-hud-dot"></span>{{this.status}}
      </div>
    </div>
  </template>
}
