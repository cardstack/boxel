import { Component } from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { associateDestroyableChild, destroy } from '@ember/destroyable';
import { TessarRecord } from './tessar';

// Correct, explicitly paged read-time reference for the same synthetic output.
// It intentionally follows the dashboard's broad type-search/getCards pattern.
// There is no fixed page-count cutoff: the entire result must be available.
export class TessarGetCardsPage extends TessarRecord {
  static isolated = class extends Component<typeof TessarGetCardsPage> {
    @tracked pages: Record<string, any[]> = {};
    @tracked loading = true;
    @tracked error = '';
    @tracked freshnessPending = false;
    private resourceOwner?: object;
    private loadRevision = 0;
    private unsubscribe?: () => void;
    private offline = () => {
      this.freshnessPending = true;
    };
    private online = () => {
      this.load();
    };

    constructor(owner: unknown, args: any) {
      super(owner, args);
      if (!(globalThis as any).__boxelRenderContext) {
        // The incumbent's resource loading flag does not expose the interval
        // between an async source acknowledgement and index notification.
        // The corrected reference uses the host event bus for that interval,
        // and re-queries complete pages on publication/reconnect.
        this.unsubscribe = (
          globalThis as any
        )._CARDSTACK_REALM_SUBSCRIBE?.subscribe(
          new URL('./', import.meta.url).href,
          (event: any) => {
            if (event.eventName === 'update') this.freshnessPending = true;
            if (event.eventName === 'index') this.load();
          },
        );
        window.addEventListener('offline', this.offline);
        window.addEventListener('online', this.online);
        this.load();
      }
    }

    willDestroy() {
      this.loadRevision++;
      this.unsubscribe?.();
      window.removeEventListener('offline', this.offline);
      window.removeEventListener('online', this.online);
      super.willDestroy();
    }

    async load() {
      const revision = ++this.loadRevision;
      this.loading = true;
      this.error = '';
      const resourceOwner = {};
      associateDestroyableChild(this, resourceOwner);
      try {
        let context = (this.args as any).context;
        let getCards = context?.getCards ?? context?.actions?.getCards;
        if (!getCards) throw new Error('Tessar getCards context is missing');
        let realm = new URL('./', import.meta.url).href;
        let module = new URL('./tessar', import.meta.url).href;
        let pages: Record<string, any[]> = {};
        for (let name of ['Student', 'Slot', 'Observation', 'Report']) {
          pages[name] = [];
          for (let number = 0; ; number++) {
            let resource = getCards(
              resourceOwner,
              () => ({
                filter: { type: { module, name } },
                page: { size: 100, number },
              }),
              () => [realm],
            );
            let deadline = Date.now() + 30_000;
            // Resources begin their asynchronous task on the following turn.
            await new Promise((resolve) => setTimeout(resolve, 0));
            while (resource.isLoading) {
              if (revision !== this.loadRevision) return;
              if (Date.now() >= deadline)
                throw new Error('Tessar getCards page timed out');
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            if (resource.errors?.length || resource.queryErrors?.length)
              throw new Error('Tessar getCards page failed');
            if (!Array.isArray(resource.instances))
              throw new Error('Tessar getCards page has no instances');
            pages[name].push(resource);
            if (resource.instances.length < 100) break;
          }
        }
        if (revision !== this.loadRevision) return;
        const previousOwner = this.resourceOwner;
        this.resourceOwner = resourceOwner;
        this.pages = pages;
        this.freshnessPending = false;
        if (previousOwner) destroy(previousOwner);
      } catch (error: any) {
        if (revision === this.loadRevision) this.error = error.message;
      } finally {
        if (resourceOwner !== this.resourceOwner) destroy(resourceOwner);
        if (revision === this.loadRevision) this.loading = false;
      }
    }

    get pending() {
      return (
        this.loading ||
        this.freshnessPending ||
        Object.values(this.pages).some((pages) =>
          pages.some((resource) => resource.isLoading),
        )
      );
    }

    get tessarState() {
      return this.error ? 'error' : this.pending ? 'pending' : 'ready';
    }

    matching(type: string, day = true): any[] {
      let owner = this.args.model;
      return (this.pages[type] ?? [])
        .flatMap((resource) => resource.instances)
        .filter(
          (item) =>
            item.classroomKey === owner.classroomKey &&
            (!day || item.day === owner.day),
        );
    }

    get stats() {
      let observations = this.matching('Observation');
      let reports = this.matching('Report');
      return [
        {
          key: 'studentCount',
          label: 'Students',
          value: this.matching('Student', false).length,
        },
        {
          key: 'slotCount',
          label: 'Sessions',
          value: this.matching('Slot').length,
        },
        {
          key: 'observationCount',
          label: 'Observations',
          value: observations.length,
        },
        { key: 'reportCount', label: 'Reports', value: reports.length },
        {
          key: 'readyReportCount',
          label: 'Ready reports',
          value: reports.filter((item) => item.status === 'ready').length,
        },
        {
          key: 'scoreTotal',
          label: 'Score total',
          value: observations.reduce((sum, item) => sum + item.score, 0),
        },
      ];
    }

    get rows() {
      return this.matching('Slot')
        .sort((a, b) => a.sequence - b.sequence)
        .map((slot) => ({
          sourceId: `Slot/${String(slot.sequence).padStart(5, '0')}`,
          label: slot.label,
          studentLabel: slot.student?.label,
          referenceLabel: slot.reference?.label,
          status: slot.status,
        }));
    }

    <template>
      <article class='tessar-dashboard' data-tessar-state={{this.tessarState}}>
        <h1>Tessar Classroom Board</h1>
        <p>{{@model.classroomKey}} · {{@model.day}}</p>
        {{#if this.error}}
          <p role='alert'>{{this.error}}</p>
        {{else if this.pending}}
          <p role='status'>Updating classroom results…</p>
        {{else}}
          <dl>
            {{#each this.stats as |stat|}}
              <dt>{{stat.label}}</dt><dd
                data-tessar-stat={{stat.key}}
              >{{stat.value}}</dd>
            {{/each}}
          </dl>
          <table>
            <thead><tr><th>Session</th><th>Student</th><th>Resource</th><th
                >Status</th></tr></thead>
            <tbody>
              {{#each this.rows as |row|}}
                <tr data-tessar-source={{row.sourceId}}>
                  <td>{{row.label}}</td><td>{{row.studentLabel}}</td><td
                  >{{row.referenceLabel}}</td><td>{{row.status}}</td>
                </tr>
              {{/each}}
            </tbody>
          </table>
        {{/if}}
      </article>
      <style scoped>
        .tessar-dashboard {
          padding: 1.5rem;
          color: #142b3c;
          background: #f7fafc;
        }
        dl {
          display: grid;
          grid-template-columns: 1fr 1fr;
          max-width: 24rem;
        }
        dd {
          font-variant-numeric: tabular-nums;
        }
        th,
        td {
          text-align: left;
          padding: 0.5rem 1rem;
          border-bottom: 0.0625rem solid #ccd6de;
        }
      </style>
    </template>
  };
}
