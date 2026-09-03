import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import type { CardContext } from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { consume } from 'ember-provide-consume-context';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';
import {
  BoxelInput,
  Button,
  FilterList,
  ProgressBar,
} from '@cardstack/boxel-ui/components';
import type { Filter } from '@cardstack/boxel-ui/components';
import { cssVar, eq, or } from '@cardstack/boxel-ui/helpers';
import {
  identifyCard,
  CardCrudFunctionsContextName,
  type CardCrudFunctions,
  type getCards,
} from '@cardstack/runtime-common';
import type Owner from '@ember/owner';
import ScaleIcon from '@cardstack/boxel-icons/scale';
import TriangleAlertIcon from '@cardstack/boxel-icons/triangle-alert';

import { Contract } from './contract';
import { contractTypeLabel } from './contract-type';
import {
  CONTRACT_STATUSES,
  contractStatusOption,
  contractStatusLabel,
} from './contract-status';
import { DUE_SOON_DAYS, Obligation, obligationStateLabel } from './obligation';
import { Clause } from './clause';
import { ContractClause } from './contract-clause';
import { ApprovalRule, evaluateRules } from './approval-rule';
import { AuditEntry, auditActionHue, auditActionLabel } from './audit-entry';
import { ContractVersion } from './contract-version';
import { ContractTemplate } from './contract-template';
import {
  ContractRequest,
  requestStateHue,
  requestStateLabel,
} from './contract-request';
import { VersionDiff } from './components/version-diff';
import { Signatory } from './signatory';
import { Employee } from './employee';
import { riskGradeLabel } from './contract-risk';
import { formatMoney } from './money';
import { CollectionPanel } from './components/collection-panel';
import { StatePill } from './components/state-pill';
import { Table, type TableColumn } from './table';
import type { Hue } from './utils/index';
import { LegalHome } from './components/legal-home';
import { ContractWorkspace } from './components/contract-workspace';
import { SignatureBlockView } from './components/signature-block-view';
import RequestSignatureCommand from './commands/request-signature-command';
import VerifySignatureCommand from './commands/verify-signature-command';
import ExecuteContractCommand from './commands/execute-contract-command';
import GenerateDocumentCommand from './commands/generate-document-command';

/**
 * Contract Execution — the app that composes the contract blocks.
 *
 * WHAT THIS CARD DOES NOT DO, on purpose:
 *
 *   - It holds no `linksToMany` collections. Every pane is a live realm query,
 *     so a contract created by a command appears without a reload and two
 *     panes can never disagree about what exists.
 *   - It renders no table, no search box and no create button of its own.
 *     Repository, Clauses and Signatories are all `CollectionPanel`, which
 *     already carries query + search + grid/table switch + create. The two
 *     panes that are NOT a plain collection — the approval queue and the
 *     obligation tracker — mount `Table` (table.gts) directly, because they
 *     group and sort by something a generic panel has no opinion about.
 *     `Table` rather than `components/data-table.gts#DataTable`: both exist in
 *     this realm, but only `Table` carries a Spec, and a Spec is how the next
 *     consumer discovers a block instead of rewriting it.
 *   - It never styles a block's internals. Where a block needs to look
 *     different here, that is an argument on the block, not CSS reaching into
 *     it from this file.
 */

const TABS = [
  // The desk: notice deadlines, awaiting signature, open deviations (Legal
  // Home block). First because it is the screen the contracts manager opens
  // in the morning.
  { key: 'home', label: 'Home' },
  { key: 'repository', label: 'Repository' },
  // One contract, clause by clause, with its ceremony — Contract Workspace +
  // Signature Block View blocks over whichever contract was picked.
  { key: 'workspace', label: 'Workspace' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'obligations', label: 'Obligations' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'clauses', label: 'Clauses' },
  { key: 'signatories', label: 'Signatories' },
  { key: 'renewals', label: 'Renewals' },
  { key: 'templates', label: 'Templates' },
  { key: 'requests', label: 'Requests' },
  { key: 'audit', label: 'Audit' },
];

/** Renewal urgency band, in days to the notice deadline. */
const NOTICE_WINDOW_DAYS = 90;

/** A person's display name: stored `name` first, computed `cardTitle` second. */
function personLabelOrUndefined(e: any): string | undefined {
  if (!e) return undefined;
  let n = typeof e.name === 'string' ? e.name.trim() : '';
  if (n) return n;
  let t = typeof e.cardTitle === 'string' ? e.cardTitle.trim() : '';
  return t || undefined;
}
function personLabel(e: any): string {
  return personLabelOrUndefined(e) ?? 'Unnamed';
}

/**
 * Who reviews a contract that matches no rule.
 *
 * A named constant rather than an inline string so the fallback is visible in
 * one place and can become a policy card later without hunting for it.
 */
const DEFAULT_REVIEWER = 'Legal';

/**
 * Bars are scaled against the LARGEST band, not against the total.
 *
 * Scaling to the total is the obvious choice and it is wrong here: with three
 * statuses holding one contract each, every bar would render at 33% and the
 * chart would say nothing that the three identical numbers beside it did not.
 * Scaling to the max makes the biggest band a full bar and every other band a
 * readable fraction of it, which is the comparison the reader actually wants.
 */
function scaleBands<T extends { count: number }>(
  rows: T[],
): (T & { pct: number })[] {
  let max = Math.max(0, ...rows.map((r) => r.count));
  return rows.map((r) => ({
    ...r,
    pct: max ? Math.round((r.count / max) * 100) : 0,
  }));
}

/** `2027-07-14`, not `Wed Jul 14 2027 00:00:00 GMT+0800`. */
function formatDay(v: unknown): string {
  if (!v) return '—';
  let d = new Date(v as any);
  if (Number.isNaN(d.getTime())) return String(v);
  // NOT toISOString(): it converts to UTC first, which renders a local date a
  // day early or late depending on the offset — the Acme term end showed
  // 2027-07-13 for a contract ending 2027-07-14. On a notice deadline that is
  // a missed obligation, not a formatting nit.
  let m = `${d.getMonth() + 1}`.padStart(2, '0');
  let day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** `out for signature` -> `Out for signature`. */
function humanise(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  let t = String(v).replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function formatStamp(v: unknown): string {
  if (!v) return '';
  let d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

const CONTRACT_COLUMNS: TableColumn[] = [
  {
    key: 'contractNumber',
    label: 'Number',
    width: '9rem',
    value: (c: any) => c?.contractNumber,
  },
  { key: 'cardTitle', label: 'Contract', value: (c: any) => c?.cardTitle },
  {
    key: 'contractType',
    label: 'Type',
    showAbove: 720,
    value: (c: any) => humanise(c?.contractType),
  },
  { key: 'status', label: 'Status', custom: true, width: '10rem' },
  { key: 'riskGrade', label: 'Risk', custom: true, width: '8rem' },
  {
    key: 'endDate',
    label: 'Expires',
    align: 'end',
    showAbove: 640,
    value: (c: any) => formatDay(c?.endDate),
  },
  /**
   * The entry point into the workflow.
   *
   * A contract with no approval chain is not "approved" — it has never been
   * asked about. Without this the only way into the queue was to hand-edit the
   * card's JSON, which is why the Approvals tab only ever showed the one
   * contract that had a chain written into it by hand.
   */
  { key: 'submit', label: '', custom: true, width: '11rem', align: 'end' },
];

/**
 * Clause columns follow the artifact: usage and deviation counts sit ON the
 * library row, so a reviewer can scan a whole library without opening
 * anything. Agiloft's deviation-markup-as-a-column is the nearest prior art;
 * no researched product shows the usage count at all.
 */
const CLAUSE_COLUMNS: TableColumn[] = [
  { key: 'cardTitle', label: 'Clause', value: (c: any) => c?.cardTitle },
  {
    key: 'clauseType',
    label: 'Category',
    showAbove: 640,
    value: (c: any) => humanise(c?.clauseType),
  },
  { key: 'riskLevel', label: 'Risk', custom: true, width: '7rem' },
  { key: 'usedIn', label: 'Used in', custom: true, align: 'end', width: '7rem' },
  {
    key: 'deviations',
    label: 'Deviations',
    custom: true,
    align: 'end',
    width: '7rem',
    showAbove: 640,
  },
  {
    key: 'ownerRole',
    label: 'Owned by',
    showAbove: 900,
    value: (c: any) => c?.ownerRole,
  },
];

/** The signing-authority matrix: ceiling, scope, and whether it is usable. */
const SIGNATORY_COLUMNS: TableColumn[] = [
  { key: 'cardTitle', label: 'Signatory', value: (sg: any) => sg?.cardTitle },
  {
    key: 'signatureAuthority',
    label: 'Authority ceiling',
    custom: true,
    align: 'end',
    width: '11rem',
  },
  { key: 'mySign', label: 'May sign', custom: true, showAbove: 640 },
  {
    key: 'routed',
    label: 'Routed here',
    custom: true,
    align: 'end',
    width: '8rem',
    showAbove: 720,
  },
  { key: 'isActive', label: 'Status', custom: true, width: '8rem' },
];

const NOTICE_COLUMNS: TableColumn[] = [
  { key: 'cardTitle', label: 'Contract', value: (c: any) => c?.cardTitle },
  {
    key: 'account',
    label: 'Counterparty',
    showAbove: 640,
    value: (c: any) => c?.account?.cardTitle,
  },
  {
    key: 'noticeBy',
    label: 'Notice by',
    align: 'end',
    width: '9rem',
    value: (c: any) => formatDay(c?.noticeBy),
  },
  {
    key: 'daysToNotice',
    label: 'Days left',
    custom: true,
    align: 'end',
    width: '8rem',
  },
  {
    key: 'endDate',
    label: 'Auto-renews',
    align: 'end',
    showAbove: 720,
    value: (c: any) => formatDay(c?.endDate),
  },
];

/**
 * Obligation columns follow the artifact.
 *
 * `contract`, `recurrence` and evidence are the three that make this a tracker
 * rather than a to-do list: which agreement it came from, whether it comes back,
 * and whether anyone can prove it was done. Only Icertis and Agiloft handle
 * recurrence and evidence at all among the six researched products.
 */
const TEMPLATE_COLUMNS: TableColumn[] = [
  { key: 'cardTitle', label: 'Template', value: (t: any) => t?.cardTitle },
  {
    key: 'contractType',
    label: 'Type',
    showAbove: 640,
    value: (t: any) => humanise(t?.contractType),
  },
  {
    key: 'useCase',
    label: 'Use case',
    showAbove: 900,
    value: (t: any) => t?.useCase,
  },
  {
    key: 'clauses',
    label: 'Clauses',
    align: 'end',
    width: '7rem',
    value: (t: any) => (t?.standardClauses ?? []).filter(Boolean).length,
  },
  { key: 'isPublished', label: 'Status', custom: true, width: '8rem' },
];

const REQUEST_COLUMNS: TableColumn[] = [
  { key: 'cardTitle', label: 'Request', value: (r: any) => r?.cardTitle },
  {
    key: 'contractType',
    label: 'Type',
    showAbove: 640,
    value: (r: any) => humanise(r?.contractType),
  },
  {
    key: 'requestedBy',
    label: 'Requested by',
    showAbove: 720,
    value: (r: any) => r?.requestedBy?.cardTitle,
  },
  {
    key: 'neededBy',
    label: 'Needed by',
    align: 'end',
    width: '9rem',
    value: (r: any) => formatDay(r?.neededBy),
  },
  { key: 'status', label: 'Status', custom: true, width: '9rem' },
];

const AUDIT_COLUMNS: TableColumn[] = [
  {
    key: 'occurredAt',
    label: 'When',
    width: '11rem',
    value: (a: any) => formatDay(a?.occurredAt),
  },
  {
    key: 'doneBy',
    label: 'Who',
    showAbove: 640,
    value: (a: any) => a?.doneBy?.cardTitle,
  },
  { key: 'action', label: 'Action', custom: true, width: '13rem' },
  {
    key: 'subjectTitle',
    label: 'Subject',
    value: (a: any) => a?.subjectTitle,
  },
  {
    key: 'conditions',
    label: 'Conditions',
    showAbove: 900,
    value: (a: any) => a?.conditions,
  },
];

const OBLIGATION_COLUMNS: TableColumn[] = [
  { key: 'cardTitle', label: 'Obligation', value: (o: any) => o?.cardTitle },
  {
    key: 'contract',
    label: 'Contract',
    showAbove: 900,
    value: (o: any) => o?.contract?.contractNumber ?? o?.contract?.cardTitle,
  },
  {
    key: 'obligationType',
    label: 'Type',
    showAbove: 720,
    value: (o: any) => humanise(o?.obligationType),
  },
  {
    key: 'recurrence',
    label: 'Recurrence',
    showAbove: 900,
    custom: true,
    width: '8rem',
  },
  { key: 'status', label: 'State', width: '9rem', custom: true },
  {
    key: 'nextDueDate',
    label: 'Due',
    align: 'end',
    width: '7rem',
    value: (o: any) => formatDay(o?.nextDueDate),
  },
  {
    key: 'owner',
    label: 'Owner',
    showAbove: 640,
    value: (o: any) => o?.owner?.name,
  },
  {
    key: 'evidence',
    label: 'Evidence',
    custom: true,
    align: 'end',
    width: '8rem',
    showAbove: 720,
  },
];


/** The step a contract is currently sitting on, or undefined if none is open. */
function openStep(c: any): any {
  let steps = (c?.approvalChain?.steps ?? []).filter(Boolean);
  let idx = c?.approvalChain?.currentStepIndex ?? steps.length;
  return steps[idx];
}

const APPROVAL_COLUMNS: TableColumn[] = [
  { key: 'cardTitle', label: 'Contract', value: (c: any) => c?.cardTitle },
  { key: 'step', label: 'Step', width: '9rem', custom: true },
  {
    key: 'approver',
    label: 'With',
    showAbove: 640,
    value: (c: any) => {
      let s = openStep(c);
      return s?.delegatedTo?.name ?? s?.approver?.name ?? '—';
    },
  },
  {
    key: 'waiting',
    label: 'Waiting',
    align: 'end',
    width: '6rem',
    value: (c: any) => {
      let d = openStep(c)?.waitingDays;
      return typeof d === 'number' ? `${d}d` : '—';
    },
    sortValue: (c: any) => openStep(c)?.waitingDays ?? -1,
  },
  { key: 'riskGrade', label: 'Risk', width: '8rem', custom: true },
];

interface ObligationGroup {
  key: string;
  label: string;
  hue: Hue;
  rows: Obligation[];
}

class Isolated extends Component<typeof ContractExecutionApp> {
  @tracked tab = 'home';

  // ---- Workspace + ceremony (Contract Lifecycle Desk) ----------------------
  // The contract under review. Set from Legal Home (click a deadline / a
  // deviation), from the repository, or from the picker on the Workspace tab.
  @tracked workspaceContract: Contract | undefined;
  @tracked ceremonyBusy = false;
  @tracked ceremonyNote: string | undefined;
  @tracked ceremonyProblem: string | undefined;
  @tracked ceremonyFindings: string[] = [];
  @tracked signatureProvider = 'DocuSign';

  @action openInWorkspace(contract: Contract) {
    this.workspaceContract = contract;
    this.ceremonyNote = undefined;
    this.ceremonyProblem = undefined;
    this.ceremonyFindings = [];
    this.tab = 'workspace';
  }

  @action clearWorkspace() {
    this.workspaceContract = undefined;
  }

  @action setProvider(event: Event) {
    this.signatureProvider = (event.target as HTMLInputElement).value;
  }

  /** The live instance for the picked contract, so command writes show up. */
  get workspaceLive(): Contract | undefined {
    let id = this.workspaceContract?.id;
    if (!id) return undefined;
    return this.contracts.find((c) => c.id === id) ?? this.workspaceContract;
  }

  get workspaceBlocks() {
    return this.workspaceLive?.signatureBlocks ?? [];
  }

  /** The picked contract's clause instances and version snapshots, from the
   *  app's own live queries — handed to the commands so they need not search. */
  get workspaceClauses(): ContractClause[] {
    let id = this.workspaceLive?.id;
    return ((this.clauseUseQuery?.instances ?? []) as ContractClause[]).filter(
      (c) => {
        try {
          return Boolean(c) && c.contract?.id === id;
        } catch {
          return false;
        }
      },
    );
  }

  get workspaceVersions(): ContractVersion[] {
    let id = this.workspaceLive?.id;
    return ((this.versionQuery?.instances ?? []) as ContractVersion[]).filter(
      (v) => {
        try {
          return Boolean(v) && v.contract?.id === id;
        } catch {
          return false;
        }
      },
    );
  }

  private async runCeremony(
    label: string,
    fn: (ctx: any, contract: Contract) => Promise<string>,
  ) {
    let contract = this.workspaceLive;
    let ctx = this.args.context?.commandContext;
    if (!contract) return;
    if (!ctx) {
      this.ceremonyProblem = 'No command context in this host — open the app interactively.';
      return;
    }
    this.ceremonyBusy = true;
    this.ceremonyProblem = undefined;
    this.ceremonyNote = undefined;
    this.ceremonyFindings = [];
    try {
      this.ceremonyNote = await fn(ctx, contract);
    } catch (error: any) {
      this.ceremonyProblem = `${label} refused — ${error?.message ?? 'unknown error'}`;
    } finally {
      this.ceremonyBusy = false;
    }
  }

  requestSignature = () =>
    this.runCeremony('Request Signature', async (ctx, contract) => {
      let r = await new RequestSignatureCommand(ctx).execute({
        contract,
        provider: this.signatureProvider,
      } as any);
      return r.message ?? 'Requested.';
    });

  verifySignatures = () =>
    this.runCeremony('Verify Signature', async (ctx, contract) => {
      let r = await new VerifySignatureCommand(ctx).execute({ contract } as any);
      this.ceremonyFindings = (r.findings ?? []).filter(Boolean) as string[];
      return r.message ?? 'Verified.';
    });

  executeContract = () =>
    this.runCeremony('Execute Contract', async (ctx, contract) => {
      let realm = this.realmList[0];
      let r = await new ExecuteContractCommand(ctx).execute({
        contract,
        executedBy: this.actingAs,
        realm,
        priorVersions: this.workspaceVersions,
      } as any);
      return r.message ?? 'Executed.';
    });

  generateDocument = () =>
    this.runCeremony('Generate Document', async (ctx, contract) => {
      let clauses = this.workspaceClauses;
      let r = await new GenerateDocumentCommand(ctx).execute({
        contract,
        clauses,
        signatories: (this.signatoryQuery?.instances ?? []).filter(Boolean),
      } as any);
      return r.message ?? 'Generated.';
    });

  /** True until the app's clause and version queries have published rows. */
  get workspaceDataLoading(): boolean {
    let c = this.clauseUseQuery as any;
    let v = this.versionQuery as any;
    return Boolean(c?.isLoading) || Boolean(v?.isLoading);
  }

  get ceremonyStatusLabel(): string {
    return this.statusLabelOf(this.workspaceLive?.status);
  }

  private contractQuery: ReturnType<getCards<Contract>> | undefined;
  private obligationQuery: ReturnType<getCards<Obligation>> | undefined;
  private clauseUseQuery: ReturnType<getCards<ContractClause>> | undefined;
  private clauseQuery: ReturnType<getCards<Clause>> | undefined;
  private signatoryQuery: ReturnType<getCards<Signatory>> | undefined;
  private ruleQuery: ReturnType<getCards<ApprovalRule>> | undefined;
  private auditQuery: ReturnType<getCards<AuditEntry>> | undefined;
  private versionQuery: ReturnType<getCards<ContractVersion>> | undefined;
  private templateQuery: ReturnType<getCards<ContractTemplate>> | undefined;
  private requestQuery: ReturnType<getCards<ContractRequest>> | undefined;
  private employeeQuery: ReturnType<getCards<Employee>> | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    let ctx = this.args.context as CardContext | undefined;
    let realms = () => this.realms;
    let live = { isLive: true } as const;
    let contractRef = identifyCard(Contract);
    let obligationRef = identifyCard(Obligation);
    let clauseUseRef = identifyCard(ContractClause);
    let clauseRef = identifyCard(Clause);
    let signatoryRef = identifyCard(Signatory);
    let ruleRef = identifyCard(ApprovalRule);
    let auditRef = identifyCard(AuditEntry);
    let versionRef = identifyCard(ContractVersion);
    let templateRef = identifyCard(ContractTemplate);
    let requestRef = identifyCard(ContractRequest);
    let employeeRef = identifyCard(Employee);
    if (ctx && contractRef) {
      this.contractQuery = ctx.getCards(
        this,
        () => ({ filter: { type: contractRef } }),
        realms,
        live,
      ) as ReturnType<getCards<Contract>>;
    }
    if (ctx && obligationRef) {
      this.obligationQuery = ctx.getCards(
        this,
        () => ({ filter: { type: obligationRef } }),
        realms,
        live,
      ) as ReturnType<getCards<Obligation>>;
    }
    // In-contract clause instances. The Clauses tab needs them to answer
    // "used in how many contracts, and deviating in how many" — the one figure
    // no researched CLM product puts on a clause record.
    if (ctx && clauseUseRef) {
      this.clauseUseQuery = ctx.getCards(
        this,
        () => ({ filter: { type: clauseUseRef } }),
        realms,
        live,
      ) as ReturnType<getCards<ContractClause>>;
    }
    // Counted for the tab badges. The tabs themselves render through
    // CollectionPanel, which runs its own query — these exist so a tab can say
    // how much is behind it before you open it.
    if (ctx && clauseRef) {
      this.clauseQuery = ctx.getCards(
        this,
        () => ({ filter: { type: clauseRef } }),
        realms,
        live,
      ) as ReturnType<getCards<Clause>>;
    }
    if (ctx && signatoryRef) {
      this.signatoryQuery = ctx.getCards(
        this,
        () => ({ filter: { type: signatoryRef } }),
        realms,
        live,
      ) as ReturnType<getCards<Signatory>>;
    }
    for (let [ref, assign] of [
      [ruleRef, (q: any) => (this.ruleQuery = q)],
      [auditRef, (q: any) => (this.auditQuery = q)],
      [versionRef, (q: any) => (this.versionQuery = q)],
      [templateRef, (q: any) => (this.templateQuery = q)],
      [requestRef, (q: any) => (this.requestQuery = q)],
      [employeeRef, (q: any) => (this.employeeQuery = q)],
    ] as [any, (q: any) => void][]) {
      if (ctx && ref) {
        assign(
          ctx.getCards(this, () => ({ filter: { type: ref } }), realms, live),
        );
      }
    }
  }

  private get realms(): string[] | undefined {
    let url = (this.args.model as any)?.[realmURL];
    return url ? [url.href] : undefined;
  }

  get realmList(): string[] {
    return this.realms ?? [];
  }

  /**
   * Prerender gets a static shell.
   *
   * The CRUD functions only exist in the interactive host, so gating on one of
   * them keeps indexing light and avoids prerendering six live queries and a
   * board of themed fitted cards.
   */
  get isInteractive(): boolean {
    return Boolean((this.args as any).viewCard);
  }

  // ---- resolved instances -------------------------------------------------

  // The raw arrays may contain holes: a live query publishes its rows before
  // every linked card has resolved, and an entry that failed to resolve arrives
  // as null. `.filter(Boolean)` is the necessary guard — but on its own it makes
  // the app assert "there are 2" about a query that returned 4, with no error
  // anywhere. So the drop count is kept and surfaced (see `unresolvedNote`)
  // rather than swallowed.
  get contractsRaw(): (Contract | null)[] {
    return (this.contractQuery?.instances ?? []) as (Contract | null)[];
  }

  get obligationsRaw(): (Obligation | null)[] {
    return (this.obligationQuery?.instances ?? []) as (Obligation | null)[];
  }

  /** Every resolved contract, ignoring the rail. Counts in the rail use this. */
  get contractsAll(): Contract[] {
    return this.contractsRaw.filter(Boolean) as Contract[];
  }

  /**
   * Contracts AFTER the saved-view scope.
   *
   * Everything downstream — approvals, obligations, compliance — reads this,
   * so selecting a view in the rail changes every derived tab rather than just
   * the repository list.
   */
  get contracts(): Contract[] {
    return this.contractsAll.filter(this.activeViewTest);
  }

  /** Every resolved obligation, ignoring the saved-view scope. */
  get obligationsAll(): Obligation[] {
    return this.obligationsRaw.filter(Boolean) as Obligation[];
  }

  get obligations(): Obligation[] {
    return this.obligationsAll;
  }

  get clauseUses(): ContractClause[] {
    return ((this.clauseUseQuery?.instances ?? []) as any[]).filter(
      Boolean,
    ) as ContractClause[];
  }

  clauseRiskLabel = (r?: string | null): string => humanise(r);

  clauseRiskHue = (r?: string | null): Hue =>
    r === 'critical' ? 'red' : r === 'high' ? 'orange' : r === 'medium' ? 'amber' : 'green';

  /** Money keeps its minor units — a ceiling missing a digit is $25K vs $250K. */
  authorityLabel = (sg: any): string =>
    formatMoney(sg?.signatureAuthority?.amount, sg?.signatureAuthority?.currency?.code) ||
    '—';

  /** An empty type list means unrestricted, which is the opposite of "none". */
  signScope = (sg: any): string => {
    let types = (sg?.contractTypes ?? []).filter(Boolean);
    return types.length
      ? types.map((t: string) => contractTypeLabel(t)).join(' · ')
      : 'All contract types';
  };

  /** Contracts whose open approval step sits with this signatory's person. */
  routedCount = (sg: any): number => {
    let pid = sg?.person?.id;
    if (!pid) return 0;
    return this.contracts.filter((c: any) => {
      let st = openStep(c);
      return st?.approver?.id === pid || st?.delegatedTo?.id === pid;
    }).length;
  };

  /** How many contracts use this standard clause, and how many deviate. */
  clauseUsage = (clauseId?: string) => {
    if (!clauseId) return { used: 0, deviations: 0 };
    let rows = this.clauseUses.filter(
      (u: any) => u?.standardClause?.id === clauseId,
    );
    return {
      used: rows.length,
      deviations: rows.filter((u: any) => u?.isDeviation).length,
    };
  };

  /**
   * Rows the realm returned that this app could not resolve.
   *
   * Compared against the UNSCOPED resolved lists on purpose. Comparing against
   * the scoped ones counted every contract a saved view deliberately excluded
   * as a load failure — picking "Awaiting my approval" reported "3 records
   * could not be loaded" when nothing had failed at all. Filtering is a choice;
   * failing to resolve is a fault, and the banner is only for the fault.
   */
  get unresolvedCount(): number {
    let c = this.contractsRaw.length - this.contractsAll.length;
    let o = this.obligationsRaw.length - this.obligationsAll.length;
    return c + o;
  }

  /**
   * Shown whenever the realm returned rows this app could not resolve.
   *
   * A compliance figure computed over a silently-shortened list is worse than
   * no figure: 50% of four looks identical to 50% of two, and only one of them
   * means what the reader thinks.
   */
  get unresolvedNote(): string | undefined {
    let n = this.unresolvedCount;
    if (!n) return undefined;
    return `${n} record${n === 1 ? '' : 's'} could not be loaded — counts below exclude ${n === 1 ? 'it' : 'them'}.`;
  }

  get isLoading(): boolean {
    return (
      Boolean(this.contractQuery?.isLoading) && this.contracts.length === 0
    );
  }

  // ---- masthead counters --------------------------------------------------

  get overdueCount(): number {
    return this.obligations.filter((o) => o.status === 'overdue').length;
  }

  get awaitingCount(): number {
    return this.contracts.filter(
      (c) => c.approvalChain?.status === 'in-progress',
    ).length;
  }

  get noticeSoonCount(): number {
    return this.contracts.filter((c) => {
      let d = c.daysToNotice;
      return typeof d === 'number' && d >= 0 && d <= NOTICE_WINDOW_DAYS;
    }).length;
  }

  /**
   * Obligations met, as a percentage.
   *
   * Returns undefined rather than 100 when nothing is tracked: a score of
   * "perfect" and a score of "we are not measuring" must never render the same,
   * because only one of them is good news.
   */
  get complianceScore(): number | undefined {
    let all = this.obligations;
    if (!all.length) return undefined;
    let open = all.filter((o) => o.status !== 'closed');
    if (!open.length) return 100;
    let breached = open.filter((o) => o.status === 'overdue').length;
    return Math.round(((open.length - breached) / open.length) * 100);
  }

  get compliancePct(): number {
    let s = this.complianceScore;
    return typeof s === 'number' ? s : 0;
  }

  get complianceLabel(): string {
    let s = this.complianceScore;
    return typeof s === 'number' ? `${s}%` : '—';
  }

  // ---- approvals ----------------------------------------------------------

  // Real Contract cards, not a row wrapper — so `Table`'s `@onRowClick` hands
  // back a card the app can open, and every derived value comes from a column
  // accessor rather than a parallel shape that can drift from the card.
  get approvalRows(): Contract[] {
    return this.contracts
      .filter((c) => openStep(c))
      // Longest waiting first — a queue sorted by arrival buries the thing
      // stuck for nine days under three that arrived today.
      .sort(
        (a, b) =>
          (openStep(b)?.waitingDays ?? 0) - (openStep(a)?.waitingDays ?? 0),
      );
  }

  stepStateOf = (c: any): string => openStep(c)?.stepState ?? 'pending';

  /**
   * Saved views, consumed through boxel-ui's FilterList rather than rebuilt.
   *
   * All six researched CLM products ship saved views and all six store
   * PARAMETERS rather than results — so each entry here is a predicate applied
   * live, never a frozen id list. `FilterList.Filter` carries no count slot, so
   * the count rides in `displayName`; extending that type is a shared boxel-ui
   * change and did not belong in this app's branch.
   */
  /**
   * Saved views are a CONTRACT SCOPE, not a repository-only filter.
   *
   * A view stores a predicate, never a frozen id list — every researched CLM
   * product is explicit that saved views store parameters rather than results,
   * so a contract that becomes high-risk tomorrow appears in "High & critical
   * risk" without anyone re-saving anything.
   *
   * The scope then flows into every tab DERIVED from contracts: approvals,
   * obligations and compliance all recompute against it. Anything else would
   * make the rail a control that changes one screen and silently lies on the
   * other three.
   */
  get viewDefs(): { name: string; test: (c: any) => boolean }[] {
    return [
      { name: 'All contracts', test: () => true },
      { name: 'Awaiting my approval', test: (c) => Boolean(openStep(c)) },
      {
        name: 'Notice inside 90 days',
        test: (c) =>
          typeof c.daysToNotice === 'number' && c.daysToNotice <= NOTICE_WINDOW_DAYS,
      },
      {
        name: 'High & critical risk',
        test: (c) => c.riskGrade === 'high' || c.riskGrade === 'critical',
      },
    ];
  }

  get savedViews(): Filter[] {
    return this.viewDefs
      .map((v) => ({ def: v, n: this.contractsAll.filter(v.test).length }))
      // A view with nothing behind it is hidden rather than shown as a zero —
      // Ironclad's conditional presets. "All contracts" always stays, because
      // it is the way back out of a scope.
      .filter(({ def, n }) => n > 0 || def.name === 'All contracts')
      .map(({ def, n }) => ({ displayName: `${def.name} · ${n}` }));
  }

  @tracked activeView?: Filter;

  get currentView(): Filter | undefined {
    return this.activeView ?? this.savedViews[0];
  }

  /** The predicate behind whatever the rail currently has selected. */
  get activeViewTest(): (c: any) => boolean {
    let label = (this.currentView?.displayName ?? '').split(' · ')[0];
    return this.viewDefs.find((v) => v.name === label)?.test ?? (() => true);
  }

  setView = (f: Filter) => {
    this.activeView = f;
  };

  /**
   * The rail belongs to the Repository only.
   *
   * Saved views are per-object in every researched product — Ironclad's rail
   * sits on the repository dashboard, LinkSquares gives Analyze and Finalize
   * separate ones. None shows one object's views while you are looking at a
   * different object, and "All contracts · 3" beside "Obligations 4" reads as
   * a contradiction rather than as a scope.
   *
   * The SCOPE still travels: you set it here, and every derived tab recomputes
   * against it and says so in a banner with a way out. Setting it belongs to
   * one place; obeying it belongs everywhere.
   */
  get railApplies(): boolean {
    return this.tab === 'repository';
  }

  /**
   * The roll-up above the obligation table.
   *
   * Ironclad shipped exactly this in Jul 2026 — KPI cards over the table on one
   * screen — and it is the difference between "there are obligations" and "two
   * are late and the oldest is 18 days out". Rendered with the base realm's
   * StatEmbedded rather than a local tile, so the figure formatting matches
   * every other stat in the platform.
   */
  get obligationKpis() {
    let obs: any[] = this.obligations;
    let overdue = obs.filter((o) => o.status === 'overdue' || o.status === 'due_today');
    let soon = obs.filter((o) => o.status === 'due_soon');
    let ok = obs.filter((o) => o.status === 'on_track');
    let evidenced = obs.filter((o) =>
      (o.completions ?? []).some((c: any) => c?.evidenceUrl),
    );
    let oldest = Math.max(0, ...overdue.map((o) => o.isOverdue ?? 0));
    return [
      {
        label: 'Overdue',
        value: overdue.length,
        unit: '',
        alarm: overdue.length > 0,
        detail: oldest ? `Oldest ${oldest} days past due` : 'Nothing late',
      },
      {
        label: 'Due soon',
        value: soon.length,
        unit: '',
        alarm: false,
        detail: `Inside ${DUE_SOON_DAYS} days`,
      },
      {
        label: 'On track',
        value: ok.length,
        unit: '',
        alarm: false,
        detail: 'Not yet due',
      },
      {
        label: 'Evidence filed',
        value: evidenced.length,
        unit: `/${obs.length}`,
        alarm: false,
        detail: `${obs.length - evidenced.length} unevidenced`,
      },
    ];
  }

  /** Reads the catalog RecurringPatternField's own vocabulary, not a re-derivation. */
  recurrenceLabel = (o: any): string => {
    let p = o?.recurrence?.pattern;
    if (!p || p === 'none') return 'One time';
    let every = o?.recurrence?.interval;
    return every && every > 1 ? `Every ${every} ${p}` : p;
  };

  hasEvidence = (o: any): boolean =>
    (o?.completions ?? []).some((c: any) => c?.evidenceUrl);

  /** Evidence is only "missing" once the thing was actually due. */
  evidenceDue = (o: any): boolean =>
    o?.status === 'overdue' || o?.status === 'due_today' || Boolean(o?.closedAt);

  /** Row severity, encoded at the row edge by `Table`'s `@rowClass`. */
  contractSeverity = (c: any): string => {
    if (c?.riskGrade === 'critical' || c?.riskGrade === 'high') return 'sev-over';
    if (typeof c?.daysToNotice === 'number' && c.daysToNotice <= NOTICE_WINDOW_DAYS)
      return 'sev-note';
    if (c?.status === 'signed') return 'sev-ok';
    return 'sev-cool';
  };

  obligationSeverity = (o: any): string => {
    let st = o?.status;
    if (st === 'overdue' || st === 'due_today') return 'sev-over';
    if (st === 'due_soon') return 'sev-note';
    if (st === 'closed') return '';
    return 'sev-ok';
  };

  /** A tab with nothing behind it shows no count rather than a zero. */
  tabCount = (key: string): number => {
    switch (key) {
      case 'repository':
        return this.contracts.length;
      case 'approvals':
        return this.approvalRows.length;
      case 'obligations':
        return this.obligations.length;
      case 'clauses':
        return (this.clauseQuery?.instances ?? []).filter(Boolean).length;
      case 'signatories':
        return (this.signatoryQuery?.instances ?? []).filter(Boolean).length;
      case 'renewals':
        return this.renewalRows.length;
      case 'templates':
        return this.templates.length;
      case 'requests':
        return this.requests.length;
      case 'audit':
        return this.audits.length;
      default:
        return 0;
    }
  };

  /** Overdue work is the one count that earns an alarm colour. */
  tabIsHot = (key: string): boolean =>
    key === 'obligations' && this.overdueCount > 0;

  get leadValueLabel(): string {
    let v: any = (this.leadApproval as any)?.value;
    return formatMoney(v?.amount, v?.currency?.code) || '';
  }

  /** The contract at the head of the queue — the one the rail is drawn for. */
  /**
   * Which contract the decision pane is showing.
   *
   * Held as an ID rather than the instance: the live query hands back new
   * objects on every reindex, so a stored instance would silently stop
   * matching anything in the list the moment the realm updated.
   */
  @tracked selectedApprovalId: string | undefined;

  /**
   * The contract under review — the selected one, or the longest-waiting.
   *
   * Defaulting to the head of the queue rather than to nothing means the pane
   * is useful before anyone clicks; hard-coding it to the head (which is what
   * this used to do) meant the other rows could be read but never acted on.
   */
  get leadApproval(): Contract | undefined {
    let rows = this.approvalRows;
    if (this.selectedApprovalId) {
      let picked = rows.find((c) => c.id === this.selectedApprovalId);
      if (picked) return picked;
    }
    return rows[0];
  }

  selectApproval = (c: CardDef) => {
    this.selectedApprovalId = c?.id;
    // A new subject means the previous reason no longer applies to what is
    // on screen — carrying it over would attach one contract's rationale to
    // another contract's decision.
    this.decisionNote = '';
    this.decisionProblem = undefined;
    this.lastDecision = undefined;
  };

  isSelectedApproval = (c: any): boolean => c?.id === this.leadApproval?.id;

  /** Who this step is waiting on, so the requirement is visible before acting. */
  get expectedApproverName(): string | undefined {
    let st: any = openStep(this.leadApproval);
    return personLabelOrUndefined(st?.delegatedTo) ?? personLabelOrUndefined(st?.approver);
  }

  /**
   * Assign a person to an approval step, in place.
   *
   * `submitForApproval` builds steps from ROLES ("Legal"), and a role is not a
   * person — so a freshly submitted chain has nobody on it, the step reads
   * "Unassigned" and its clock sits at 0d forever. This is the missing half of
   * submitting.
   *
   * Inline rather than a separate edit screen: it is one field, in the place
   * the reader is already looking, and routing a routine assignment through
   * the contract's edit format costs four clicks to change one link.
   */
  assignApprover = async (stepIndex: number, event: Event) => {
    let id = (event.target as HTMLSelectElement)?.value;
    let contract: any = this.leadApproval;
    let store = this.args.context?.store;
    if (!store || !contract?.id) return;
    if (!id) return;
    this.assignBusy = true;
    this.assignProblem = undefined;
    try {
      // The dotted path addresses a linksTo INSIDE a containsMany entry — the
      // same shape the seeded instances use, so the two cannot disagree.
      await store.patch(contract.id, {
        relationships: {
          [`approvalChain.steps.${stepIndex}.approver`]: { links: { self: id } },
        },
      } as any);
    } catch (error: any) {
      this.assignProblem = error?.message ?? 'Could not assign that approver.';
    } finally {
      this.assignBusy = false;
    }
  };

  @tracked assignBusy = false;
  @tracked assignProblem: string | undefined;

  approvalRowClass = (c: CardDef): string =>
    `${this.contractSeverity(c)}${this.isSelectedApproval(c) ? ' is-picked' : ''}`;

  /**
   * The approval chain rendered FOR THE APPROVER rather than for the person who
   * configured the workflow. Research across six CLM products found none that
   * do this: DocuSign draws the chain to the author as a designer graph, Agiloft
   * and Juro list it on the record, Ironclad names only who is next. Knowing
   * "step 2 of 4, Finance is behind me" is what tells an approver whether to
   * chase or wait.
   */
  get leadChain() {
    let c: any = this.leadApproval;
    let steps = (c?.approvalChain?.steps ?? []).filter(Boolean);
    let current = c?.approvalChain?.currentStepIndex ?? steps.length;
    return steps.map((st: any, i: number) => ({
      index: i + 1,
      total: steps.length,
      who: personLabelOrUndefined(st?.approver) ?? personLabelOrUndefined(st?.delegatedTo) ?? 'Unassigned',
      zeroIndex: i,
      // Only the step that is actually open gets an assign control. A done
      // step's approver is history and must not be editable from here; a
      // queued one is assigned when its turn comes, not speculatively.
      needsApprover: i === current && !st?.approver?.id && !st?.delegatedTo?.id,
      role: st?.approver?.department ?? '',
      state: i < current ? 'done' : i === current ? 'now' : 'queued',
      isNow: i === current,
      when: st?.decidedAt
        ? formatStamp(st.decidedAt)
        : st?.waitingDays != null
          ? `open ${st.waitingDays}d`
          : '',
    }));
  }

  /**
   * The rule that fired, rendered. Every researched product MODELS its trigger
   * condition and then discards it at render time, falling back to instruction
   * text a human typed. The threshold and the value are both already on the
   * card, so stating the actual reason costs nothing.
   */
  get rules(): ApprovalRule[] {
    return ((this.ruleQuery?.instances ?? []) as any[]).filter(
      Boolean,
    ) as ApprovalRule[];
  }

  get audits(): AuditEntry[] {
    return ((this.auditQuery?.instances ?? []) as any[]).filter(
      Boolean,
    ) as AuditEntry[];
  }

  get versions(): ContractVersion[] {
    return ((this.versionQuery?.instances ?? []) as any[]).filter(
      Boolean,
    ) as ContractVersion[];
  }

  get requests(): ContractRequest[] {
    return ((this.requestQuery?.instances ?? []) as any[]).filter(
      Boolean,
    ) as ContractRequest[];
  }

  /**
   * The two most recent versions of the lead contract, oldest first.
   *
   * Two, not all: a diff answers "what changed last time", and offering an
   * arbitrary pair to compare is a control nobody uses on a portfolio this size.
   */
  get leadVersionPair() {
    let id = (this.leadApproval as any)?.id;
    let rows = this.versions
      .filter((v: any) => v?.contract?.id === id)
      .sort((a: any, b: any) => (a?.versionNumber ?? 0) - (b?.versionNumber ?? 0));
    return rows.length >= 2 ? rows.slice(-2) : [];
  }

  get templates(): ContractTemplate[] {
    return ((this.templateQuery?.instances ?? []) as any[]).filter(
      Boolean,
    ) as ContractTemplate[];
  }

  /** Deviating clauses on a contract — an input to the rules engine. */
  deviationCountFor = (contractId?: string): number =>
    contractId
      ? this.clauseUses.filter(
          (u: any) => u?.contract?.id === contractId && u?.isDeviation,
        ).length
      : 0;

  /**
   * The rules that fired for the contract at the head of the queue.
   *
   * Replaces a hardcoded $100K constant. Every researched CLM product models
   * its trigger condition and then discards it at render time, falling back to
   * instruction text a human typed; keeping the rule as data means the sentence
   * shown to the approver cannot drift from the routing that produced it.
   */
  get leadFiredRules() {
    let c: any = this.leadApproval;
    if (!c) return [];
    return evaluateRules(this.rules, {
      contractType: c.contractType,
      value: c.value,
      riskGrade: c.riskGrade,
      deviationCount: this.deviationCountFor(c.id),
      handlesSensitiveData: c.handlesSensitiveData,
    });
  }

  /**
   * Why this needs approval, in one sentence, derived from the rules that fired.
   *
   * Falls back to nothing rather than to a guess: an approver told the wrong
   * reason is worse off than one told no reason, because they will act on it.
   */
  get leadWhy(): string | undefined {
    let fired = this.leadFiredRules;
    if (!fired.length) return undefined;
    return fired
      .map((f) => `${f.name} — because ${f.because}`)
      .join('; ');
  }

  /** No rules configured at all is a setup gap, not a clean bill of health. */
  get rulesUnconfigured(): boolean {
    return this.rules.length === 0;
  }

  /**
   * Audit export — a real CSV, generated in the browser.
   *
   * No server round-trip and no library: the whole point of an audit export is
   * that the auditor can open it in a spreadsheet, and a Blob + object URL does
   * that with nothing to install. Quoting is explicit because a contract title
   * containing a comma would otherwise shift every column after it — silently,
   * and only in the file the auditor is reading.
   */
  exportAudit = () => {
    let esc = (v: unknown) => {
      let t = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    let header = ['When', 'Done by', 'Action', 'Subject', 'Conditions', 'Note'];
    let rows = this.audits
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b?.occurredAt ?? 0).getTime() -
          new Date(a?.occurredAt ?? 0).getTime(),
      )
      .map((a: any) => [
        a?.occurredAt ?? '',
        a?.doneBy?.cardTitle ?? '',
        auditActionLabel(a?.action),
        a?.subjectTitle ?? '',
        a?.conditions ?? '',
        a?.note ?? '',
      ]);
    let csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
    let blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    let url = URL.createObjectURL(blob);
    let a = document.createElement('a');
    a.href = url;
    a.download = 'contract-audit-trail.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Audit entries for one contract, newest first. */
  auditFor = (contractId?: string): AuditEntry[] =>
    contractId
      ? this.audits
          .filter((a: any) => a?.subject?.id === contractId)
          .sort(
            (a: any, b: any) =>
              new Date(b?.occurredAt ?? 0).getTime() -
              new Date(a?.occurredAt ?? 0).getTime(),
          )
      : [];


  // ---- obligations --------------------------------------------------------

  get obligationGroups(): ObligationGroup[] {
    let by = (...states: string[]) =>
      this.obligations.filter((o) => states.includes(o.status ?? ''));
    return [
      {
        key: 'overdue',
        label: 'Overdue',
        hue: 'red' as Hue,
        rows: by('overdue'),
      },
      {
        key: 'now',
        label: 'Due now or this week',
        hue: 'orange' as Hue,
        rows: by('due_today', 'due_soon'),
      },
      {
        key: 'ahead',
        label: 'On track',
        hue: 'green' as Hue,
        rows: by('on_track'),
      },
    ].filter((g) => g.rows.length);
  }

  // ---- compliance ---------------------------------------------------------

  // ---- compliance analytics ----------------------------------------------

  /**
   * Median days from approval start to signature.
   *
   * Cycle time is the headline metric in five of the six researched CLM
   * products. Median, not mean: one contract that sat for nine months would
   * drag a mean far away from what a typical contract actually takes.
   */
  get medianExecutionDays(): number | undefined {
    let spans = this.contracts
      .map((c: any) => {
        let start = c.approvalChain?.startedAt;
        let end = c.signedAt;
        if (!start || !end) return undefined;
        let d =
          (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
        return d >= 0 ? Math.round(d) : undefined;
      })
      .filter((n): n is number => typeof n === 'number')
      .sort((a, b) => a - b);
    if (!spans.length) return undefined;
    let mid = Math.floor(spans.length / 2);
    return spans.length % 2
      ? spans[mid]
      : Math.round((spans[mid - 1]! + spans[mid]!) / 2);
  }

  get portfolioValueLabel(): string {
    let rows = this.contracts as any[];
    let total = rows.reduce((n, c) => n + (c.value?.amount ?? 0), 0);
    return formatMoney(total, rows[0]?.value?.currency?.code) || '—';
  }

  /** Names the nearest deadline rather than restating the count beside it. */
  get noticeLede(): string {
    let next = this.renewalRows[0] as any;
    if (!next) return 'Nothing to serve';
    return `${next.cardTitle} — ${next.daysToNotice}d to act`;
  }

  get deviationCount(): number {
    return this.clauseUses.filter((u: any) => u?.isDeviation).length;
  }

  get unapprovedDeviations(): number {
    return this.clauseUses.filter(
      (u: any) => u?.isDeviation && u?.deviationSeverity !== 'approved',
    ).length;
  }

  /**
   * Exposure by risk grade, weighted by VALUE rather than by count.
   *
   * Four low-value contracts at medium risk are not the same exposure as one
   * large one, and a count chart says they are.
   */
  get valueByRisk() {
    let grades = ['critical', 'high', 'medium', 'low'];
    let rows = grades
      .map((grade) => {
        let cards = this.contracts.filter((c: any) => c.riskGrade === grade);
        let total = cards.reduce(
          (n: number, c: any) => n + (c.value?.amount ?? 0),
          0,
        );
        return {
          grade,
          label: riskGradeLabel(grade),
          count: total,
          amount: total,
          currency: cards[0]?.value?.currency?.code,
          hue: (grade === 'critical'
            ? 'red'
            : grade === 'high'
              ? 'orange'
              : grade === 'medium'
                ? 'amber'
                : 'green') as Hue,
        };
      })
      .filter((b) => b.count > 0);
    return scaleBands(rows).map((b) => ({
      ...b,
      money: formatMoney(b.amount, b.currency),
    }));
  }

  /**
   * Median days each approval step is held.
   *
   * NOT the artifact's "time in stage" — that needs a stage-transition history
   * the realm does not record, and inventing one would put a fabricated number
   * on a compliance screen. This answers the same question ("where does it
   * stall") from `openedAt`/`decidedAt`, which are real.
   */
  get timeByStep() {
    let byRole = new Map<string, number[]>();
    for (let c of this.contracts as any[]) {
      for (let st of c.approvalChain?.steps ?? []) {
        if (!st?.openedAt) continue;
        let end = st.decidedAt ? new Date(st.decidedAt).getTime() : Date.now();
        let days = Math.round(
          (end - new Date(st.openedAt).getTime()) / 86_400_000,
        );
        if (days < 0) continue;
        let key = personLabelOrUndefined(st.approver) || 'Unassigned';
        byRole.set(key, [...(byRole.get(key) ?? []), days]);
      }
    }
    let rows = [...byRole.entries()].map(([label, ds]) => {
      let sorted = ds.sort((a, b) => a - b);
      let mid = Math.floor(sorted.length / 2);
      let median = sorted.length % 2
        ? sorted[mid]!
        : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
      return { label, count: median };
    });
    let worst = Math.max(0, ...rows.map((r) => r.count));
    return scaleBands(rows).map((r) => ({
      ...r,
      // the slowest step is where intervening pays — mark it, don't make the
      // reader compare four numbers to find it
      isWorst: r.count === worst && worst > 0,
    }));
  }

  /**
   * Compliance by contract — which agreements are actually carrying the risk.
   *
   * The portfolio score says 50%; it does not say WHICH contract is failing,
   * which is the only version of the number anyone can act on.
   */
  get complianceByContract() {
    let rows = this.contracts
      .map((c: any) => {
        let obs = this.obligationsAll.filter(
          (o: any) => o?.contract?.id === c.id,
        );
        let open = obs.filter((o: any) => o.status !== 'closed');
        let met = open.filter(
          (o: any) => o.status === 'on_track' || o.status === 'due_soon',
        );
        return {
          id: c.id,
          label: c.cardTitle ?? c.contractNumber ?? 'Untitled',
          total: open.length,
          met: met.length,
          count: open.length ? Math.round((met.length / open.length) * 100) : 0,
          overdue: open.length - met.length,
        };
      })
      // A contract with no obligations has no compliance to report — showing
      // it at 0% would read as failing when nothing is owed.
      .filter((r) => r.total > 0)
      .sort((a, b) => a.count - b.count);
    return scaleBands(rows).map((r) => ({ ...r, pct: r.count }));
  }

  /**
   * Compliance trend, from the obligations' own completion dates.
   *
   * Six months back, each point = share of obligations due in that month that
   * were closed. Derived, not stored: the realm keeps no snapshot history, and
   * a fabricated series on a compliance screen is worse than no series.
   */
  get complianceTrend() {
    let now = new Date();
    let months: { label: string; pct: number; n: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      let start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      let end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      let due = this.obligationsAll.filter((o: any) => {
        let d = o?.nextDueDate ? new Date(o.nextDueDate) : null;
        return d && d >= start && d < end;
      });
      let done = due.filter((o: any) => o?.closedAt);
      months.push({
        label: start.toLocaleString(undefined, { month: 'short' }),
        pct: due.length ? Math.round((done.length / due.length) * 100) : 0,
        n: due.length,
      });
    }
    return months;
  }

  /** True when no month in the window had anything due — say so, don't draw a flat line at zero. */
  get trendHasData(): boolean {
    return this.complianceTrend.some((m) => m.n > 0);
  }

  get riskBands() {
    let bands = ['critical', 'high', 'medium', 'low'];
    let rows = bands
      .map((grade) => {
        let cards = this.contracts.filter((c) => c.riskGrade === grade);
        return {
          grade,
          label: riskGradeLabel(grade),
          count: cards.length,
          hue: (grade === 'critical'
            ? 'red'
            : grade === 'high'
              ? 'orange'
              : grade === 'medium'
                ? 'amber'
                : 'green') as Hue,
        };
      })
      .filter((b) => b.count);
    return scaleBands(rows);
  }

  get statusBands() {
    let rows = CONTRACT_STATUSES.map((o) => ({
      value: o.value,
      label: o.label ?? o.value,
      hue: (o.hue ?? 'slate') as Hue,
      count: this.contracts.filter((c) => c.status === o.value).length,
    })).filter((b) => b.count);
    return scaleBands(rows);
  }

  get renewalRows(): Contract[] {
    return this.contracts
      .filter((c) => {
        let d = c.daysToNotice;
        return typeof d === 'number' && d <= NOTICE_WINDOW_DAYS;
      })
      .sort((a, b) => (a.daysToNotice ?? 0) - (b.daysToNotice ?? 0));
  }

  @consume(CardCrudFunctionsContextName)
  declare cardCrud: CardCrudFunctions | undefined;

  /**
   * Who is recording the decision.
   *
   * PLATFORM GAP, handled rather than ignored. A card has no reachable identity
   * of the signed-in user — `CardContext` exposes the store, queries and
   * components, and nothing else — so the app cannot stamp the actor itself.
   *
   * Leaving it blank was the previous behaviour and it produced audit entries
   * reading "Someone — Placed on hold". An audit trail whose central question
   * is "who decided this" cannot answer "someone"; that is not a trail, it is a
   * log of anonymous events.
   *
   * So the actor is DECLARED, and the UI says it is declared. Weaker than a
   * system identity — a person could name a colleague — and that weakness is
   * stated next to the control rather than hidden behind it.
   */
  @tracked actingAs: Employee | undefined;

  get employees(): Employee[] {
    return ((this.employeeQuery?.instances ?? []) as any[]).filter(
      Boolean,
    ) as Employee[];
  }

  setActingAsFromEvent = (event: Event) => {
    let id = (event.target as HTMLSelectElement)?.value;
    this.actingAs = this.employees.find((e) => e.id === id);
  };

  // `name` first: it is a stored attribute and always present on a query row,
  // whereas `cardTitle` is computed and read as '' on rows whose cardInfo has
  // not resolved — which is how the approver dropdown rendered six blank
  // options and the STEP column showed nobody.
  employeeLabel = (e: any): string => personLabel(e);

  /** Free-text conditions typed into the tray before "Approve with conditions". */
  @tracked decisionNote = '';
  @tracked decisionBusy = false;
  @tracked decisionProblem: string | undefined;
  @tracked lastDecision: string | undefined;

  /**
   * BoxelInput's `@onInput` hands over the VALUE, not the event — it wires
   * `{{on 'input' (pick 'target.value' @onInput)}}` internally.
   *
   * Reading `event.target.value` off a string gave `undefined`, the `?? ''`
   * turned that into an empty string, and `@value` bound it straight back — so
   * every keystroke reset the field and the textarea could not be typed in.
   */
  setDecisionNote = (value: string) => {
    this.decisionNote = value ?? '';
  };

  /**
   * Record a decision.
   *
   * WHAT THIS DOES AND DOES NOT DO. It writes an AuditEntry — the durable,
   * append-only record of what was decided, by whom, with what conditions.
   * It does NOT advance `approvalChain.currentStepIndex` on the contract,
   * because a card's own fields are edited through its edit format and this
   * app has no write path to another card's fields.
   *
   * That split is stated in the UI rather than hidden: the tray says the
   * decision is recorded and the chain is advanced on the contract. A button
   * that claimed to advance the chain and silently didn't would be the worst
   * of the three options — the reviewer would believe the work was done.
   */
  private recordDecision = async (action: string, withConditions = false) => {
    let make = this.cardCrud?.createCard;
    let realm = this.realmList[0];
    let ref = identifyCard(AuditEntry);
    let subject: any = this.leadApproval;
    if (!make || !realm || !ref || !subject) {
      this.decisionProblem =
        'No write access in this context — open the app in the interactive host.';
      return;
    }
    if (!this.actingAs?.id) {
      this.decisionProblem =
        'Choose who is deciding before recording anything.';
      return;
    }
    // Is this person actually the one the step is waiting on?
    //
    // Until now the app checked only that SOMEBODY was named, so Dana Kim
    // could approve a step assigned to Marcus Webb and the audit trail would
    // record it as legitimate. Ironclad hides the Approve button entirely
    // until it is your turn; the same idea, stated rather than hidden, so the
    // reader learns whose decision it actually is.
    let step: any = openStep(subject);
    let expected = step?.delegatedTo?.id ?? step?.approver?.id;
    if (expected && expected !== this.actingAs.id) {
      let name = personLabelOrUndefined(step?.delegatedTo) ?? personLabelOrUndefined(step?.approver);
      this.decisionProblem =
        `This step is waiting on ${name}. Switch "Acting as" to them, or use Delegate to hand it over.`;
      return;
    }
    if (withConditions && !this.decisionNote.trim()) {
      this.decisionProblem =
        'Say what the condition is. An approval "with conditions" that names none is just an approval.';
      return;
    }
    this.decisionBusy = true;
    this.decisionProblem = undefined;
    try {
      await make(ref, new URL(realm), {
        realmURL: new URL(realm),
        // Keeps new entries inside the mirror directory, so they push with
        // the rest of it. Without this the card lands at the realm root —
        // `interact-submode.gts` used to forward `localDir` only on its
        // empty-instance branch and drop it whenever `doc` was supplied, which
        // put audit entries outside the directory they belong to.
        localDir: this.localDirFor('AuditEntry'),
        doc: {
          data: {
            // `doc` is a LooseSingleCardDocument — it carries its own
            // `meta.adoptsFrom`, and omitting it fails with
            // "Cannot read properties of undefined (reading 'adoptsFrom')"
            // rather than anything that names the missing field.
            meta: { adoptsFrom: ref },
            attributes: {
              action,
              occurredAt: new Date().toISOString(),
              subjectTitle: subject.cardTitle,
              note: this.decisionNote.trim() || null,
              conditions: withConditions ? this.decisionNote.trim() : null,
            },
            relationships: {
              doneBy: { links: { self: this.actingAs.id } },
              // `subject` is a linksTo now, so it belongs in relationships —
              // writing it as an attribute silently produced no link at all.
              subject: { links: { self: subject.id } },
            },
          },
        },
      } as any);
      // The audit entry is the record; the chain is the STATE. Both must move,
      // or the queue shows the same step forever after it was decided.
      await this.advanceChain(subject, action, this.decisionNote.trim());
      this.lastDecision = auditActionLabel(action);
      this.decisionNote = '';
    } catch (error: any) {
      this.decisionProblem = error?.message ?? 'Could not record the decision.';
    } finally {
      this.decisionBusy = false;
    }
  };

  approve = () => this.recordDecision('approved');
  approveWithConditions = () => this.recordDecision('approved_with_conditions', true);
  reject = () => this.recordDecision('rejected');
  delegate = () => this.recordDecision('delegated');
  hold = () => this.recordDecision('on_hold');

  /**
   * Where new records belong, derived from where this app card itself lives.
   *
   * The app sits at `<realm>/<dir>/ContractExecutionApp/northlight.json`, so
   * `<dir>` is the mirror directory every sibling record must share.
   */
  localDirFor = (folder: string): string | undefined => {
    let id = (this.args.model as any)?.id as string | undefined;
    let realm = this.realmList[0];
    if (!id || !realm) return undefined;
    let rest = id.startsWith(realm) ? id.slice(realm.length) : '';
    let parts = rest.split('/').filter(Boolean);
    // drop ['ContractExecutionApp', 'northlight'] to leave the mirror prefix
    let prefix = parts.slice(0, -2).join('/');
    return prefix ? `${prefix}/${folder}` : folder;
  };

  /**
   * SUBMIT FOR APPROVAL — the action that puts a contract into the queue.
   *
   * This is what the rules engine was always for. `evaluateRules` already
   * computes which approvers a contract needs; until now that answer was only
   * used to EXPLAIN a chain someone had hand-written into the JSON. Here it
   * builds the chain, which is the difference between a rules engine and a
   * rules description.
   *
   * A contract enters the queue when a step has `decision: 'pending'` —
   * `currentStepIndex` is computed from exactly that, so there is no index to
   * maintain and no state machine to keep in sync.
   */
  submitForApproval = async (contract: any) => {
    let store = this.args.context?.store;
    if (!store || !contract?.id) {
      this.submitProblem = 'No write access in this context.';
      return;
    }
    let fired = evaluateRules(this.rules, {
      contractType: contract.contractType,
      value: contract.value,
      riskGrade: contract.riskGrade,
      deviationCount: this.deviationCountFor(contract.id),
      handlesSensitiveData: contract.handlesSensitiveData,
    });
    // De-duplicated in order: two rules that both demand Legal produce one
    // Legal step, and it sits at the earliest position either rule wanted.
    let roles: string[] = [];
    for (let f of fired) {
      for (let r of f.roles) if (!roles.includes(r)) roles.push(r);
    }
    // No rule matched. Submit anyway, against a default reviewer.
    //
    // The earlier build refused here, which was defensible on paper and wrong
    // in use: a contract that matches no rule is the COMMON case (a small
    // pilot, a routine renewal), and answering a submit with a refusal makes
    // the button feel broken. Real products carry a catch-all reviewer for
    // exactly this; the fallback is named in the message so nobody mistakes it
    // for a rule that fired.
    let usedFallback = false;
    if (!roles.length) {
      if (this.rulesLoading) {
        this.submitProblem = 'Approval rules are still loading — try again in a moment.';
        return;
      }
      roles = [DEFAULT_REVIEWER];
      usedFallback = true;
    }

    this.submitBusy = true;
    this.submitProblem = undefined;
    try {
      let now = new Date().toISOString();
      await store.patch(contract.id, {
        attributes: {
          approvalChain: {
            startedAt: now,
            steps: roles.map((role, i) => ({
              // Only the first step opens; the rest wait their turn, which is
              // what makes the queue sequential rather than a free-for-all.
              decision: 'pending',
              openedAt: i === 0 ? now : null,
              comment: `Required by: ${fired.find((f) => f.roles.includes(role))?.name ?? role}`,
            })),
          },
        },
      });
      this.submitNote = usedFallback
        ? `Submitted to ${roles.join(' → ')} — no approval rule matched this contract, so the default reviewer was used.`
        : `Submitted — ${roles.length} approver${roles.length === 1 ? '' : 's'}: ${roles.join(' → ')} (${fired.map((f) => f.name).join('; ')})`;
    } catch (error: any) {
      this.submitProblem = error?.message ?? 'Could not submit for approval.';
    } finally {
      this.submitBusy = false;
    }
  };

  /**
   * Never submitted: no chain at all.
   *
   * Deliberately not keyed on `status`. A contract can sit at "draft" with a
   * chain already running, and one marked "signed" by hand may never have been
   * through approval — the chain is the fact, the status is a label.
   */
  needsSubmission = (c: any): boolean =>
    ((c?.approvalChain?.steps ?? []).filter(Boolean).length === 0);

  /** Has a chain with somewhere still to go. */
  isInFlight = (c: any): boolean => Boolean(openStep(c));

  /** The live query has not answered yet — not the same as "there are none". */
  get rulesLoading(): boolean {
    return Boolean(this.ruleQuery?.isLoading);
  }

  /**
   * MARK AS SIGNED — records that a contract was executed.
   *
   * NOT an e-signature dispatch. The spec assigns sending to a colleague's app
   * and this one has nothing to call; what it can honestly own is the fact that
   * signing happened, the date it happened, and an audit entry saying who
   * recorded it. The button says "Mark as signed" rather than "Sign" for that
   * reason — it records, it does not execute.
   *
   * Exists because the submit flow told people to "sign it directly" while the
   * app offered no way to do so. A message that points at a missing action is
   * worse than no message.
   */
  markSigned = async (contract: any) => {
    let store = this.args.context?.store;
    if (!store || !contract?.id) {
      this.submitProblem = 'No write access in this context.';
      return;
    }
    if (!this.actingAs?.id) {
      this.submitProblem =
        'Choose who is recording this on the Approvals tab first — a signature recorded by nobody is not a record.';
      return;
    }
    this.submitBusy = true;
    this.submitProblem = undefined;
    try {
      let today = new Date();
      let day = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;
      await store.patch(contract.id, {
        attributes: { status: 'signed', signedAt: day },
      });
      let ref = identifyCard(AuditEntry);
      let realm = this.realmList[0];
      let make = this.cardCrud?.createCard;
      if (make && ref && realm) {
        await make(ref, new URL(realm), {
          realmURL: new URL(realm),
          localDir: this.localDirFor('AuditEntry'),
          doc: {
            data: {
              meta: { adoptsFrom: ref },
              attributes: {
                action: 'signed',
                occurredAt: new Date().toISOString(),
                subjectTitle: contract.cardTitle,
                note: 'Recorded as signed from the repository.',
              },
              relationships: {
                doneBy: { links: { self: this.actingAs.id } },
                subject: { links: { self: contract.id } },
              },
            },
          },
        } as any);
      }
      this.submitNote = `${contract.cardTitle ?? 'Contract'} marked as signed on ${day}.`;
    } catch (error: any) {
      this.submitProblem = error?.message ?? 'Could not mark it as signed.';
    } finally {
      this.submitBusy = false;
    }
  };

  /** Ready to sign: no chain needed, or the chain finished with an approval. */
  isSignable = (c: any): boolean => {
    if (c?.status === 'signed' || c?.status === 'terminated' || c?.status === 'expired') return false;
    let steps = (c?.approvalChain?.steps ?? []).filter(Boolean);
    if (!steps.length) return true;
    let idx = c?.approvalChain?.currentStepIndex ?? 0;
    // past the end AND nothing was rejected
    return idx >= steps.length && !steps.some((st: any) => st?.decision === 'rejected');
  };

  @tracked submitBusy = false;
  @tracked submitProblem: string | undefined;

  /** Disabled while busy or while the rules that drive it are still arriving. */
  get submitDisabled(): boolean {
    return this.submitBusy || this.rulesLoading;
  }

  @tracked submitNote: string | undefined;

  /**
   * Advance the chain by writing the decision onto the step.
   *
   * `currentStepIndex` is `computeVia` over the steps' decisions, so setting
   * this step's decision IS the advance — there is no stored index to update.
   * An earlier version of this app claimed otherwise and stopped short here;
   * the blocker was never the index, it was that nothing called `store.patch`.
   *
   * `containsMany` patches replace the whole array, so the untouched steps are
   * rewritten as they were rather than being dropped.
   */
  private advanceChain = async (contract: any, action: string, note: string) => {
    let store = this.args.context?.store;
    let steps = (contract?.approvalChain?.steps ?? []).filter(Boolean);
    // Derive the open step here rather than reading the chain's computed
    // `currentStepIndex`: a live-query row does not always carry computed
    // fields, and an `undefined` index silently skipped the write.
    let idx = steps.findIndex((st: any) => (st?.decision ?? 'pending') === 'pending');
    if (!store || !contract?.id || idx < 0 || idx >= steps.length) return;
    // `delegated` needs a hand-over target the tray does not collect yet; it
    // is recorded in the audit log only (see the Delegate button's title).
    if (action === 'delegated') return;
    let now = new Date().toISOString();
    // Every date goes out as an ISO string or null. A live-query step can
    // carry an `Invalid Date` (a DateTimeField deserialized from a value the
    // index never had), and passing that through `store.patch` fails the whole
    // save with "RangeError: Invalid time value" — silently, from the tray's
    // point of view, because the audit entry had already been written.
    let iso = (v: any): string | null => {
      if (v == null || v === '') return null;
      let d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };
    let decided = action === 'approved' || action === 'approved_with_conditions';
    let isLast = idx === steps.length - 1;
    let attributes: Record<string, any> = {
      approvalChain: {
        startedAt: iso(contract.approvalChain?.startedAt) ?? now,
        steps: steps.map((st: any, i: number) => {
          let base = {
            decision: st?.decision ?? 'pending',
            decidedAt: iso(st?.decidedAt),
            openedAt: iso(st?.openedAt),
            comment: st?.comment ?? null,
            conditions: st?.conditions ?? null,
            holdReason: st?.holdReason ?? null,
          };
          if (i === idx) {
            if (action === 'on_hold') {
              return { ...base, holdReason: note || 'On hold' };
            }
            if (action === 'rejected') {
              return { ...base, decision: 'rejected', decidedAt: now, comment: note || base.comment, holdReason: null };
            }
            // approved / approved_with_conditions
            return {
              ...base,
              decision: 'approved',
              decidedAt: now,
              comment: action === 'approved' ? note || base.comment : base.comment,
              conditions: action === 'approved_with_conditions' ? note : base.conditions,
              holdReason: null,
            };
          }
          if (i === idx + 1 && decided) {
            return { ...base, openedAt: now };
          }
          return base;
        }),
      },
    };
    // The last approval is what makes the contract `approved` — the state
    // Request Signature requires. Only the pipeline stages move here; a
    // signed or terminated contract keeps its status.
    if (decided && isLast && ['draft', 'negotiating', 'in review'].includes(contract.status)) {
      attributes.status = 'approved';
    }
    await store.patch(contract.id, { attributes });
  };

  /** Can a decision be recorded at all here? */
  get canDecide(): boolean {
    return Boolean(this.cardCrud?.createCard && this.realmList[0]);
  }

  // ---- actions ------------------------------------------------------------

  @action setTab(key: string) {
    this.tab = key;
  }

  @action openCard(card: CardDef) {
    (this.args as any).viewCard?.(card, 'isolated');
  }

  statusHueOf = (value?: string | null): Hue =>
    (contractStatusOption(value)?.hue ?? 'slate') as Hue;

  statusLabelOf = (value?: string | null): string => contractStatusLabel(value);

  statusHueOf = (value?: string | null): Hue =>
    (CONTRACT_STATUSES.find((o) => o.value === value)?.hue ?? 'slate') as Hue;

  stepLabelOf = (c: any): string => humanise(this.stepStateOf(c));

  typeLabelOf = (value?: string | null): string => contractTypeLabel(value);

  riskLabelOf = (value?: string | null): string => riskGradeLabel(value);

  obligationLabelOf = (value?: string | null): string =>
    obligationStateLabel(value);

  riskHueOf = (grade?: string | null): Hue =>
    grade === 'critical'
      ? 'red'
      : grade === 'high'
        ? 'orange'
        : grade === 'medium'
          ? 'amber'
          : grade === 'low'
            ? 'green'
            : 'slate';

  obligationHueOf = (state?: string | null): Hue =>
    state === 'overdue'
      ? 'red'
      : state === 'due_today'
        ? 'orange'
        : state === 'due_soon'
          ? 'amber'
          : state === 'closed'
            ? 'slate'
            : 'green';

  <template>
    <div class='cx'>
      <header class='cx-mast' aria-label='Workspace summary'>
        <div class='cx-brand'>
          <span class='cx-seal'><ScaleIcon role='presentation' /></span>
          <div>
            <h1 class='cx-title'>{{@model.cardTitle}}</h1>
            <p class='cx-sub'>Contract lifecycle management</p>
          </div>
        </div>

        <dl class='cx-counters'>
          <div class='cx-ct {{if this.overdueCount "is-alarm"}}'>
            <dt>Overdue</dt>
            <dd>
              {{#if this.overdueCount}}
                <TriangleAlertIcon role='presentation' />
              {{/if}}
              {{this.overdueCount}}
            </dd>
          </div>
          <div class='cx-ct'>
            <dt>In approval</dt>
            <dd>{{this.awaitingCount}}</dd>
          </div>
          <div class='cx-ct'>
            <dt>Notice 90d</dt>
            <dd>{{this.noticeSoonCount}}</dd>
          </div>
          <div class='cx-ct'>
            <dt>Compliance</dt>
            <dd>{{this.complianceLabel}}</dd>
          </div>
        </dl>
      </header>

      {{#if this.isInteractive}}
        {{#if this.unresolvedNote}}
          <p class='cx-unresolved' role='status'>{{this.unresolvedNote}}</p>
        {{/if}}

        <nav class='cx-tabs' aria-label='Sections'>
          {{#each TABS as |t|}}
            <button
              type='button'
              class='cx-tab'
              aria-current={{if (eq this.tab t.key) 'page'}}
              {{on 'click' (fn this.setTab t.key)}}
            >{{t.label}}{{#let (this.tabCount t.key) as |n|}}{{#if n}}<span
                  class='cx-tab-n {{if (this.tabIsHot t.key) "is-hot"}}'
                >{{n}}</span>{{/if}}{{/let}}</button>
          {{/each}}
        </nav>

        <div class='cx-split {{unless this.railApplies "is-full"}}'>
          {{#if this.railApplies}}
            <nav class='cx-rail' aria-label='Saved views'>
              <p class='cx-rail-h'>Saved views</p>
              <FilterList
                @filters={{this.savedViews}}
                @activeFilter={{this.currentView}}
                @onChanged={{this.setView}}
              />
              <p class='cx-rail-note'>
                  </p>
            </nav>
          {{/if}}

          <main class='cx-panel'>
            {{#if (eq this.tab 'home')}}
              <LegalHome
                @context={{@context}}
                @realms={{this.realmList}}
                @onOpen={{this.openInWorkspace}}
              />

            {{else if (eq this.tab 'workspace')}}
              {{#if this.workspaceLive}}
                {{#let this.workspaceLive as |c|}}
                  <section class='cx-sec cx-ws' aria-label='Contract workspace'>
                    {{! the switcher stays visible: the reader should never
                        wonder whether other contracts exist }}
                    <nav class='cx-ws-switch' aria-label='Switch contract'>
                      <span class='cx-ws-switch-label'>Contract</span>
                      {{#each this.contracts as |other|}}
                        <button
                          type='button'
                          class='cx-ws-chip {{if (eq other.id c.id) "is-active"}}'
                          aria-current={{if (eq other.id c.id) 'true'}}
                          title={{other.cardTitle}}
                          {{on 'click' (fn this.openInWorkspace other)}}
                        >
                          <span class='cx-ws-chip-dot hue-{{this.statusHueOf other.status}}' aria-hidden='true'></span>
                          <span class='cx-ws-chip-name'>{{other.cardTitle}}</span>
                        </button>
                      {{/each}}
                    </nav>
                    <div class='cx-ws-head'>
                      <div class='cx-ws-id'>
                        <h2 class='cx-h'>{{c.cardTitle}}</h2>
                        <p class='cx-note'>{{this.statusLabelOf c.status}}
                          {{#if c.contractNumber}}· {{c.contractNumber}}{{/if}}
                          {{#if c.value.amount}}· {{formatMoney c.value.amount c.value.currency.code}}{{/if}}</p>
                      </div>
                      <div class='cx-ws-actions'>
                        <button
                          type='button'
                          class='cx-submit'
                          {{on 'click' (fn this.openCard c)}}
                        >Open card</button>
                        <button
                          type='button'
                          class='cx-submit is-quiet'
                          {{on 'click' this.clearWorkspace}}
                        >Pick another</button>
                      </div>
                    </div>

                    <ContractWorkspace
                      @contract={{c}}
                      @context={{@context}}
                      @onOpen={{this.openCard}}
                    />

                    <SignatureBlockView
                      @blocks={{this.workspaceBlocks}}
                      @contractValue={{c.value.amount}}
                      @contractCurrency={{c.value.currency.code}}
                      @contractType={{c.contractType}}
                    />

                    <div class='cx-ceremony-bar'>
                      <label class='cx-provider'>
                        <span>Provider</span>
                        <input
                          type='text'
                          value={{this.signatureProvider}}
                          {{on 'input' this.setProvider}}
                        />
                      </label>
                      <button
                        type='button'
                        class='cx-submit'
                        disabled={{this.ceremonyBusy}}
                        title='approved → out for signature; sends the next line in signing order after re-checking authority'
                        {{on 'click' this.requestSignature}}
                      >Request signature</button>
                      <button
                        type='button'
                        class='cx-submit is-quiet'
                        disabled={{this.ceremonyBusy}}
                        title='Re-derive every authority and order check from current data; writes nothing'
                        {{on 'click' this.verifySignatures}}
                      >Verify signatures</button>
                      <button
                        type='button'
                        class='cx-submit is-sign'
                        disabled={{or this.ceremonyBusy this.workspaceDataLoading}}
                        title='out for signature → signed; refuses unless every line is signed and verification is clean; snapshots a version'
                        {{on 'click' this.executeContract}}
                      >Execute contract</button>
                      <button
                        type='button'
                        class='cx-submit is-quiet'
                        disabled={{or this.ceremonyBusy this.workspaceDataLoading}}
                        title='Assemble the full agreement markdown into fullText'
                        {{on 'click' this.generateDocument}}
                      >Generate document</button>
                    </div>
                    {{#if this.ceremonyProblem}}
                      <p class='cx-submit-msg is-err' role='alert'>{{this.ceremonyProblem}}</p>
                    {{else if this.ceremonyNote}}
                      <p class='cx-submit-msg is-ok' role='status'>{{this.ceremonyNote}}</p>
                    {{/if}}
                    {{#if this.ceremonyFindings.length}}
                      <ul class='cx-findings'>
                        {{#each this.ceremonyFindings as |f|}}<li>{{f}}</li>{{/each}}
                      </ul>
                    {{/if}}
                  </section>
                {{/let}}
              {{else}}
                <section class='cx-sec' aria-label='Pick a contract'>
                  <h2 class='cx-h'>Workspace</h2>
                  <p class='cx-note'>Pick a contract to review it clause by clause and run its signature ceremony. Legal Home and the repository also land here.</p>
                  <ul class='cx-pick'>
                    {{#each this.contracts as |c|}}
                      <li>
                        <button
                          type='button'
                          class='cx-pick-row'
                          {{on 'click' (fn this.openInWorkspace c)}}
                        >
                          <span class='cx-pick-name'>{{c.cardTitle}}</span>
                          <StatePill
                            @label={{this.statusLabelOf c.status}}
                            @hue={{this.statusHueOf c.status}}
                            @dot={{true}}
                          />
                        </button>
                      </li>
                    {{else}}
                      <li class='cx-none'>No contracts in this realm yet.</li>
                    {{/each}}
                  </ul>
                </section>
              {{/if}}

            {{else if (eq this.tab 'repository')}}
              {{#if this.submitProblem}}
                <p class='cx-submit-msg is-err' role='alert'>{{this.submitProblem}}</p>
              {{else if this.submitNote}}
                <p class='cx-submit-msg is-ok' role='status'>{{this.submitNote}}</p>
              {{/if}}
              <CollectionPanel
              @cardClass={{Contract}}
              @context={{@context}}
              @realms={{this.realmList}}
              @columns={{CONTRACT_COLUMNS}}
              @label='Contracts'
              @searchPlaceholder='Search contracts…'
                @newLabel='New contract'
                @defaultView='table'
                @rowFilter={{this.activeViewTest}}
              >
                <:cell as |row column|>
                  {{#if (eq column.key 'submit')}}
                    {{#if (this.needsSubmission row)}}
                      <button
                        type='button'
                        class='cx-submit'
                        disabled={{this.submitDisabled}}
                        title={{if
                          this.rulesLoading
                          'Approval rules are still loading'
                          'Build the approval chain from the rules that match this contract'
                        }}
                        {{on 'click' (fn this.submitForApproval row)}}
                      >{{if this.rulesLoading 'Loading rules…' 'Submit for approval'}}</button>
                    {{else if (this.isInFlight row)}}
                      <span class='cx-none'>in approval</span>
                    {{else if (this.isSignable row)}}
                      <button
                        type='button'
                        class='cx-submit is-sign'
                        disabled={{this.submitBusy}}
                        {{on 'click' (fn this.markSigned row)}}
                      >Mark as signed</button>
                    {{else}}
                      <span class='cx-none'>{{this.statusLabelOf row.status}}</span>
                    {{/if}}
                  {{else if (eq column.key 'status')}}
                    <StatePill
                      @label={{this.statusLabelOf row.status}}
                      @hue={{this.statusHueOf row.status}}
                      @dot={{true}}
                    />
                  {{else if (eq column.key 'riskGrade')}}
                    <StatePill
                      @label={{this.riskLabelOf row.riskGrade}}
                      @hue={{this.riskHueOf row.riskGrade}}
                      @dot={{true}}
                    />
                  {{/if}}
                </:cell>
              </CollectionPanel>

            {{else if (eq this.tab 'approvals')}}
            <section class='cx-sec cx-ap-split' aria-label='Approval queue'>
              <div class='cx-ap-list'>
                <h2 class='cx-h'>Waiting on an approver
                  <span class='cx-h-sub'>{{this.approvalRows.length}}</span></h2>
                <p class='cx-note'>Pick a contract to review it. Longest waiting first.</p>
                <Table
                  @columns={{APPROVAL_COLUMNS}}
                  @items={{this.approvalRows}}
                  @onRowClick={{this.selectApproval}}
                  @caption='Open approval steps, longest waiting first'
                  @emptyMessage='No contract is waiting on an approval.'
                  @rowClass={{this.approvalRowClass}}
                >
                  <:cell as |row column|>
                    {{#if (eq column.key 'step')}}
                      <StatePill
                        @label={{this.stepLabelOf row}}
                        @hue='blue'
                        @dot={{true}}
                      />
                    {{else if (eq column.key 'riskGrade')}}
                      <StatePill
                        @label={{this.riskLabelOf row.riskGrade}}
                        @hue={{this.riskHueOf row.riskGrade}}
                        @dot={{true}}
                      />
                    {{/if}}
                  </:cell>
                </Table>
              </div>

              <div class='cx-ap-detail'>
              {{#if this.leadApproval}}
                <article class='cx-ap'>
                  <header class='cx-ap-head' aria-label='Contract awaiting your approval'>
                    <div class='cx-ap-id'>
                      <h2 class='cx-ap-t'>{{this.leadApproval.cardTitle}}</h2>
                      <p class='cx-ap-m'>
                        {{this.leadApproval.contractNumber}}
                        {{#if this.leadApproval.account}}
                          · {{this.leadApproval.account.cardTitle}}
                        {{/if}}
                      </p>
                    </div>
                    <p class='cx-ap-amt'>{{this.leadValueLabel}}</p>
                  </header>

                  <ol class='cx-chain' aria-label='Approval chain'>
                    {{#each this.leadChain as |st|}}
                      <li class='cx-step is-{{st.state}}'>
                        <span class='cx-step-bar'></span>
                        <span class='cx-step-n'>Step {{st.index}} of {{st.total}}
                          · {{st.state}}</span>
                        {{#if st.needsApprover}}
                          <div class='cx-assign'>
                            <label
                              class='cx-assign-l'
                              for='cx-assign-{{st.index}}'
                            >Assign approver</label>
                            <select
                              class='cx-assign-sel'
                              id='cx-assign-{{st.index}}'
                              disabled={{this.assignBusy}}
                              {{on 'change' (fn this.assignApprover st.zeroIndex)}}
                            >
                              <option value=''>Unassigned — pick someone</option>
                              {{#each this.employees as |who|}}
                                <option value={{who.id}}>
                                  {{this.employeeLabel who}}
                                </option>
                              {{/each}}
                            </select>
                          </div>
                        {{else}}
                          <span class='cx-step-who'>{{st.who}}</span>
                        {{/if}}
                        <span class='cx-step-w'>{{st.role}}
                          {{#if st.when}}· {{st.when}}{{/if}}</span>
                      </li>
                    {{/each}}
                  </ol>

                  <section class='cx-tray' aria-label='Record a decision'>
                    <h3 class='cx-h'>Your decision</h3>
                    {{#if this.canDecide}}
                      <div class='cx-tray-who'>
                        <label class='cx-tray-l' for='cx-acting'>Acting as</label>
                        {{#if this.expectedApproverName}}
                          <span class='cx-tray-expect'>this step is
                            {{this.expectedApproverName}}'s</span>
                        {{/if}}
                        {{! A native select, not BoxelSelect.
                            ember-power-select mounts its dropdown through a
                            wormhole into the host document; inside a card's
                            isolated template that left the whole app wedged —
                            after opening Approvals, even tab switching stopped
                            responding. A native select needs no portal, is
                            keyboard-accessible for free, and this list is short. }}
                        <select
                          class='cx-acting'
                          id='cx-acting'
                          {{on 'change' this.setActingAsFromEvent}}
                        >
                          <option value=''>Choose who is deciding</option>
                          {{#each this.employees as |who|}}
                            <option value={{who.id}} selected={{eq who.id this.actingAs.id}}>
                              {{this.employeeLabel who}}
                            </option>
                          {{/each}}
                        </select>
                      </div>

                      <BoxelInput
                        class='cx-tray-note'
                        @type='textarea'
                        @value={{this.decisionNote}}
                        @onInput={{this.setDecisionNote}}
                        @placeholder='Reason, or the condition that must be met'
                      />
                      <div class='cx-tray-row'>
                        <Button
                          @kind='primary'
                          @disabled={{this.decisionBusy}}
                          {{on 'click' this.approve}}
                        >Approve</Button>
                        <Button
                          @kind='secondary'
                          @disabled={{this.decisionBusy}}
                          {{on 'click' this.approveWithConditions}}
                        >Approve with conditions</Button>
                        <Button
                          @kind='secondary'
                          @disabled={{this.decisionBusy}}
                          title='Recorded in the audit log only — the tray has no hand-over target yet'
                        {{on 'click' this.delegate}}
                        >Delegate</Button>
                        <Button
                          @kind='secondary'
                          @disabled={{this.decisionBusy}}
                          {{on 'click' this.hold}}
                        >Put on hold</Button>
                        <Button
                          @kind='secondary'
                          class='cx-danger'
                          @disabled={{this.decisionBusy}}
                          {{on 'click' this.reject}}
                        >Reject</Button>
                      </div>

                      {{#if this.decisionProblem}}
                        <p class='cx-tray-err' role='alert'>{{this.decisionProblem}}</p>
                      {{else if this.lastDecision}}
                        <p class='cx-tray-ok' role='status'>Recorded:
                          {{this.lastDecision}}. It appears in the Audit tab.</p>
                      {{/if}}

                      <p class='cx-tray-scope'>Delegate and hold are recorded
                        without moving the contract forward.</p>
                    {{else}}
                      <p class='cx-tray-scope'>Open this card in the app to record
                        a decision.</p>
                    {{/if}}
                  </section>

                  {{#if this.leadVersionPair}}
                    <section class='cx-diff' aria-label='What the last amendment changed'>
                      <h3 class='cx-h'>What changed in the last amendment</h3>
                      <VersionDiff
                        @before={{get this.leadVersionPair 0}}
                        @after={{get this.leadVersionPair 1}}
                      />
                    </section>
                  {{/if}}

                  {{#if this.leadWhy}}
                    <p class='cx-why'>
                      <span class='cx-why-l'>Why this needs approval</span>
                      Approval is required because {{this.leadWhy}}.
                    </p>
                  {{/if}}
                </article>
              {{/if}}

              </div>
            </section>

          {{else if (eq this.tab 'obligations')}}
            <section class='cx-sec' aria-label='Obligation tracker'>
              <div class='cx-kpis'>
                {{#each this.obligationKpis as |k|}}
                  <div class='cx-kpi'>
                    <p class='cx-kpi-l'>{{k.label}}</p>
                    <p class='cx-kpi-v {{if k.alarm "is-alarm"}}'>{{k.value}}{{#if
                        k.unit
                      }}<span class='cx-kpi-u'>{{k.unit}}</span>{{/if}}</p>
                    <p class='cx-kpi-d'>{{k.detail}}</p>
                  </div>
                {{/each}}
              </div>

              {{#each this.obligationGroups as |g|}}
                <div class='cx-group'>
                  <h2 class='cx-h'>
                    <StatePill
                      @label={{g.label}}
                      @hue={{g.hue}}
                      @dot={{true}}
                    />
                    <span class='cx-count'>{{g.rows.length}}</span>
                  </h2>
                  <Table
                    @columns={{OBLIGATION_COLUMNS}}
                    @items={{g.rows}}
                    @onRowClick={{this.openCard}}
                    @emptyMessage='Nothing in this band.'
                  >
                    <:cell as |row column|>
                      {{#if (eq column.key 'status')}}
                        <StatePill
                          @label={{this.obligationLabelOf row.status}}
                          @hue={{this.obligationHueOf row.status}}
                          @dot={{true}}
                        />
                      {{else if (eq column.key 'recurrence')}}
                        <span class='cx-scope'>{{this.recurrenceLabel row}}</span>
                      {{else if (eq column.key 'evidence')}}
                        {{#if (this.hasEvidence row)}}
                          <StatePill @label='Filed' @hue='green' />
                        {{else if (this.evidenceDue row)}}
                          <StatePill @label='Missing' @hue='red' />
                        {{else}}
                          <span class='cx-none'>not due</span>
                        {{/if}}
                      {{/if}}
                    </:cell>
                  </Table>
                </div>
              {{else}}
                <p class='cx-empty'>No obligations are being tracked yet.</p>
              {{/each}}
            </section>

          {{else if (eq this.tab 'compliance')}}
            <section class='cx-sec' aria-label='Compliance'>
              <div class='cx-kpis'>
                <div class='cx-kpi'>
                  <p class='cx-kpi-l'>Median execution time</p>
                  {{#if this.medianExecutionDays}}
                    <p class='cx-kpi-v'>{{this.medianExecutionDays}}<span
                        class='cx-kpi-u'
                      >d</span></p>
                    <p class='cx-kpi-d'>Approval start to signature</p>
                  {{else}}
                    <p class='cx-kpi-v is-none'>—</p>
                    <p class='cx-kpi-d'>No contract yet has both an approval
                      start and a signature date</p>
                  {{/if}}
                </div>

                <div class='cx-kpi'>
                  <p class='cx-kpi-l'>Obligations met</p>
                  <p class='cx-kpi-v'>{{this.complianceLabel}}</p>
                  <ProgressBar
                    class='cx-meter'
                    @value={{this.compliancePct}}
                    @max={{100}}
                    @label='Share of open obligations being met'
                  />
                </div>

                <div class='cx-kpi'>
                  <p class='cx-kpi-l'>Clause deviations</p>
                  <p
                    class='cx-kpi-v {{if this.unapprovedDeviations "is-alarm"}}'
                  >{{this.deviationCount}}</p>
                  <p class='cx-kpi-d'>{{this.unapprovedDeviations}}
                    unapproved</p>
                </div>

                <div class='cx-kpi'>
                  <p class='cx-kpi-l'>Notice inside 90 days</p>
                  <p class='cx-kpi-v'>{{this.noticeSoonCount}}</p>
                  <p class='cx-kpi-d'>{{this.noticeLede}}</p>
                </div>
              </div>

              <div class='cx-charts'>
                <section class='cx-chart' aria-label='Contracts by lifecycle stage'>
                  <h2 class='cx-h'>By lifecycle stage
                    <span class='cx-h-sub'>{{this.contracts.length}}
                      contracts</span></h2>
                  {{#each this.statusBands as |b|}}
                    <div class='cx-band'>
                      <StatePill @label={{b.label}} @hue={{b.hue}} @dot={{true}} />
                      <span class='cx-bar' aria-hidden='true'><span
                          class='cx-bar-fill cx-hue-{{b.hue}}'
                          style={{cssVar cx-pct=b.pct}}
                        ></span></span>
                      <span class='cx-num'>{{b.count}}</span>
                    </div>
                  {{else}}
                    <p class='cx-empty'>No contracts yet.</p>
                  {{/each}}
                  <p class='cx-chart-note'>Bars scale to the largest band, so an
                    even split reads as even rather than as four invisible
                    slivers.</p>
                </section>

                <section class='cx-chart' aria-label='Portfolio value by risk grade'>
                  <h2 class='cx-h'>Portfolio value by risk grade
                    <span class='cx-h-sub'>{{this.portfolioValueLabel}}</span></h2>
                  {{#each this.valueByRisk as |b|}}
                    <div class='cx-band'>
                      <StatePill @label={{b.label}} @hue={{b.hue}} @dot={{true}} />
                      <span class='cx-bar' aria-hidden='true'><span
                          class='cx-bar-fill cx-hue-{{b.hue}}'
                          style={{cssVar cx-pct=b.pct}}
                        ></span></span>
                      <span class='cx-num is-money'>{{b.money}}</span>
                    </div>
                  {{else}}
                    <p class='cx-empty'>No contract carries both a risk grade and
                      a value.</p>
                  {{/each}}
                  <p class='cx-chart-note'>Weighted by value, not by count — four
                    low-value contracts are not the same exposure as one large
                    one.</p>
                </section>

                <section class='cx-chart' aria-label='Compliance by contract'>
                  <h2 class='cx-h'>By contract
                    <span class='cx-h-sub'>worst first</span></h2>
                  {{#each this.complianceByContract as |b|}}
                    <div class='cx-band'>
                      <span class='cx-band-l'>{{b.label}}</span>
                      <span class='cx-bar' aria-hidden='true'><span
                          class='cx-bar-fill
                            {{if b.overdue "cx-hue-red" "cx-hue-green"}}'
                          style={{cssVar cx-pct=b.pct}}
                        ></span></span>
                      <span class='cx-num'>{{b.count}}%</span>
                    </div>
                  {{else}}
                    <p class='cx-empty'>No contract has an open obligation yet.</p>
                  {{/each}}
                  <p class='cx-chart-note'>A contract with nothing owed is left
                    out rather than shown at 0% — no obligations is not the same
                    as failing them.</p>
                </section>

                <section class='cx-chart' aria-label='Compliance trend'>
                  <h2 class='cx-h'>Trend
                    <span class='cx-h-sub'>last 6 months</span></h2>
                  {{#if this.trendHasData}}
                    {{#each this.complianceTrend as |m|}}
                      <div class='cx-band'>
                        <span class='cx-band-l'>{{m.label}}</span>
                        <span class='cx-bar' aria-hidden='true'><span
                            class='cx-bar-fill cx-hue-accent'
                            style={{cssVar cx-pct=m.pct}}
                          ></span></span>
                        <span class='cx-num'>{{if m.n m.pct '—'}}</span>
                      </div>
                    {{/each}}
                    <p class='cx-chart-note'>Share of obligations due that month
                      that were closed. Derived from completion dates — the
                      realm stores no snapshots, and a fabricated series on a
                      compliance screen is worse than none.</p>
                  {{else}}
                    <p class='cx-empty'>Nothing fell due in the last six months,
                      so there is no trend to draw yet.</p>
                  {{/if}}
                </section>

                <section class='cx-chart' aria-label='Median days held per approval step'>
                  <h2 class='cx-h'>Time per approval step
                    <span class='cx-h-sub'>median days</span></h2>
                  {{#each this.timeByStep as |b|}}
                    <div class='cx-band'>
                      <span class='cx-band-l'>{{b.label}}</span>
                      <span class='cx-bar' aria-hidden='true'><span
                          class='cx-bar-fill
                            {{if b.isWorst "cx-hue-red" "cx-hue-accent"}}'
                          style={{cssVar cx-pct=b.pct}}
                        ></span></span>
                      <span class='cx-num'>{{b.count}}d</span>
                    </div>
                  {{else}}
                    <p class='cx-empty'>No approval step has been opened yet.</p>
                  {{/each}}
                  <p class='cx-chart-note'><span
                      class='cx-swatch cx-hue-red'
                    ></span>
                    Slowest step — where intervening pays.</p>
                </section>
              </div>

              <h2 class='cx-h'>Notice deadlines inside 90 days
                <span class='cx-h-sub'>{{this.noticeSoonCount}}</span></h2>
              <Table
                @columns={{NOTICE_COLUMNS}}
                @items={{this.renewalRows}}
                @onRowClick={{this.openCard}}
                @rowClass={{this.contractSeverity}}
                @caption='Contracts whose notice window closes inside 90 days'
                @emptyMessage='No notice deadline falls inside 90 days.'
              >
                <:cell as |row column|>
                  {{#if (eq column.key 'daysToNotice')}}
                    <StatePill @label='{{row.daysToNotice}}d' @hue='amber' />
                  {{/if}}
                </:cell>
              </Table>
            </section>

          {{else if (eq this.tab 'clauses')}}
            <CollectionPanel
              @cardClass={{Clause}}
              @context={{@context}}
              @realms={{this.realmList}}
              @columns={{CLAUSE_COLUMNS}}
              @label='Clause library'
              @searchPlaceholder='Search approved language…'
              @newLabel='New clause'
              @defaultView='table'
              @sortBy='name'
            >
              <:cell as |row column|>
                {{#if (eq column.key 'riskLevel')}}
                  <StatePill
                    @label={{this.clauseRiskLabel row.riskLevel}}
                    @hue={{this.clauseRiskHue row.riskLevel}}
                    @dot={{true}}
                  />
                {{else if (eq column.key 'usedIn')}}
                  {{#let (this.clauseUsage row.id) as |u|}}
                    {{#if u.used}}
                      <span class='cx-fig'>{{u.used}}</span>
                    {{else}}
                      <span class='cx-none'>unused</span>
                    {{/if}}
                  {{/let}}
                {{else if (eq column.key 'deviations')}}
                  {{#let (this.clauseUsage row.id) as |u|}}
                    {{#if u.deviations}}
                      <StatePill @label='{{u.deviations}}' @hue='red' />
                    {{else if u.used}}
                      <span class='cx-none'>none</span>
                    {{else}}
                      <span class='cx-none'>—</span>
                    {{/if}}
                  {{/let}}
                {{/if}}
              </:cell>
            </CollectionPanel>

            <p class='cx-blocked'>
              <span class='cx-blocked-l'>Not yet available</span>
              Clauses are added by hand for now. Reading a contract's text and
              proposing its clauses automatically is not switched on in this
              workspace.</p>

          {{else if (eq this.tab 'signatories')}}
            <CollectionPanel
              @cardClass={{Signatory}}
              @context={{@context}}
              @realms={{this.realmList}}
              @columns={{SIGNATORY_COLUMNS}}
              @label='Signatories'
              @searchPlaceholder='Search signatories…'
              @newLabel='New signatory'
              @defaultView='table'
              @sortBy='signingTitle'
            >
              <:cell as |row column|>
                {{#if (eq column.key 'signatureAuthority')}}
                  <span class='cx-fig is-money'>{{this.authorityLabel row}}</span>
                {{else if (eq column.key 'mySign')}}
                  <span class='cx-scope'>{{this.signScope row}}</span>
                {{else if (eq column.key 'routed')}}
                  {{#let (this.routedCount row) as |n|}}
                    {{#if n}}
                      <span class='cx-fig'>{{n}}</span>
                    {{else}}
                      <span class='cx-none'>—</span>
                    {{/if}}
                  {{/let}}
                {{else if (eq column.key 'isActive')}}
                  {{#if row.isActive}}
                    <StatePill @label='Active' @hue='green' @dot={{true}} />
                  {{else}}
                    <StatePill @label='Inactive' @hue='red' @dot={{true}} />
                  {{/if}}
                {{/if}}
              </:cell>
            </CollectionPanel>

            {{else if (eq this.tab 'renewals')}}
              <section class='cx-sec' aria-label='Renewal calendar'>
                <h2 class='cx-h'>Notice windows, soonest first
                  <span class='cx-h-sub'>{{this.renewalRows.length}}</span></h2>
                <p class='cx-note'>A renewal is decided by the notice date, not
                  the end date — miss the notice window and the contract renews
                  whether or not anyone wanted it to.</p>
                <Table
                  @columns={{NOTICE_COLUMNS}}
                  @items={{this.renewalRows}}
                  @onRowClick={{this.openCard}}
                  @rowClass={{this.contractSeverity}}
                  @caption='Contracts whose notice window closes inside 90 days'
                  @emptyMessage='No notice deadline falls inside 90 days.'
                >
                  <:cell as |row column|>
                    {{#if (eq column.key 'daysToNotice')}}
                      <StatePill @label='{{row.daysToNotice}}d' @hue='amber' />
                    {{/if}}
                  </:cell>
                </Table>

                <p class='cx-blocked'>
                  <span class='cx-blocked-l'>Not yet firing</span>
                  Reminder dates can be set on an obligation, but nothing sends
                  them yet — check this tab rather than waiting to be told.</p>
              </section>

            {{else if (eq this.tab 'templates')}}
              <p class='cx-note'>A starting position for each contract type — the clauses
                it assumes, and what you still have to supply.</p>
              <CollectionPanel
                @cardClass={{ContractTemplate}}
                @context={{@context}}
                @realms={{this.realmList}}
                @columns={{TEMPLATE_COLUMNS}}
                @label='Template library'
                @searchPlaceholder='Search templates by name or use case…'
                @newLabel='Add template'
                @defaultView='table'
                @sortBy='templateName'
              >
                <:cell as |row column|>
                  {{#if (eq column.key 'isPublished')}}
                    {{#if row.isPublished}}
                      <StatePill @label='Published' @hue='green' @dot={{true}} />
                    {{else}}
                      <StatePill @label='Draft' @hue='slate' @dot={{true}} />
                    {{/if}}
                  {{/if}}
                </:cell>
              </CollectionPanel>

            {{else if (eq this.tab 'requests')}}
              <p class='cx-note'>Declined requests are kept, with the reason — so "what
                did we turn down, and why" stays answerable.</p>
              <CollectionPanel
                @cardClass={{ContractRequest}}
                @context={{@context}}
                @realms={{this.realmList}}
                @columns={{REQUEST_COLUMNS}}
                @label='Intake queue'
                @searchPlaceholder='Search requests by what they are for…'
                @newLabel='Raise request'
                @defaultView='table'
                @sortBy='whatFor'
              >
                <:cell as |row column|>
                  {{#if (eq column.key 'status')}}
                    <StatePill
                      @label={{requestStateLabel row.status}}
                      @hue={{requestStateHue row.status}}
                      @dot={{true}}
                    />
                  {{/if}}
                </:cell>
              </CollectionPanel>

            {{else if (eq this.tab 'audit')}}
              <div class='cx-bulkhead'>
                <p class='cx-note'>Every recorded decision, newest first.
                  Entries are written by the decision that caused them.</p>
                <button
                  type='button'
                  class='cx-export'
                  {{on 'click' this.exportAudit}}
                >Export CSV</button>
              </div>
              {{! No add action, deliberately. An audit trail whose entries can
                  be typed in by hand is not evidence of anything — entries are
                  written by the decision that caused them. Search and sort are
                  exactly what an auditor needs; a "New entry" button is the one
                  control that would undermine the tab. }}
              <CollectionPanel
                @cardClass={{AuditEntry}}
                @context={{@context}}
                @realms={{this.realmList}}
                @columns={{AUDIT_COLUMNS}}
                @label='Audit trail'
                @searchPlaceholder='Search by person, action or contract…'
                @defaultView='table'
                @sortBy='occurredAt'
                @allowCreate={{false}}
              >
                <:cell as |row column|>
                  {{#if (eq column.key 'action')}}
                    <StatePill
                      @label={{auditActionLabel row.action}}
                      @hue={{auditActionHue row.action}}
                      @dot={{true}}
                    />
                  {{/if}}
                </:cell>
              </CollectionPanel>
            {{/if}}
          </main>
        </div>
      {{else}}
        <main class='cx-panel cx-static'>
          <p class='cx-static-note'>Contract lifecycle management — repository,
            approvals, obligations and renewals. Open this card in the app to
            work with live records.</p>
          <ul class='cx-legend'>
            {{#each CONTRACT_STATUSES as |o|}}
              <li><StatePill
                  @label={{o.label}}
                  @hue={{o.hue}}
                  @dot={{true}}
                /></li>
            {{/each}}
          </ul>
        </main>
      {{/if}}
    </div>

    <style scoped>
      /* Adapter block: the semantic theme set forwarded once into this app's
         vocabulary. Every value below is a token or a mix of one — no literal
         colours, so a linked Theme flips the whole app. */
      .cx {
        /* Adapter block. Every value forwards a semantic token or is a
           color-mix of one — no colour is invented here, which is what keeps
           the card themeable.

           PAIRED, deliberately: a namespace that names fills but not their
           foregrounds re-creates the same bug class inside the card's own
           vocabulary. --cx-muted-fg carries the "-fg" because it IS a text
           colour; it was called --cx-muted and read as a surface, which is how
           a black-on-black mistake gets written by the next reader. */
        --cx-bg: var(--background);
        --cx-fg: var(--foreground);
        --cx-card: var(--card);
        --cx-card-fg: var(--card-foreground);
        --cx-muted-fg: var(--muted-foreground);
        --cx-rule: color-mix(in oklch, var(--foreground) 12%, transparent);
        --cx-sunk: color-mix(in oklch, var(--foreground) 3%, transparent);
        --cx-sunk-fg: var(--foreground);

        /* WAS NEVER DECLARED. Used 12 times with a var(--boxel-dark) fallback,
           so black was the only value that ever rendered and the accent did not
           follow the theme at all — the "most deceptive" failure, because it
           greps clean and looks compliant. Fills, rules and rings only; the
           four places that painted TEXT with it now use --cx-fg, since
           --primary on --background is a pair the theme never promised. */
        --cx-accent: var(--primary);
        --cx-accent-fg: var(--primary-foreground);
        --cx-danger: color-mix(
          in oklch,
          var(--destructive, var(--boxel-danger)) 58%,
          var(--foreground, var(--boxel-dark))
        );

        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: var(--cx-bg, var(--boxel-light));
        color: var(--cx-fg, var(--boxel-dark));
        font-family: var(--font-sans, inherit);
        container-type: inline-size;
        container-name: cx-app;

        /* The measure every text-and-figure block is capped to.
           Without it, a `1fr` column on a 2000px display stretches a
           label/value pair ~870px apart and the pair stops reading as a pair.
           Tables are exempt — they legitimately use the full width. */
        --cx-measure: 68rem;
      }

      .cx-mast {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
        border-bottom: 1px solid var(--cx-rule);
      }
      .cx-brand {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .cx-seal {
        width: 32px;
        height: 32px;
        border-radius: 6px;
        display: grid;
        place-items: center;
        flex: none;
        background: color-mix(in oklch, var(--cx-fg) 8%, transparent);
      }
      .cx-seal :deep(svg) {
        width: 18px;
        height: 18px;
      }
      .cx-title {
        margin: 0;
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
        line-height: 1.15;
      }
      .cx-sub {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
      }

      .cx-counters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-lg);
        margin: 0 0 0 auto;
      }
      .cx-ct dt {
        font-size: 9px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-ct dd {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .cx-ct dd :deep(svg) {
        width: 14px;
        height: 14px;
      }
      /* The alarm is never colour alone — the glyph carries it too. */
      .cx-ct.is-alarm dd {
        color: var(--cx-danger);
      }

      .cx-unresolved {
        margin: 0;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-lg);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--cx-danger);
        background: color-mix(in oklch, var(--cx-danger) 8%, transparent);
        border-bottom: 1px solid var(--cx-rule);
      }
      .cx-tabs {
        display: flex;
        gap: 0;
        overflow-x: auto;
        border-bottom: 1px solid var(--cx-rule);
        padding: 0 var(--boxel-sp-lg);
      }
      .cx-tab {
        border: 0;
        background: transparent;
        font: inherit;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        color: var(--cx-muted-fg, var(--boxel-450));
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        /* 44px is the accessibility floor, not a style preference — measured at
           39px before this. */
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        cursor: pointer;
        white-space: nowrap;
        border-bottom: 2px solid transparent;
      }
      .cx-tab[aria-current='page'] {
        color: var(--cx-fg);
        border-bottom-color: currentColor;
      }

      .cx-panel {
        min-height: 0;
        min-width: 0;
        overflow: auto;
        padding: var(--boxel-sp-lg);
      }
      .cx-static {
        display: grid;
        gap: var(--boxel-sp);
        align-content: start;
      }
      .cx-static-note {
        margin: 0;
        max-width: 52ch;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .cx-sec {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .cx-group {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .cx-h {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .cx-count,
      .cx-num {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
      }
      .cx-dash {
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--cx-muted-fg, var(--boxel-450));
      }

      /* ============================================================
         APPROVAL CHAIN RAIL
         Drawn for the APPROVER, not the workflow author. `is-now` is the
         viewer's own step and is the only one that takes the accent.
         ============================================================ */
      /* ============================================================
         SPLIT: saved-view rail + work surface
         ============================================================ */
      /* ============================================================
         COMPLIANCE: KPI row + three charts
         ============================================================ */
      .cx-kpi {
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background: var(--cx-bg, var(--boxel-light));
        min-width: 0;
      }
      .cx-kpi-l {
        margin: 0;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-kpi-v {
        margin: 4px 0 0;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 1.9rem;
        font-weight: 650;
        line-height: 1.1;
        letter-spacing: -0.02em;
      }
      .cx-kpi-v.is-alarm {
        color: var(--boxel-danger);
      }
      .cx-kpi-v.is-none {
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-kpi-u {
        font-size: 0.95rem;
        font-weight: 500;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-kpi-d {
        margin: 3px 0 0;
        font-size: var(--boxel-font-size-xs);
        color: var(--cx-muted-fg, var(--boxel-450));
        line-height: 1.4;
      }

      .cx-charts {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
        gap: 1px;
        background: var(--cx-rule);
        border-block: 1px solid var(--cx-rule);
        margin-bottom: var(--boxel-sp);
      }
      .cx-chart {
        background: var(--cx-bg, var(--boxel-light));
        padding: var(--boxel-sp-xs) var(--boxel-sp) var(--boxel-sp);
        min-width: 0;
      }
      .cx-h-sub {
        margin-left: 6px;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 11px;
        font-weight: 400;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-chart-note {
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.45;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-band-l {
        font-size: var(--boxel-font-size-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cx-swatch {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 2px;
        margin-right: 5px;
        background: var(--cx-band-hue, currentColor);
      }
      .cx-hue-accent {
        --cx-band-hue: var(--cx-accent, var(--boxel-dark));
      }
      .cx-num.is-money {
        white-space: nowrap;
      }

      .cx-tray {
        margin-top: var(--boxel-sp);
        padding-top: var(--boxel-sp);
        border-top: 1px solid var(--cx-rule);
      }
      .cx-tray-who {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xs);
      }
      .cx-acting {
        font: inherit;
        font-size: var(--boxel-font-size-sm);
        min-height: 44px;
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid var(--cx-rule);
        border-radius: var(--radius, 4px);
        background: var(--cx-bg, var(--boxel-light));
        color: inherit;
      }
      .cx-tray-expect {
        font-size: var(--boxel-font-size-xs);
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-tray-l {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
      }

      .cx-tray-note {
        margin: var(--boxel-sp-xs) 0;
        max-width: var(--cx-measure);
      }
      /* Same rule as the rail's assign control: an editable field is taller
         than the text around it, so it reads as editable at rest. */
      .cx-tray-note :deep(textarea) {
        min-height: 5.5rem;
        padding: var(--boxel-sp-xs);
      }
      .cx-acting {
        min-height: 44px;
      }
      .cx-tray-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
      }
      /* Destructive action carries the semantic danger colour and sits apart
         from the primary, per the platform's own guidance. */
      .cx-danger {
        --boxel-button-secondary-foreground: var(--boxel-danger);
        --boxel-button-border-color: var(--boxel-danger);
        margin-left: auto;
      }
      .cx-tray-err {
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-danger);
      }
      .cx-tray-ok {
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-success);
      }
      .cx-tray-scope {
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-xs);
        line-height: 1.5;
        color: var(--cx-muted-fg, var(--boxel-450));
        max-width: var(--cx-measure);
      }
      .cx-diff {
        margin-top: var(--boxel-sp);
      }

      .cx-note {
        margin: 0 0 var(--boxel-sp);
        font-size: var(--boxel-font-size-sm);
        line-height: 1.55;
        color: var(--cx-muted-fg, var(--boxel-450));
        max-width: var(--cx-measure);
      }
      /* A blocked capability is stated in-product, not hidden. Neutral ground,
         not an error colour — nothing has gone wrong, it simply cannot run. */
      .cx-blocked {
        margin: var(--boxel-sp) 0 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background: var(--cx-sunk, color-mix(in oklch, currentColor 4%, transparent));
        color: var(--cx-sunk-fg, var(--boxel-dark));
        border-left: 3px solid var(--cx-muted-fg, var(--boxel-450));
        border-radius: 0 var(--radius, 4px) var(--radius, 4px) 0;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.55;
        max-width: var(--cx-measure);
      }
      .cx-blocked-l {
        display: block;
        margin-bottom: 4px;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-export {
        margin-left: auto;
        min-height: 44px;
        padding: 0 var(--boxel-sp);
        border: 1px solid var(--cx-rule);
        border-radius: var(--radius, 4px);
        background: transparent;
        color: inherit;
        font: inherit;
        font-size: var(--boxel-font-size-sm);
        font-weight: 550;
        cursor: pointer;
      }
      .cx-export:hover { border-color: var(--cx-muted-fg, var(--boxel-450)); }

      /* A submit that fails must say why. Without this the button did nothing
         visible when no rule matched, which reads as a broken control rather
         than as a configuration answer. */
      .cx-submit-msg {
        margin: 0 0 var(--boxel-sp-xs);
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border-radius: var(--radius, 4px);
        font-size: var(--boxel-font-size-sm);
        line-height: 1.5;
        max-width: var(--cx-measure);
      }
      .cx-submit-msg.is-err {
        background: color-mix(in oklch, var(--boxel-danger) 10%, transparent);
        border-left: 3px solid var(--boxel-danger);
      }
      .cx-submit-msg.is-ok {
        background: color-mix(in oklch, var(--boxel-success) 10%, transparent);
        border-left: 3px solid var(--boxel-success);
      }

      .cx-submit {
        font: inherit;
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        min-height: 44px;
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid var(--cx-accent, var(--boxel-dark));
        border-radius: var(--radius, 4px);
        background: transparent;
        color: var(--cx-fg, var(--boxel-dark));
        cursor: pointer;
        white-space: nowrap;
        /* above the full-row click overlay, or the row opens instead */
        position: relative;
        z-index: 1;
      }
      .cx-submit.is-sign {
        border-color: var(--boxel-success);
        color: var(--boxel-success);
      }
      .cx-submit:hover {
        background: color-mix(in oklch, currentColor 8%, transparent);
      }
      .cx-submit[disabled] { opacity: 0.5; cursor: not-allowed; }
      .cx-submit.is-quiet {
        border-color: var(--cx-border, var(--boxel-200));
        color: var(--cx-muted-fg, var(--boxel-450));
      }

      /* ---- Workspace tab (Contract Lifecycle Desk) ---- */
      .cx-ws {
        display: grid;
        gap: var(--boxel-sp);
      }
      .cx-ws-switch {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-wrap: wrap;
        padding-bottom: var(--boxel-sp-xs);
        border-bottom: 1px solid var(--cx-border, var(--boxel-200));
      }
      .cx-ws-switch-label {
        font-size: var(--boxel-font-size-xs);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
        margin-right: var(--boxel-sp-xxs);
      }
      .cx-ws-chip {
        font: inherit;
        font-size: var(--boxel-font-size-sm);
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        max-width: 18rem;
        min-height: 32px;
        padding: 0 0.7rem;
        border: 1px solid var(--cx-border, var(--boxel-200));
        border-radius: 999px;
        background: transparent;
        color: var(--cx-fg, var(--boxel-dark));
        cursor: pointer;
      }
      .cx-ws-chip:hover {
        border-color: var(--cx-fg, var(--boxel-dark));
      }
      .cx-ws-chip.is-active {
        background: var(--cx-fg, var(--boxel-dark));
        border-color: var(--cx-fg, var(--boxel-dark));
        color: var(--cx-bg, var(--boxel-light));
        font-weight: 600;
      }
      .cx-ws-chip-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cx-ws-chip-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex: none;
        background: currentColor;
        opacity: 0.7;
      }
      .cx-ws-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--boxel-sp);
        flex-wrap: wrap;
      }
      .cx-ws-id {
        min-width: 0;
      }
      .cx-ws-actions,
      .cx-ceremony-bar {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex-wrap: wrap;
      }
      .cx-ceremony-bar {
        padding-top: var(--boxel-sp-xs);
        border-top: 1px solid var(--cx-border, var(--boxel-200));
      }
      .cx-provider {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-xs);
        color: var(--cx-muted-fg, var(--boxel-450));
        margin-right: auto;
      }
      .cx-provider input {
        font: inherit;
        min-height: 44px;
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid var(--cx-border, var(--boxel-200));
        border-radius: var(--radius, 4px);
        background: var(--cx-bg, var(--boxel-light));
        color: var(--cx-fg, var(--boxel-dark));
        width: 9rem;
      }
      .cx-findings {
        margin: 0;
        padding-left: 1.2rem;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.5;
        color: var(--cx-fg, var(--boxel-dark));
      }
      .cx-pick {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--boxel-sp-xxs);
      }
      .cx-pick-row {
        font: inherit;
        width: 100%;
        min-height: 44px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid var(--cx-border, var(--boxel-200));
        border-radius: var(--radius, 4px);
        background: transparent;
        color: var(--cx-fg, var(--boxel-dark));
        text-align: left;
        cursor: pointer;
      }
      .cx-pick-row:hover {
        background: color-mix(in oklch, currentColor 6%, transparent);
      }
      .cx-pick-name {
        font-weight: 600;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cx-fig {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-weight: 650;
      }
      /* An identifier or amount never ellipsises — it is read aloud and typed
         into other systems, so a neighbour shrinks instead. */
      .cx-fig.is-money {
        white-space: nowrap;
      }
      .cx-none {
        color: var(--cx-muted-fg, var(--boxel-450));
        font-size: var(--boxel-font-size-sm);
      }
      .cx-scope {
        font-size: var(--boxel-font-size-sm);
      }

      .cx-bulkhead {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        flex-wrap: wrap;
        min-height: 2.5rem;
      }
      .cx-bulk {
        margin-left: auto;
      }

      /* `.cx-split` is now the flex child of `.cx` — the rail hoist moved that
         role off `.cx-panel`, whose `flex: 1` became inert inside this grid and
         let the whole region overflow the app instead of scrolling inside it.
         The grid stretches; each column scrolls on its own. */
      .cx-split {
        display: grid;
        grid-template-columns: 13rem minmax(0, 1fr);
        gap: var(--boxel-sp);
        align-items: stretch;
        flex: 1;
        min-height: 0;
      }
      .cx-split-main {
        min-width: 0;
      }
      .cx-rail {
        /* Horizontal padding was 0, so every item sat flush against the app
           edge and the selected row bled to the border. */
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs);
        border-right: 1px solid var(--cx-rule);
        min-height: 0;
        overflow-y: auto;

        /* Skin FilterList through ITS OWN variables rather than overriding its
           rules — the default selected state is a solid dark fill, which reads
           as a pressed button rather than as "you are looking at this view". */
        --boxel-filter-selected-background: var(
          --cx-sunk,
          color-mix(in oklch, currentColor 8%, transparent)
        );
        --boxel-filter-selected-foreground: var(--cx-fg, var(--boxel-dark));
        --boxel-filter-selected-hover-background: color-mix(
          in oklch,
          currentColor 12%,
          transparent
        );
        --boxel-filter-selected-hover-foreground: var(--cx-fg, var(--boxel-dark));
        --boxel-filter-hover-background: color-mix(
          in oklch,
          currentColor 5%,
          transparent
        );
        --boxel-filter-hover-foreground: var(--cx-fg, var(--boxel-dark));
      }
      /* FilterList's own items measured 30px tall. Raise them through the
         consumer's scoped class rather than forking the component. */
      .cx-rail :deep(.filter-list button) {
        min-height: 44px;
      }
      .cx-split.is-full {
        grid-template-columns: minmax(0, 1fr);
      }
      .cx-rail-note {
        margin: var(--boxel-sp) 0 0;
        padding-left: var(--boxel-sp-xxs);
        font-size: var(--boxel-font-size-xs);
        line-height: 1.45;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
                  .cx-rail-h {
        margin: 0 0 var(--boxel-sp-xs);
        padding-left: var(--boxel-sp-xxs);
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 10px;
        letter-spacing: 0.13em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
      }

      /* ============================================================
         KPI ROLL-UP
         ============================================================ */
      /* Full-bleed to the section edge so the KPI strip's first text lands on
         the same left as every other block. Measured 37.3 vs 21.3 before. */
      .cx-kpis {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
        gap: 1px;
        background: var(--cx-rule);
        border-block: 1px solid var(--cx-rule);
        margin-bottom: var(--boxel-sp);
      }
      .cx-kpis > .cx-kpi:first-child {
        padding-left: 0;
      }
      .cx-charts > .cx-chart:first-child {
        padding-left: 0;
      }
      .cx-kpi {
        background: var(--cx-bg, var(--boxel-light));
        padding: var(--boxel-sp-xs) var(--boxel-sp);
      }
      .cx-kpi.is-alarm {
        --stat-value-color: var(--boxel-danger);
        color: var(--boxel-danger);
      }

      @container cx-app (width < 720px) {
        /* the rail becomes a horizontal scroller rather than eating half a
           narrow panel — the views stay reachable, they stop being a column */
        .cx-split {
          grid-template-columns: 1fr;
        }
        .cx-rail {
          border-right: 0;
          border-bottom: 1px solid var(--cx-rule);
          overflow-x: auto;
        }
        .cx-rail :deep(.filter-list) {
          flex-direction: row;
          flex-wrap: nowrap;
        }
      }

      .cx-tab-n {
        margin-left: 6px;
        padding: 1px 6px;
        border-radius: 9px;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 10px;
        font-weight: 600;
        background: var(--cx-rule);
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-tab[aria-current='page'] .cx-tab-n {
        background: var(--cx-accent, var(--boxel-dark));
        color: var(--cx-accent-fg, var(--boxel-light));
      }
      .cx-tab-n.is-hot {
        background: color-mix(in oklch, var(--boxel-danger) 14%, transparent);
        color: var(--boxel-danger);
      }

      /* ============================================================
         APPROVALS: queue on the left, decision on the right
         The queue used to sit BELOW a pane pinned to approvalRows[0], so the
         other rows could be read and never acted on. Selecting a row now
         drives the pane — the preview-pane pattern every researched CLM
         product uses instead of navigating away.
         ============================================================ */
      .cx-ap-split {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
        gap: var(--boxel-sp-lg);
        align-items: start;
      }
      .cx-ap-list,
      .cx-ap-detail {
        min-width: 0;
      }
      /* The picked row is marked by weight and a ground, not colour alone. */
      .cx-ap-list :deep(tr.is-picked) {
        background: var(--cx-sunk, color-mix(in oklch, currentColor 6%, transparent));
      }
      .cx-ap-list :deep(tr.is-picked td:first-child) {
        box-shadow: inset 3px 0 0 var(--cx-accent, var(--boxel-dark));
      }
      .cx-ap-list :deep(tr.is-picked .t-main),
      .cx-ap-list :deep(tr.is-picked td:nth-child(1)) {
        font-weight: 650;
      }
      .cx-ap-detail {
        position: sticky;
        top: 0;
      }

      @container cx-app (width < 900px) {
        /* One column: the queue first, then the decision for whatever is
           picked. Side-by-side below this width leaves neither readable. */
        .cx-ap-split {
          grid-template-columns: minmax(0, 1fr);
        }
        .cx-ap-detail {
          position: static;
        }
      }

      .cx-ap {
        padding: var(--boxel-sp) 0 var(--boxel-sp-lg);
        border-bottom: 1px solid var(--cx-rule);
        margin-bottom: var(--boxel-sp);
      }
      .cx-ap-head {
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-lg);
        flex-wrap: wrap;
      }
      .cx-ap-id {
        min-width: 0;
      }
      .cx-ap-t {
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 620;
        letter-spacing: -0.01em;
      }
      .cx-ap-m {
        margin: 2px 0 0;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--boxel-font-size-xs);
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-ap-amt {
        margin: 0 0 0 auto;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: 1.4rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        white-space: nowrap;
      }

      .cx-chain {
        list-style: none;
        margin: var(--boxel-sp) 0 0;
        padding: 0;
        display: grid;
        /* one track per step; wraps rather than scrolls so no step is lost
           off-screen on a narrow panel */
        grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
        gap: var(--boxel-sp-xs) var(--boxel-sp);
      }
      .cx-step {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .cx-step-bar {
        height: 4px;
        border-radius: 2px;
        background: var(--cx-rule);
        margin-bottom: 5px;
      }
      .cx-step.is-done .cx-step-bar {
        background: var(--boxel-success);
      }
      .cx-step.is-now .cx-step-bar {
        background: var(--cx-accent, var(--boxel-dark));
      }
      .cx-step-n {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 10px;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
      }
      .cx-step.is-now .cx-step-n {
        color: var(--cx-fg, var(--boxel-dark));
      }
      /* ============================================================
         EDITABLE ZONES
         Every control a person can change gets real height (>=44px) and its
         own ground, so an editable field is distinguishable from a printed
         one before it is clicked — the rail is mostly read-only text, and an
         un-grounded select in the middle of it reads as a label.
         ============================================================ */
      .cx-assign {
        display: flex;
        flex-direction: column;
        gap: 3px;
        margin: 2px 0 4px;
      }
      .cx-assign-l {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 9.5px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--cx-fg, var(--boxel-dark));
      }
      .cx-assign-sel {
        font: inherit;
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        /* the extra height that marks this out as editable */
        min-height: 44px;
        padding: 0 var(--boxel-sp-xs);
        width: 100%;
        max-width: 14rem;
        border: 1px solid var(--cx-accent, var(--boxel-dark));
        border-radius: var(--radius, 4px);
        background: var(--cx-bg, var(--boxel-light));
        color: inherit;
        cursor: pointer;
      }
      .cx-assign-sel:focus-visible {
        outline: 2px solid var(--cx-accent, var(--boxel-dark));
        outline-offset: 1px;
      }
      .cx-assign-sel[disabled] {
        opacity: 0.55;
        cursor: not-allowed;
      }

      .cx-step-who {
        font-size: var(--boxel-font-size-sm);
        font-weight: 560;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cx-step.is-now .cx-step-who {
        color: var(--cx-fg, var(--boxel-dark));
        font-weight: 650;
      }
      .cx-step-w {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 11px;
        color: var(--cx-muted-fg, var(--boxel-450));
      }

      .cx-why {
        margin: var(--boxel-sp) 0 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        background: var(--cx-sunk, color-mix(in oklch, currentColor 4%, transparent));
        color: var(--cx-sunk-fg, var(--boxel-dark));
        border-left: 3px solid var(--cx-muted-fg, var(--boxel-450));
        border-radius: 0 var(--radius, 4px) var(--radius, 4px) 0;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.55;
        max-width: var(--cx-measure);
      }
      .cx-why-l {
        display: block;
        margin-bottom: 4px;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--cx-muted-fg, var(--boxel-450));
      }

      @container cx-app (width < 560px) {
        .cx-ap-amt {
          margin-left: 0;
          font-size: 1.2rem;
        }
        .cx-chain {
          grid-template-columns: 1fr;
        }
      }

      .cx-score {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        max-width: var(--cx-measure);
      }
      .cx-score-head {
        display: flex;
        align-items: baseline;
        gap: var(--boxel-sp-xs);
      }
      /* Skin the component through its own knobs — a scoped class outranks
         .boxel-progress-bar, so the pixels are ours and the semantics are its. */
      .cx-meter :deep(.progress-bar-label) {
        display: none;
      }
      .cx-meter {
        --boxel-progress-bar-height: 10px;
        --boxel-progress-bar-border-radius: 999px;
        --boxel-progress-bar-fill-color: var(--cx-accent, var(--boxel-dark));
        --boxel-progress-bar-background-color: color-mix(
          in oklch,
          currentColor 10%,
          transparent
        );
        max-width: var(--cx-measure);
      }
      .cx-score-n {
        font-size: 2.4rem;
        font-weight: 600;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .cx-score-l {
        color: var(--cx-muted-fg, var(--boxel-450));
        font-size: var(--boxel-font-size-sm);
      }
      .cx-bands {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--boxel-sp-lg);
      }
      /* label | bar | count on ONE track set, so the count never floats away
         from the label it belongs to no matter how wide the viewport gets.
         The previous `margin-left: auto` pushed it to the column edge — at a
         2000px viewport that put ~870px of nothing between "Medium" and "1". */
      .cx-band {
        display: grid;
        /* the figure column is sized to hold a full formatted amount; the BAR
           is the flexible one, because a shorter bar still reads and a
           truncated price does not */
        grid-template-columns: minmax(0, 11rem) minmax(2rem, 1fr) auto;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: 3px 0;
        max-width: var(--cx-measure);
      }
      .cx-bar {
        display: block;
        height: 8px;
        border-radius: 999px;
        background: color-mix(in oklch, currentColor 8%, transparent);
        overflow: hidden;
      }
      .cx-bar-fill {
        display: block;
        height: 100%;
        /* a count of 1 still gets a visible stub rather than nothing */
        width: max(6px, calc(var(--cx-pct, 0) * 1%));
        border-radius: inherit;
        background: var(--cx-band-hue, var(--boxel-400));
      }
      .cx-hue-red { --cx-band-hue: var(--boxel-danger); }
      .cx-hue-orange { --cx-band-hue: #c2620f; }
      .cx-hue-amber { --cx-band-hue: #b8860b; }
      .cx-hue-green { --cx-band-hue: #2e7d32; }
      .cx-hue-blue { --cx-band-hue: #1565c0; }
      .cx-hue-slate { --cx-band-hue: #64748b; }
      .cx-hue-purple { --cx-band-hue: #6d4aa8; }
      .cx-hue-teal { --cx-band-hue: #1f7a70; }
      .cx-band .cx-num {
        text-align: right;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        min-width: 2.5rem;
      }

      .cx-renew {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;
        text-align: left;
        font: inherit;
        cursor: pointer;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        border: 1px solid var(--cx-rule);
        border-radius: 4px;
        background: var(--cx-card, var(--boxel-light));
        color: var(--cx-card-fg, var(--boxel-dark));
        color: inherit;
      }
      .cx-renew-t {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cx-renew-d {
        margin-left: auto;
        font-variant-numeric: tabular-nums;
        color: var(--cx-muted-fg, var(--boxel-450));
      }

      @container cx-app (width < 720px) {
        .cx-bands {
          grid-template-columns: 1fr;
        }
        .cx-counters {
          gap: var(--boxel-sp);
        }
      }
    </style>
  </template>
}

export class ContractExecutionApp extends CardDef {
  static displayName = 'Contract Execution';
  static icon = ScaleIcon;
  static prefersWideFormat = true;

  @field practiceName = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ContractExecutionApp) {
      return this.practiceName?.trim()?.length
        ? this.practiceName
        : 'Contract Execution';
    },
  });

  static isolated = Isolated;

  static embedded = class Embedded extends Component<
    typeof ContractExecutionApp
  > {
    <template>
      <div class='cx-emb'>
        <ScaleIcon role='presentation' />
        <span>{{@model.cardTitle}}</span>
      </div>
      <style scoped>
        .cx-emb {
        /* The host wraps a linked card in a CardContainer that draws a
           boundary and deliberately adds NO padding (base/field-component.gts),
           because padding there would shift the container-query breakpoints the
           inner card reasons about. So the inset has to come from here, or the
           text sits flush against the pill the host draws. */
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
          font-weight: 600;
        }
        .cx-emb :deep(svg) {
          width: 16px;
          height: 16px;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };


  /**
   * Attribute-only. An app card is mounted in workspace grids, and the default
   * fitted would give it no identity at the badge quantum.
   */
  static fitted = class Fitted extends Component<typeof ContractExecutionApp> {
    <template>
      <article class='cx-fit'>
        <header class='cf-head'>
          <ScaleIcon role='presentation' />
          <span class='cf-eyebrow'>Contract lifecycle</span>
        </header>
        <div class='cf-body'>
          <h3 class='cf-anchor'>{{@model.cardTitle}}</h3>
        </div>
        <footer class='cf-meta'>Repository · Approvals · Obligations</footer>
      </article>
      <style scoped>
        .cx-fit {
          --type-ratio: 1.24;
          --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb));
          --type-base: clamp(
            10px,
            min(calc(3px + 2.1cqi + 1cqb - 0.6 * var(--ar)), 10cqb),
            17px
          );
          --meta-size: max(10px, calc(var(--type-base) / var(--type-ratio)));
          --anchor-size: max(
            11px,
            min(calc(var(--type-base) * var(--type-ratio) * var(--type-ratio)), 26cqb)
          );
          --pad: clamp(6px, calc(2px + 1.7cqi), 14px);
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 2px;
          padding: var(--pad);
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
        }
        .cf-head,
        .cf-body,
        .cf-meta { overflow: hidden; min-height: 0; }
        .cf-head { display: flex; align-items: center; gap: 6px; }
        .cf-head > :deep(svg) {
          width: max(11px, min(3cqi, 14cqb));
          height: max(11px, min(3cqi, 14cqb));
          flex: none;
          /* --accent is a SURFACE; its pair is --accent-foreground. Drawn on
               --background it is a combination the theme never checked, so the
               icon takes the muted foreground like every other mark. */
            color: var(--cx-muted-fg, var(--boxel-450));
        }
        .cf-eyebrow {
          font-size: max(9px, calc(var(--meta-size) * 0.85));
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .cf-anchor {
          margin: 0;
          font-size: var(--anchor-size);
          font-weight: 700;
          line-height: 1.18;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .cf-meta {
          font-size: var(--meta-size);
          line-height: 1.3;
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @container fitted-card (height <= 50px) {
          .cx-fit { grid-template-rows: auto; }
          .cf-body, .cf-meta { display: none; }
        }
        @container fitted-card (50px < height <= 80px) {
          .cf-meta { display: none; }
        }
        @container fitted-card (width <= 150px) {
          .cf-eyebrow { display: none; }
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof ContractExecutionApp> {
    <template>
      <span>{{@model.cardTitle}}</span>
    </template>
  };
}

export default ContractExecutionApp;
