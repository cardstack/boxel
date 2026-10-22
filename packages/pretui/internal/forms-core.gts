// Pretui — the form contract and FormContext registry shared by Form and its parts.
import { tracked } from '@glimmer/tracking';

// ── The shared contract ──────────────────────────────────────────────────

/** One validation issue, as produced by a BXL guide rule evaluation. */
export interface FormIssue {
  /** BXL label path identifying what failed. Scalars use the field label,
   *  quoted when it contains spaces: `Total`, `"Approver Email"`. Rows use a
   *  predicate path: `"Line Item"[SKU = "COPY-04"].Quantity`. Routing must
   *  therefore match on the WHOLE string, never by splitting on '.'. */
  targetPath: string;
  /** 'error' blocks; anything else is advisory. Unknown values are treated
   *  as 'error' — fail closed, matching the guide contract. */
  severity: 'error' | 'warning' | 'info' | (string & {});
  /** Human-readable, authored by the rule. Render verbatim; never rewrite. */
  message: string;
  /** Optional provenance back to the rule that produced it. */
  ruleId?: string;
}

/** The three commit models a form can run under. See the Form doc comment. */
export type FormMode = 'submit' | 'live' | 'record';

/** The three severities a rendered issue can resolve to. */
export type FormSeverity = 'error' | 'warning' | 'info';

/** Where focus lands when a submit is refused. */
export type FormFocusTarget = 'field' | 'summary' | 'none';

const SEVERITY_RANK: Record<FormSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Resolve a rule-authored severity to one of the three Pretui renders.
 * FAILS CLOSED: anything that is not exactly 'warning' or 'info' — including
 * undefined, '', 'critical', 'ERROR', or a typo — renders as an error and
 * blocks. This mirrors the guide contract, where a rule that cannot be
 * evaluated counts as a failure.
 */
export function normalizeSeverity(severity: string | undefined): FormSeverity {
  return severity === 'warning' || severity === 'info' ? severity : 'error';
}

/** True when the issue blocks a commit (i.e. resolves to 'error'). */
export function isBlocking(issue: FormIssue): boolean {
  return normalizeSeverity(issue.severity) === 'error';
}

/** Errors, then warnings, then info; ties keep their authored order. */
export function sortIssues(issues: readonly FormIssue[]): FormIssue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[normalizeSeverity(a.severity)] -
      SEVERITY_RANK[normalizeSeverity(b.severity)],
  );
}

/**
 * Issues whose targetPath equals `path`, in display order.
 * WHOLE-STRING equality on purpose: a predicate path such as
 * `"Line Item"[SKU = "COPY-04"].Quantity` must never be parsed here.
 */
export function issuesForPath(
  issues: readonly FormIssue[],
  path: string | undefined,
): FormIssue[] {
  if (!path) {
    return [];
  }
  return sortIssues(issues.filter((issue) => issue.targetPath === path));
}

// ── FormContext — the registry a Form yields to its fields ───────────────

/** What a FormField publishes to its form so focus routing can find it. */
export interface FormFieldHandle {
  /** id of the field's root element (the focus fallback). */
  rootId: string;
  /** id handed to the control slot; the preferred focus target. */
  controlId: string;
  /** The field's BXL label path, read live off the component. */
  path: string;
}

/**
 * A set of paths claimed by rendered fields, published SAFELY.
 *
 * Fields register from their constructor — i.e. mid-render — and the
 * ErrorSummary sitting above them has usually already read the set in the
 * same pass, so a synchronous tracked write would trip Ember's
 * backtracking-rerender assertion. The publish is therefore deferred by one
 * MICROTASK (not a timer: the realm law against setTimeout/setInterval/rAF
 * stands), which moves the write into the next revalidation and coalesces
 * however many fields registered in the batch into a single flush.
 *
 * `settled` exists so a consumer can tell "no field has claimed this path"
 * apart from "no field has registered yet" — without it the summary would
 * flash every issue as unrouted on the first paint.
 */
export class ClaimSet {
  @tracked paths: ReadonlySet<string> = new Set<string>();
  @tracked settled = false;

  entries = new Map<string, FormFieldHandle>();
  private scheduled = false;
  private torn = false;

  add(handle: FormFieldHandle): void {
    this.entries.set(handle.rootId, handle);
    this.schedule();
  }
  remove(rootId: string): void {
    this.entries.delete(rootId);
    this.schedule();
  }
  teardown(): void {
    this.torn = true;
  }
  has(path: string): boolean {
    return this.paths.has(path);
  }

  private schedule(): void {
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    Promise.resolve().then(() => {
      this.scheduled = false;
      if (this.torn) {
        return;
      }
      this.paths = new Set([...this.entries.values()].map((e) => e.path));
      this.settled = true;
    });
  }
}

/** The subset of Form that FormContext reads back. */
export interface FormHost {
  mode: FormMode;
  issues: FormIssue[];
  disabled: boolean;
  busy: boolean;
  focusOnInvalid: FormFocusTarget;
}

function isFocusableControl(el: Element | null): el is HTMLElement {
  if (!el) {
    return false;
  }
  // A disabled control cannot take focus; fall through to the field root.
  return (el as HTMLInputElement).disabled !== true;
}

const FOCUSABLE =
  'input,select,textarea,button,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

/**
 * The live state a Form shares with its fields and summary. Constructed by
 * Form, yielded as `form.context`, and accepted by FormField / ErrorSummary
 * as `@form` — which is what makes those two usable stand-alone too.
 */
export class FormContext {
  constructor(private host: FormHost) {}

  /** Set once the user has asked for a commit; gates error display. */
  @tracked submitAttempted = false;
  /** Set the first time anything inside the form emits input/change. */
  @tracked dirty = false;

  private claims = new ClaimSet();
  private summaries: string[] = [];
  /** a summary that was asked for focus before it had rendered */
  private pendingSummaryFocus = false;
  private sections = new Map<string, () => void>();

  /** Snapshot of every path a rendered field has claimed. */
  get claimedPaths(): ReadonlySet<string> {
    return this.claims.paths;
  }
  /** False until the first snapshot lands. */
  get settled(): boolean {
    return this.claims.settled;
  }

  get mode(): FormMode {
    return this.host.mode;
  }
  get issues(): FormIssue[] {
    return this.host.issues;
  }
  get disabled(): boolean {
    return this.host.disabled;
  }
  get busy(): boolean {
    return this.host.busy;
  }
  get focusOnInvalid(): FormFocusTarget {
    return this.host.focusOnInvalid;
  }
  get blockingIssues(): FormIssue[] {
    return this.issues.filter(isBlocking);
  }
  get advisoryIssues(): FormIssue[] {
    return this.issues.filter((issue) => !isBlocking(issue));
  }
  get hasBlockingIssues(): boolean {
    return this.blockingIssues.length > 0;
  }
  get pristine(): boolean {
    return !this.dirty;
  }
  /** Issues whose targetPath matched no rendered field. NEVER dropped — the
   *  ErrorSummary surfaces exactly these. */
  get unroutedIssues(): FormIssue[] {
    if (!this.settled) {
      return [];
    }
    return this.issues.filter(
      (issue) => !this.claimedPaths.has(issue.targetPath),
    );
  }

  issuesFor = (path: string | undefined): FormIssue[] =>
    issuesForPath(this.issues, path);
  isClaimed = (path: string): boolean => this.claimedPaths.has(path);

  markDirty = (): void => {
    if (!this.dirty) {
      this.dirty = true;
    }
  };
  markPristine = (): void => {
    this.dirty = false;
    this.submitAttempted = false;
  };

  registerField(handle: FormFieldHandle): void {
    this.claims.add(handle);
  }
  unregisterField(rootId: string): void {
    this.claims.remove(rootId);
  }
  registerSummary(id: string): void {
    if (!this.summaries.includes(id)) {
      this.summaries.push(id);
    }
  }
  unregisterSummary(id: string): void {
    this.summaries = this.summaries.filter((entry) => entry !== id);
  }
  /** A collapsible FormSection lends the form a way to open itself, so focus
   *  routing can never point at a control behind a closed disclosure. */
  registerSection(id: string, reveal: () => void): void {
    this.sections.set(id, reveal);
  }
  unregisterSection(id: string): void {
    this.sections.delete(id);
  }
  teardown(): void {
    this.claims.teardown();
  }

  /** React Spectrum's headline behavior: a refused submit puts focus on the
   *  first invalid field in DOM order. Falls back to the error summary (and
   *  then to whatever the summary would have pointed at) so an issue with no
   *  rendered field still lands the user somewhere useful. */
  focusInvalid = (): void => {
    if (this.focusOnInvalid === 'none') {
      return;
    }
    if (this.focusOnInvalid === 'summary') {
      let summary = this.summaryElement();
      if (summary) {
        this.reveal(summary);
        return;
      }
      // In submit mode the summary renders only once submitAttempted is set,
      // which is this same tick: it takes the focus as it inserts.
      if (this.summaries.length > 0) {
        this.pendingSummaryFocus = true;
        return;
      }
    }
    let target = this.firstInvalidElement() ?? this.summaryElement();
    this.reveal(target);
  };

  /** True once, for the summary that renders after a focus was requested. */
  takeSummaryFocus(): boolean {
    let pending = this.pendingSummaryFocus;
    this.pendingSummaryFocus = false;
    return pending;
  }

  /** Move focus to one specific path — the ErrorSummary row action. */
  focusPath = (path: string): void => {
    for (let handle of this.claims.entries.values()) {
      if (handle.path === path) {
        this.reveal(this.elementFor(handle));
        return;
      }
    }
  };

  /** Open every collapsed FormSection above `el`, then focus it.
   *
   *  A collapsed section hides its body with `hidden` rather than dropping it
   *  from the DOM (see FormSection), so the field is always registered and its
   *  issues always route — but a hidden control cannot take focus. Flipping
   *  each section's tracked `open` flag is the source of truth; clearing the
   *  attribute on the spot is what makes focus land in THIS tick instead of
   *  after the next render, and the render then writes back the same value. */
  private reveal(el: HTMLElement | null): void {
    if (!el) {
      return;
    }
    let node = el.closest<HTMLElement>('[data-pretui-form-section]');
    while (node) {
      let id = node.getAttribute('data-pretui-form-section');
      if (id) {
        this.sections.get(id)?.();
      }
      let body = node.querySelector<HTMLElement>(
        ':scope > [data-pretui-form-section-body]',
      );
      if (body) {
        body.hidden = false;
      }
      node =
        node.parentElement?.closest<HTMLElement>(
          '[data-pretui-form-section]',
        ) ?? null;
    }
    el.focus();
  }

  private summaryElement(): HTMLElement | null {
    for (let id of this.summaries) {
      let el = document.getElementById(id);
      if (el) {
        return el;
      }
    }
    return null;
  }

  private firstInvalidElement(): HTMLElement | null {
    let blocking = new Set(
      this.blockingIssues.map((issue) => issue.targetPath),
    );
    let found: HTMLElement[] = [];
    for (let handle of this.claims.entries.values()) {
      if (!blocking.has(handle.path)) {
        continue;
      }
      let el = this.elementFor(handle);
      if (el) {
        found.push(el);
      }
    }
    // Registration order follows construction order, which is usually DOM
    // order — but conditionals and re-renders can break that, so sort by the
    // real document position rather than trusting it.
    found.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    return found[0] ?? null;
  }

  private elementFor(handle: FormFieldHandle): HTMLElement | null {
    let control = document.getElementById(handle.controlId);
    if (isFocusableControl(control)) {
      return control;
    }
    let root = document.getElementById(handle.rootId);
    if (!root) {
      return control;
    }
    // The caller's control slot may not have taken the yielded id. Look for
    // anything focusable inside the control region only — scoping to
    // [data-pretui-form-control] keeps the help button out of the running.
    let candidate = root.querySelector<HTMLElement>(
      `[data-pretui-form-control] :is(${FOCUSABLE})`,
    );
    // The root itself carries tabindex="-1" as the last resort.
    return candidate ?? root;
  }
}
