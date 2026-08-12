// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { // ¹ One display-only CardDef; the matrix is curated from grounded Boxel and catalog inventories
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import LayoutGridIcon from '@cardstack/boxel-icons/layout-grid';
import PublicationNav from './components/publication-nav'; // ⁶⁶ Standalone host navigation across the matrix and five proposal pages

type MatrixItem = {
  name: string;
  symbol: string;
  originalConcept?: string; // ⁹ Provenance stays item-level so one cell can carry several independent signals
  domainKit?: string; // ⁴⁸ Restored vertical models carry their domain family as visible matrix provenance
  domainCode?: string; // ⁴⁹ Compact codes keep that annotation legible in dense and printed views
  isBsl: boolean;
  isOverlap: boolean;
  isImplemented: boolean;
  isBslAddition: boolean;
  isFileDefProposal: boolean; // ³¹ Distinguish production-backed handoff proposals from shipped base contracts and BSL additions
};

type MatrixLane = {
  key: string;
  name: string;
  note: string;
  items: MatrixItem[];
};

type MatrixLayer = {
  number: string;
  key: string;
  shortName: string;
  name: string;
  mandate: string;
  steward: string;
  count: number;
  lanes: MatrixLane[];
};

type LaneHeader = {
  key: string;
  symbol: string;
  name: string;
  question: string;
};

function keyFor(name: string): string { // ¹⁰ Stable editorial matching tolerates punctuation and capitalization drift
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ORIGINAL_PERIODIC_NAMES = [ // ¹¹ The complete 115-number source list; repeated labels intentionally collapse for provenance
  'Company', 'Person', 'Contact', 'Lead', 'Deal', 'Account', 'User', 'Team', 'Role', 'Opportunity',
  'Product', 'Service', 'Project', 'Task', 'Subtask', 'Doc', 'File', 'Note', 'Event', 'Meeting',
  'Invoice', 'Payment', 'Subscription', 'Plan', 'Price', 'Campaign', 'Message', 'Email', 'Call', 'Activity',
  'Workflow', 'Template', 'Tag', 'Location', 'Vendor', 'Status', 'Boolean', 'Date', 'DateTime', 'Number',
  'Currency', 'Percent', 'Text', 'URL', 'Email', 'Phone', 'Address', 'JSON', 'Enum', 'ID',
  'Owner', 'Created At', 'Updated At', 'Start Date', 'Due Date', 'Priority', 'Score', 'Count', 'Duration', 'Time',
  'Create', 'Update', 'Assign', 'Delete', 'View', 'Search', 'Filter', 'Sort', 'Group', 'Import',
  'Export', 'Duplicate', 'Notify', 'Remind', 'Message', 'Approve', 'Reject', 'Archive', 'Restore', 'Escalate',
  'Trigger', 'Schedule', 'Run', 'Stop', 'Cancel', 'Grid', 'List', 'Kanban', 'Calendar', 'Gallery',
  'Map', 'Timeline', 'Table', 'Board', 'Chart', 'Detail', 'Card', 'Feed', 'Form', 'Tree',
  'Search', 'Summarize', 'Extract', 'Classify', 'Generate', 'Prompt', 'Recommend', 'Analyze',
  'Permission', 'Policy', 'Trigger', 'Schedule', 'Condition', 'Action', 'Audit',
];

const ORIGINAL_PERIODIC = new Map(
  ORIGINAL_PERIODIC_NAMES.map((name) => [keyFor(name), name]),
);

const ORIGINAL_ALIASES = new Map([ // ¹² Current taxonomy names may be more precise while retaining their source ancestry
  ['document', 'Doc'],
  ['genericfile', 'File'],
  ['phonenumber', 'Phone'],
  ['percentage', 'Percent'],
  ['cardsgrid', 'Grid'],
  ['cardlist', 'List'],
  ['maprenderer', 'Map'],
  ['linechart', 'Chart'],
  ['donutchart', 'Chart'],
  ['recorddetail', 'Detail'],
  ['recordcard', 'Card'],
  ['recordform', 'Form'],
  ['activityfeed', 'Feed'],
  ['workflowboard', 'Board'],
  ['createrecord', 'Create'],
  ['assignowner', 'Assign'],
  ['approverequest', 'Approve'],
  ['rejectrequest', 'Reject'],
  ['notifyparticipant', 'Notify'],
  ['remindparticipant', 'Remind'],
  ['escalatecase', 'Escalate'],
  ['duplicaterecord', 'Duplicate'],
  ['archiverecord', 'Archive'],
  ['restorerecord', 'Restore'],
  ['exportrecord', 'Export'],
  ['importlegacydata', 'Import'],
  ['runworkflow', 'Run'],
  ['generatedocument', 'Generate'],
]);

const BSL_HOST_TOOL_NAMES = [ // ²⁷ Host implementations promoted into the BSL command/tool vocabulary by this audit
  'Add Field to Card Definition', 'Apply Markdown Edit', 'Apply Search/Replace', 'Ask AI', 'Authed Fetch',
  'Check Correctness', 'Copy and Edit', 'Copy Card', 'Copy File to Realm', 'Create Specs',
  'Execute Atomic Operations', 'Fetch Card JSON', 'Full Reindex Realm', 'Generate Example Cards',
  'Get Card Type Schema', 'Instantiate Card', 'Lint and Fix', 'One-shot LLM Request', 'Patch Card Instance',
  'Patch Fields', 'Patch Theme', 'Preview Format', 'Publish Realm', 'Read Binary File', 'Read Text File',
  'Screenshot Card', 'Send Request via Proxy', 'Show Card', 'Switch Submode', 'Unpublish Realm',
  'Validate Realm', 'Write Binary File', 'Write Text File', 'Set Active LLM', 'Summarize Session',
  'Update Room Skills',
];

const BSL_CONCEPT_NAMES = [ // ¹³ Canonical BSL suite plus concepts made concrete by its current design records
  'Actor', 'Attribution', 'BSL Card Info', 'Regime Metadata', 'Directory Metadata', 'Authorship Metadata',
  'Publishing Metadata', 'Trust Metadata', 'Theme', 'Style Reference', 'Brand Guide', 'Flex Field',
  'Formula Field', 'Expression Field', 'Guide', 'Field Guide', 'Guided Form', 'BSL Document',
  'BFM Transclusion', 'Table of Contents', 'Command Definition', 'Job', 'Packet', 'Notification',
  'Reactor', 'Fire Event', 'Command Spec', 'Command Adorn', 'Placement Board', 'Placement Drop Zone',
  'Placement Palette', 'Annotation', 'Thread', 'Workflow', 'Standard Evaluation Report', 'Finding',
  'Evaluation Status', 'Audit Result', 'Auditor Bot', 'Proof Field', 'Package Version', 'Realm Card',
  'Version Alias', 'Catalog Listing', 'BSL Bundle', 'Bundle Manifest', 'Bundle Home', 'BSL Showcase',
  'Before Save', 'When Predicate', 'Trigger', 'Schedule', 'Policy', 'Condition', 'Action', 'Audit',
  'Form', 'Kanban', 'Board', 'Card', 'Owner', 'Created At', 'Updated At', 'Template',
  'Evaluate Expression', 'Evaluate Guide Predicate', 'Resolve Applicable Commands', 'Evaluate Reactor',
  'Commit Placement', 'Extract Headings', 'Transclude Card', 'Install Bundle', 'Remix Bundle',
];

const BSL_CONCEPTS = new Set(
  [...BSL_CONCEPT_NAMES, ...BSL_HOST_TOOL_NAMES].map(keyFor),
);

const BSL_ADDITION_NAMES = [ // ¹⁴ Concepts absent from matrix v1 and added by this BSL reconciliation
  'Actor', 'Attribution', 'BSL Card Info', 'Directory Metadata', 'Authorship Metadata', 'Flex Field',
  'Expression Field', 'Field Guide', 'Guided Form', 'BSL Document', 'BFM Transclusion', 'Table of Contents',
  'Command Definition', 'Reactor', 'Fire Event', 'Command Spec', 'Command Adorn', 'Placement Board',
  'Placement Drop Zone', 'Placement Palette', 'Annotation', 'Thread', 'Standard Evaluation Report', 'Finding',
  'Evaluation Status', 'Audit Result', 'Auditor Bot', 'BSL Bundle', 'Bundle Manifest', 'Bundle Home',
  'BSL Showcase', 'Before Save', 'When Predicate', 'Evaluate Expression', 'Evaluate Guide Predicate',
  'Resolve Applicable Commands', 'Evaluate Reactor', 'Commit Placement', 'Extract Headings', 'Transclude Card',
  'Install Bundle', 'Remix Bundle',
];

const BSL_ADDITIONS = new Set(
  [...BSL_ADDITION_NAMES, ...BSL_HOST_TOOL_NAMES].map(keyFor),
);

const BSL_PERIODIC_OVERLAP_NAMES = [ // ¹⁵ Conservative direct overlaps, not merely concepts BSL could contain
  'Workflow', 'Template', 'Owner', 'Created At', 'Updated At', 'Trigger', 'Schedule', 'Run', 'Form',
  'Kanban', 'Board', 'Card', 'Policy', 'Condition', 'Action', 'Audit',
];

const BSL_PERIODIC_OVERLAPS = new Set(BSL_PERIODIC_OVERLAP_NAMES.map(keyFor));

const FILEDEF_HANDOFF_NAMES = [ // ³² Audited from app.boxel.ai/chris/filedef-developer-handoff: 36 leaves plus shared contracts
  'Markdown File', 'SVG File', 'WebM File', 'PNG File', 'glTF Model File', 'Binary File', 'MP3 File',
  'AVIF File', 'PDF File', 'TrueType Font File', 'QuickTime MOV File', 'GIF File', 'DOCX File', 'HTML File',
  '3MF Manufacturing Model', 'WAV File', 'GLB Model File', 'XLSX File', 'WOFF Font File', 'CSV File',
  'PPTX File', 'TypeScript File', 'Plain Text File', 'Ogg/Opus File', 'STL Mesh File', 'MP4 File',
  'WOFF2 Font File', 'ZIP File', 'WebP File', 'Glimmer TypeScript File', 'JSON File', 'OpenType Font File',
  'M4A File', 'JPEG File', 'MIDI File', 'FLAC File',
  'Quantity', 'Coded Value', 'Camera Capture', 'Geo Location', 'Color Profile', 'EXIF Metadata',
  'Media Encoding', 'Waveform Analysis', 'Media Tags', 'MIDI Metadata', 'Schema Field Summary',
  'Document Info', 'HTML Metadata', 'Archive Entry', 'Font Metadata', '3D Model Info', 'Video Poster Metadata',
  'Thumbnail Metadata', 'STL Mesh Metadata', '3MF Package Metadata', '3MF Print Part',
  'File Resource', 'File Image', 'File Audio', 'File Video', 'File Object', 'Media File Preview',
  'Document File Preview', 'Data File Preview', 'Archive File Preview', 'MIDI File Preview', 'Model File Preview',
  'Font File Preview', 'HTML File Preview', 'Schema File Preview', 'Syntax Highlighted Source', 'File Preview Router',
  'File Atom Card', 'File Fitted Card', 'File Embedded Card', 'File Isolated Card',
  'Extract File Metadata', 'Download File', 'Copy File Link', 'Replace File', 'Capture File Thumbnail',
];

const FILEDEF_HANDOFF_CONCEPTS = new Set(FILEDEF_HANDOFF_NAMES.map(keyFor));

const DOMAIN_KIT_GROUPS = [ // ⁵⁰ Domain kits sit between universal records and fully composed applications
  { name: 'Commerce', code: 'COM', concepts: [
    'Customer', 'Product', 'Service', 'Subscription', 'Plan', 'Price', 'Quote', 'Invoice', 'Invoice Line Item',
    'Payment', 'Order', 'Product Return', 'Product Review', 'Invoice Number', 'Payment Status',
    'Invoice Editor', 'Order Fulfilment Board', 'Process Payment', 'Fulfil Order',
  ] },
  { name: 'Sales & Marketing', code: 'SLS', concepts: [
    'Lead', 'Opportunity', 'Deal', 'Proposal', 'Forecast', 'Territory', 'Campaign', 'Subscriber',
    'Pipeline Stage', 'Sales Pipeline', 'Advance Deal', 'Launch Campaign',
  ] },
  { name: 'Legal', code: 'LEG', concepts: [
    'Contract', 'Clause', 'Confidentiality Clause', 'Termination Clause', 'Payment Clause', 'Legal Entity',
    'Signatory', 'Addendum', 'Amendment', 'Waiver', 'Contract Status', 'Contract Workspace', 'Legal Home',
    'Clause Navigator', 'Request Signature', 'Execute Contract', 'Amend Contract',
  ] },
  { name: 'Support', code: 'SUP', concepts: [
    'Ticket', 'Case', 'Incident', 'SLA', 'Knowledge Article', 'Customer Reply', 'Escalation', 'SLA Window',
    'Support Queue', 'Resolve Case',
  ] },
  { name: 'People & HR', code: 'HR', concepts: [
    'Position', 'Candidate', 'Application', 'Offer', 'Employee', 'Performance Review', 'OKR', 'Compensation',
    'Employment Status', 'Hiring Pipeline', 'Hire Candidate',
  ] },
  { name: 'Forms', code: 'FRM', concepts: [
    'Survey', 'Form Response', 'Questionnaire', 'Survey Builder', 'Publish Survey',
  ] },
  { name: 'Logistics', code: 'LOG', concepts: [
    'Shipment', 'Tracking Number', 'Shipment Tracker', 'Dispatch Shipment',
  ] },
  { name: 'Vendor', code: 'VEN', concepts: [
    'Vendor', 'Vendor Profile', 'Vendor Workspace', 'Onboard Vendor',
  ] },
  { name: 'Real Estate', code: 'RE', concepts: [
    'Property Listing', 'Property Gallery', 'Publish Listing',
  ] },
  { name: 'Events', code: 'EVT', concepts: [
    'Booking', 'RSVP Status', 'Booking Calendar', 'Confirm Booking',
  ] },
  { name: 'Loyalty', code: 'LOY', concepts: [
    'Loyalty Account', 'Member Number', 'Points Balance', 'Loyalty Dashboard', 'Credit Points',
  ] },
];

const DOMAIN_KIT_BY_CONCEPT = new Map( // ⁵¹ One registry drives placement annotations without changing canonical concept names
  DOMAIN_KIT_GROUPS.flatMap((group) =>
    group.concepts.map((name) => [keyFor(name), { name: group.name, code: group.code }] as const),
  ),
);

const DOMAIN_KIT_CODE_BACKED_NAMES = [ // ⁵² Verified working CardDefs in institutional-meerkat/legal and audited kit realms
  'Contract', 'Clause', 'Confidentiality Clause', 'Termination Clause', 'Payment Clause', 'Legal Entity',
  'Signatory', 'Amendment', 'Legal Home', 'Invoice Line Item', 'Product', 'Lead', 'Opportunity',
  'Deal', 'Campaign', 'Ticket', 'Incident', 'Survey', 'Form Response', 'Vendor Profile', 'Property Listing',
  'Booking', 'Candidate', 'Employee', 'Shipment', 'Vendor',
];

const CODE_BACKED_NAMES = [ // ¹⁶ Verified in packages/base, boxel-ui, host tools, catalog patterns, BSL v0, or documented POCs
  'Actor', 'Attribution', 'BSL Card Info', 'Regime Metadata', 'Directory Metadata', 'Authorship Metadata',
  'Trust Metadata', 'Expression Field', 'Flex Field', 'Theme', 'Style Reference', 'Brand Guide', 'Formula Field',
  'Guide', 'Field Guide', 'Guided Form', 'BSL Document', 'BFM Transclusion', 'Table of Contents',
  'Command Definition', 'Job', 'Packet', 'Reactor', 'Fire Event', 'Command Adorn', 'Placement Board',
  'Placement Drop Zone', 'Placement Palette', 'Annotation', 'Thread', 'Finding', 'Evaluate Expression',
  'Evaluate Guide Predicate', 'Commit Placement', 'Extract Headings', 'Transclude Card',
  'Generic File', 'Image File', 'Audio File', 'Markdown File', 'CSV File', 'JSON File', 'Text File', 'GTS File',
  'String', 'Number', 'Boolean', 'Big Integer', 'Text Area', 'Markdown', 'Rich Markdown', 'JSON', 'Email',
  'URL', 'Color', 'Date', 'DateTime', 'Time', 'Enum', 'Card Info', 'Code Ref', 'Realm', 'Phone Number',
  'Day', 'Month', 'Year', 'Week', 'Quarter', 'Month Day', 'Month Year',
  'Address', 'Coordinate', 'Currency', 'Date Range', 'Duration', 'Cards Grid', 'Card List', 'Kanban',
  'Card Container', 'Field Container', 'Grid Container', 'Fitted Card', 'Card Header', 'Tabbed Header',
  'Button', 'Icon Button', 'Input', 'Select', 'Multi Select', 'Radio Input', 'Switch', 'Picker', 'Modal', 'Popover',
  'Card Definition', 'Field Definition', 'File Definition', 'Spec', 'Catalog Listing',
  'Search and Choose', 'Transform Cards', 'Generate Thumbnail',
  'Get Card', 'Save Card', 'Search Cards', 'Patch Code', 'Evaluate Module', 'Reindex Realm', 'Run Command',
  'Add Field to Card Definition', 'Apply Markdown Edit', 'Apply Search/Replace', 'Ask AI', 'Authed Fetch',
  'Check Correctness', 'Copy and Edit', 'Copy Card', 'Copy File to Realm', 'Create Specs',
  'Execute Atomic Operations', 'Fetch Card JSON', 'Full Reindex Realm', 'Generate Example Cards',
  'Get Card Type Schema', 'Instantiate Card', 'Lint and Fix', 'One-shot LLM Request', 'Patch Card Instance',
  'Patch Fields', 'Patch Theme', 'Preview Format', 'Publish Realm', 'Read Binary File', 'Read Text File',
  'Screenshot Card', 'Send Request via Proxy', 'Show Card', 'Switch Submode', 'Unpublish Realm',
  'Validate Realm', 'Write Binary File', 'Write Text File', 'Set Active LLM', 'Summarize Session',
  'Update Room Skills', 'Serialize Card', 'Validate Input', 'Resolve Relationship', 'Load Linked Card',
  'Format Value', 'Parse File', 'Generate JSON Schema', 'Project Search Document',
  'String Editor', 'Number Editor', 'Boolean Radio Editor', 'Date Input', 'DateTime Editor', 'Time Editor',
  'URL Input', 'Email Input', 'Markdown Textarea Editor', 'Enum Select', 'ImageDef Preview', 'File Chooser',
  'JSON String', 'JSON Number', 'JSON Boolean', 'JSON Null', 'JSON Object', 'JSON Array', 'Card Resource',
  'Relationship Links', 'Card URL', 'Realm Identifier', 'Realm Resource Identifier', 'Module Identifier',
  'Resolved Code Ref', 'Adopts From Metadata', // ⁴³ Runtime contracts and their real presentation surfaces are code-backed
];

const CODE_BACKED_CONCEPTS = new Set( // ³³ Handoff entries are running code, while their final home in the platform hierarchy remains proposed
  [...CODE_BACKED_NAMES, ...FILEDEF_HANDOFF_NAMES, ...DOMAIN_KIT_CODE_BACKED_NAMES].map(keyFor), // ⁵³ Domain-kit checks mean a working implementation was inspected, not merely proposed
);

function originalConceptFor(name: string): string | undefined {
  let key = keyFor(name);
  let alias = ORIGINAL_ALIASES.get(key);
  return ORIGINAL_PERIODIC.get(keyFor(alias ?? name));
}

const SYMBOL_OVERRIDES = new Map([ // ⁴⁴ Avoid collisions where editorial initials are not unique
  ['jsonnull', 'J0'],
]);

function symbolFor(name: string): string { // ² Periodic shorthand is editorial, not a second identifier
  let override = SYMBOL_OVERRIDES.get(keyFor(name));
  if (override) {
    return override;
  }
  let words = name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1) {
    return `${words[0][0]}${words[1][0]}`;
  }
  return words[0]?.slice(0, 2) ?? '—';
}

function matrixItems(names: string[]): MatrixItem[] {
  return names.map((name) => { // ¹⁷ Badges are derived from audited registries instead of hand-authored template conditionals
    let originalConcept = originalConceptFor(name);
    let domainKit = DOMAIN_KIT_BY_CONCEPT.get(keyFor(name)); // ⁵⁴ Domain membership remains orthogonal to original, BSL, and implementation provenance
    return {
      name,
      symbol: symbolFor(name),
      originalConcept,
      domainKit: domainKit?.name,
      domainCode: domainKit?.code,
      isBsl: BSL_CONCEPTS.has(keyFor(name)),
      isOverlap: Boolean(
        originalConcept && BSL_PERIODIC_OVERLAPS.has(keyFor(originalConcept)),
      ),
      isImplemented: CODE_BACKED_CONCEPTS.has(keyFor(name)),
      isBslAddition: BSL_ADDITIONS.has(keyFor(name)),
      isFileDefProposal: FILEDEF_HANDOFF_CONCEPTS.has(keyFor(name)),
    };
  });
}

function lane(
  key: string,
  name: string,
  note: string,
  names: string[],
): MatrixLane {
  return { key, name, note, items: matrixItems(names) };
}

function layer(
  number: string,
  key: string,
  shortName: string,
  name: string,
  mandate: string,
  steward: string,
  lanes: MatrixLane[],
): MatrixLayer {
  return {
    number,
    key,
    shortName,
    name,
    mandate,
    steward,
    lanes,
    count: lanes.reduce((total, itemLane) => total + itemLane.items.length, 0),
  };
}

const LANE_HEADERS: LaneHeader[] = [ // ³ Four orthogonal artifact kinds repeat inside every dependency layer
  {
    key: 'cards',
    symbol: 'Cd',
    name: 'Cards & Models',
    question: 'What keeps durable identity?',
  },
  {
    key: 'fields',
    symbol: 'Fd',
    name: 'Fields & Types',
    question: 'What gives values meaning?',
  },
  {
    key: 'components',
    symbol: 'Cp',
    name: 'Components & Views',
    question: 'What arranges the experience?',
  },
  {
    key: 'tools',
    symbol: 'Tl',
    name: 'Tools & Commands',
    question: 'What performs the work?',
  },
];

const INTEGRATED_LAYERS: MatrixLayer[] = [ // ⁴ Specific solutions descend toward stable platform primitives
  layer(
    '06',
    'solutions',
    'Solutions',
    'Composed App Blueprints',
    'Opinionated systems assembled from standardized records, interfaces, fields, and tools.',
    'Catalog apps · organization realms',
    [
      lane('cards', 'Apps & workspaces', 'Installable operating systems with a durable home card', [
        'RFQ-to-Payment App',
        'Contract Execution App',
        'Lead-to-Close CRM',
        'Support Case App',
        'Order Fulfilment App',
        'Vendor Onboarding App',
        'Event Booking App',
        'Hire Pipeline App',
        'BSL Bundle', // ¹⁸ BSL distribution and bundle capstones complete the solution layer
        'Bundle Home',
      ]),
      lane('fields', 'Composition configuration', 'Bindings that configure an app without redefining its lower layers', [
        'App Configuration',
        'Workflow State',
        'Role Mapping',
        'Integration Reference',
        'Automation Policy',
        'Template Binding',
        'Bundle Manifest',
      ]),
      lane('components', 'Application surfaces', 'Large compositions that coordinate multiple record families', [
        'Application Shell',
        'Workspace Home',
        'Dashboard',
        'Workflow Board',
        'Command Center',
        'Setup Wizard',
        'Cross-Record Timeline',
        'BSL Showcase',
      ]),
      lane('tools', 'Workflow orchestration', 'Composite tools that call lower-level tools and realm operations', [
        'Run Workflow',
        'Generate Workspace',
        'Import Legacy Data',
        'Sync External System',
        'Publish Application',
        'AI Copilot',
        'Batch Transform',
        'Install Bundle',
        'Remix Bundle',
      ]),
    ],
  ),
  layer(
    '05.5', // ⁵⁵ Domain kits are deliberately above common records and below composed applications
    'domain-kits',
    'Domain Kits',
    'Reusable Domain Model Kits',
    'Coherent vertical vocabularies assembled from lower-level standards, fields, and platform capabilities.',
    'Catalog domain kits · audited realm implementations',
    [
      lane('cards', 'Domain records', 'COM commerce · SLS sales · LEG legal · SUP support · HR people · FRM forms · LOG logistics · VEN vendor · RE real estate · EVT events · LOY loyalty', [
        'Customer', 'Product', 'Service', 'Subscription', 'Plan', 'Price', 'Quote', 'Invoice', 'Invoice Line Item',
        'Payment', 'Order', 'Product Return', 'Product Review',
        'Lead', 'Opportunity', 'Deal', 'Proposal', 'Forecast', 'Territory', 'Campaign', 'Subscriber',
        'Contract', 'Clause', 'Confidentiality Clause', 'Termination Clause', 'Payment Clause', 'Legal Entity',
        'Signatory', 'Addendum', 'Amendment', 'Waiver',
        'Ticket', 'Case', 'Incident', 'SLA', 'Knowledge Article', 'Customer Reply', 'Escalation',
        'Position', 'Candidate', 'Application', 'Offer', 'Employee', 'Performance Review', 'OKR', 'Compensation',
        'Survey', 'Form Response', 'Questionnaire',
        'Shipment',
        'Vendor', 'Vendor Profile',
        'Property Listing',
        'Booking',
        'Loyalty Account',
      ]),
      lane('fields', 'Domain contracts', 'Portable values shared by cards inside a kit and exchanged between independently built apps', [
        'Invoice Number', 'Payment Status', 'Pipeline Stage', 'Contract Status', 'SLA Window',
        'Employment Status', 'Tracking Number', 'RSVP Status', 'Member Number', 'Points Balance',
      ]),
      lane('components', 'Domain experiences', 'Reusable, opinionated interfaces grounded in the needs of one operational vocabulary', [
        'Invoice Editor', 'Order Fulfilment Board', 'Sales Pipeline', 'Legal Home', 'Contract Workspace', 'Clause Navigator',
        'Support Queue', 'Hiring Pipeline', 'Survey Builder', 'Shipment Tracker', 'Vendor Workspace',
        'Property Gallery', 'Booking Calendar', 'Loyalty Dashboard',
      ]),
      lane('tools', 'Domain transactions', 'Business verbs whose inputs and outputs are the records defined by a kit', [
        'Process Payment', 'Fulfil Order', 'Advance Deal', 'Launch Campaign', 'Request Signature',
        'Execute Contract', 'Amend Contract', 'Resolve Case', 'Hire Candidate', 'Publish Survey',
        'Dispatch Shipment', 'Onboard Vendor', 'Publish Listing', 'Confirm Booking', 'Credit Points',
      ]),
    ],
  ),
  layer(
    '05',
    'records',
    'Records',
    'Common Operational Models',
    'Portable business records that organizations repeatedly buy as SaaS but rarely treat as proprietary advantage.',
    'BSL kits · catalog',
    [
      lane('cards', 'Operational records', 'Durable nouns with identity, relationships, history, and lifecycle', [
        'Company',
        'Person',
        'Contact',
        'Account',
        'Team',
        'Project',
        'Task',
        'Document',
        'Meeting',
        'User', // ⁵⁶ Layer 05 now keeps only records broadly reusable across domains and organizations
        'Role',
        'Subtask',
        'Note',
        'Event',
        'Message',
        'Email',
        'Call',
        'Activity',
        'Workflow',
      ]),
      lane('fields', 'Common record contracts', 'Cross-domain identity, lifecycle, ownership, relationship, and audit conventions', [ // ⁵⁷ Domain-specific exchange values moved into 05.5
        'Record Identifier',
        'Record Status',
        'Record Owner',
        'Lifecycle Dates',
        'External Reference',
        'Relationship Set',
        'Audit Metadata',
      ]),
      lane('components', 'Record experiences', 'Reusable views that make a record family feel like a finished product', [
        'Record Detail',
        'Record Card',
        'Record Form',
        'Activity Feed',
        'Related Records',
        'Audit Timeline',
        'Document Preview',
        'Status Board',
      ]),
      lane('tools', 'Record transactions', 'Business intent expressed against specific operational nouns', [
        'Create Record',
        'Assign Owner',
        'Approve Request',
        'Reject Request',
        'Notify Participant',
        'Remind Participant',
        'Escalate Case',
        'Duplicate Record',
        'Archive Record',
        'Restore Record',
        'Export Record',
        'Generate Document',
      ]),
    ],
  ),
  layer(
    '04',
    'standards',
    'Standards',
    'Domain Exchange Schemas',
    'Shared domain vocabulary lets independently built cards exchange data and behavior without translation projects.',
    'Catalog standards',
    [
      lane('cards', 'Registries & references', 'Identity-bearing authorities shared by multiple domain records', [
        'Currency Registry',
        'Tax Jurisdiction',
        'Country',
        'Territory',
        'SLA Policy',
        'Carrier',
        'Certification Authority',
      ]),
      lane('fields', 'Exchange vocabulary', 'Domain-specific FieldDefs with stable portable serialization', [
        'Money',
        'Tax Breakdown',
        'Payment Terms',
        'Payment Method',
        'Order Status',
        'Invoice Status',
        'Legal Party Role',
        'Signature Block',
        'Clause Reference',
        'Governing Law',
        'Effective Period',
        'Lead Source',
        'Win Probability',
        'Forecast Period',
        'Ticket Status',
        'Severity',
        'Resolution Code',
        'Escalation Level',
        'Shipment Status',
        'Delivery Window',
        'Parcel Dimensions',
        'Choice Option',
        'Validation Rule',
        'Consent Grant',
        'Risk Rating',
        'Property Address',
        'Inspection Finding',
        'Capacity',
        'Compensation',
        'Salary Band',
        'Work Authorization',
        'Channel Consent',
        'Loyalty Tier',
      ]),
      lane('components', 'Standard domain UI', 'Purpose-built editors and renderers for exchange fields', [
        'Money Display',
        'Address Editor',
        'Signature Block View',
        'Payment Terms Editor',
        'Pipeline Stage Picker',
        'Severity Badge',
        'Tracking Status View',
        'Compensation Breakdown',
      ]),
      lane('tools', 'Domain normalization', 'Reusable validation and calculation attached to exchange contracts', [
        'Calculate Tax',
        'Validate Address',
        'Normalize Phone',
        'Resolve Currency',
        'Verify Signature',
        'Compute SLA Deadline',
        'Validate Consent',
        'Score Vendor Risk',
      ]),
    ],
  ),
  layer(
    '03',
    'structures',
    'Structures',
    'Reusable Semantic Building Blocks',
    'Cross-domain cards, fields, components, and tools that save implementation time without imposing a business model.',
    'Base realm · catalog',
    [
      lane('cards', 'Shared semantic cards', 'Identity-bearing references reusable across unrelated domains', [
        'Tag',
        'Location',
        'Theme',
        'Style Reference',
        'Brand Guide',
        'Guide',
        'Template',
        'BSL Document', // ²⁰ BSL semantic records remain reusable without becoming domain business nouns
        'Field Guide',
        'Command Definition',
        'Reactor',
        'Fire Event',
        'Command Spec',
        'Thread',
        'Standard Evaluation Report',
        'Audit Result',
        'Auditor Bot',
        'Placement Board',
      ]),
      lane('fields', 'Compound semantic fields', 'Common meaning plus purpose-built serialization, display, and editing', [
        'Phone Number',
        'Address',
        'Coordinate',
        'Country',
        'Currency',
        'Amount with Currency',
        'Date Range',
        'Time Range',
        'Duration',
        'Percentage',
        'Status',
        'Owner',
        'Created At',
        'Updated At',
        'Start Date',
        'Due Date',
        'Priority',
        'Score',
        'Count',
        'Regime Metadata',
        'Publishing Metadata',
        'Trust Metadata',
        'Authorship Metadata',
        'Formula Field',
        'Proof Field',
        'Actor', // ²¹ BSL spine, regimes, evaluation, and collaboration fields
        'Attribution',
        'BSL Card Info',
        'Directory Metadata', // ⁴¹ Authorship Metadata is declared once above; avoid a duplicate cell in this lane
        'Flex Field',
        'Expression Field',
        'Annotation',
        'Finding',
        'Evaluation Status',
        'Quantity', // ³⁴ FileDef handoff compound metadata remains inspectable through standard FieldDef editors
        'Coded Value',
        'Camera Capture',
        'Geo Location',
        'Color Profile',
        'EXIF Metadata',
        'Media Encoding',
        'Waveform Analysis',
        'Media Tags',
        'MIDI Metadata',
        'Schema Field Summary',
        'Document Info',
        'HTML Metadata',
        'Archive Entry',
        'Font Metadata',
        '3D Model Info',
        'Video Poster Metadata',
        'Thumbnail Metadata',
        'STL Mesh Metadata',
        '3MF Package Metadata',
        '3MF Print Part',
      ]),
      lane('components', 'Catalog components', 'Installable presentation assemblies that do not own durable data', [
        'Cards Grid',
        'Card List',
        'Table',
        'Kanban',
        'Calendar',
        'Gallery',
        'Map Renderer',
        'Timeline',
        'Feed',
        'Line Chart',
        'Donut Chart',
        'Form',
        'Form Wizard',
        'Image Carousel',
        'Audio Mini Player',
        'Waveform Player',
        'Geo Point Map Picker',
        'Question Input',
        'Grid', // ²² Preserve exact source vocabulary alongside more precise catalog implementations
        'List',
        'Map',
        'Board',
        'Chart',
        'Detail',
        'Card',
        'Tree',
        'Guided Form',
        'BFM Transclusion',
        'Table of Contents',
        'Command Adorn',
        'Placement Drop Zone',
        'Placement Palette',
        'File Resource', // ³⁵ Wrapper-free resource primitives, routed previews, and four shared format shells
        'File Image',
        'File Audio',
        'File Video',
        'File Object',
        'Media File Preview',
        'Document File Preview',
        'Data File Preview',
        'Archive File Preview',
        'MIDI File Preview',
        'Model File Preview',
        'Font File Preview',
        'HTML File Preview',
        'Schema File Preview',
        'Syntax Highlighted Source',
        'File Preview Router',
        'File Atom Card',
        'File Fitted Card',
        'File Embedded Card',
        'File Isolated Card',
      ]),
      lane('tools', 'Reusable actions', 'Generic intent that composes platform primitives', [
        'Search and Choose',
        'Notify',
        'Remind',
        'Approve',
        'Reject',
        'Duplicate',
        'Archive',
        'Restore',
        'Transform Cards',
        'Generate Thumbnail',
        'Evaluate Expression', // ²³ BSL evaluation, guide, reflex, placement, and document operations
        'Evaluate Guide Predicate',
        'Resolve Applicable Commands',
        'Evaluate Reactor',
        'Commit Placement',
        'Extract Headings',
        'Transclude Card',
        'Before Save',
        'When Predicate',
        'Create', // ²⁴ Exact original verbs and AI/rule operations remain independently searchable
        'Update',
        'Assign',
        'Delete',
        'View',
        'Search',
        'Filter',
        'Sort',
        'Group',
        'Import',
        'Export',
        'Message',
        'Trigger',
        'Schedule',
        'Run',
        'Stop',
        'Cancel',
        'Summarize',
        'Extract',
        'Classify',
        'Generate',
        'Prompt',
        'Recommend',
        'Analyze',
        'Permission',
        'Policy',
        'Condition',
        'Action',
        'Audit',
        'Extract File Metadata', // ³⁶ User-facing file actions share one extraction and rendition-refresh pipeline
        'Download File',
        'Copy File Link',
        'Replace File',
        'Capture File Thumbnail',
      ]),
    ],
  ),
  layer(
    '02',
    'contracts',
    'Contracts',
    'Universal Value & Render Contracts',
    'Canonical base-realm types and rendering contracts turn runtime storage into author-friendly Boxel fields.',
    'Cardstack runtime · base realm',
    [
      lane('cards', 'File contracts & base assets', 'Shipped FileDefs plus production-backed leaf contracts proposed for upstreaming', [
        'Generic File',
        'Image File',
        'Audio File',
        'Markdown File',
        'CSV File',
        'JSON File',
        'Text File',
        'GTS File',
        'AVIF File', // ³⁷ All 36 handoff leaves are classified here once; shared metadata and UX live in Structures
        'Binary File',
        'DOCX File',
        'FLAC File',
        'GIF File',
        'GLB Model File',
        'glTF Model File',
        'Glimmer TypeScript File',
        'HTML File',
        'JPEG File',
        'M4A File',
        'MIDI File',
        'MP3 File',
        'MP4 File',
        'Ogg/Opus File',
        'OpenType Font File',
        'PDF File',
        'Plain Text File',
        'PNG File',
        'PPTX File',
        'QuickTime MOV File',
        'STL Mesh File',
        'SVG File',
        'TrueType Font File',
        'TypeScript File',
        'WAV File',
        'WebM File',
        'WebP File',
        'WOFF Font File',
        'WOFF2 Font File',
        'XLSX File',
        'ZIP File',
        '3MF Manufacturing Model',
      ]),
      lane('fields', 'Canonical base types', 'Stable FieldDefs available to every realm', [
        'String',
        'Number',
        'Boolean',
        'Big Integer',
        'Text', // ²⁵ Original primitive labels remain visible beside their richer base contracts
        'ID',
        'Text Area',
        'Markdown',
        'Rich Markdown',
        'JSON',
        'Email',
        'URL',
        'Color',
        'Date',
        'DateTime',
        'Time',
        'Day',
        'Month',
        'Year',
        'Week',
        'Quarter',
        'Month Day', // ³⁸ Verified base date contracts; semantic FieldDefs rather than database primitives
        'Month Year',
        'Enum',
        'Card Info',
        'Code Ref',
        'Realm',
      ]),
      lane('components', 'Base field & file presentation', 'FieldDef-owned editors and FileDef display renderers paired with canonical contracts', [ // ⁴⁵ Name the shipped render ownership instead of implying standalone components
        'String Editor',
        'Number Editor',
        'Boolean Radio Editor',
        'Date Input',
        'DateTime Editor',
        'Time Editor',
        'URL Input',
        'Email Input',
        'Markdown Textarea Editor',
        'ImageDef Preview',
        'Enum Select',
      ]),
      lane('tools', 'Contract behavior', 'Operations implied by a FieldDef or CardDef contract', [
        'Serialize Card',
        'Validate Input',
        'Resolve Relationship',
        'Load Linked Card',
        'Format Value',
        'Parse File',
        'Generate JSON Schema',
        'Project Search Document',
      ]),
    ],
  ),
  layer(
    '01',
    'kernel',
    'Kernel',
    'Boxel Platform Primitives',
    'Universal identity, storage, presentation, and execution machinery required before any reusable Boxel can exist.',
    'Cardstack · Boxel host · realm server',
    [
      lane('cards', 'Platform meta-model', 'Definitions and runtime records that make the card system itself', [
        'Realm',
        'Card Definition',
        'Field Definition',
        'File Definition',
        'Spec',
        'Catalog Listing',
        'Realm Card',
        'Package Version',
        'Version Alias',
        'Job',
        'Packet',
        'Notification',
      ]),
      lane('fields', 'Runtime value & identity contracts', 'JSON primitives, recursive containers, JSON:API structures, and canonical addressing contracts', [ // ⁴⁶ These are runtime/wire shapes, not all FieldDefs or indivisible values
        'JSON String',
        'JSON Number',
        'JSON Boolean',
        'JSON Null',
        'JSON Object',
        'JSON Array',
        'Card Resource',
        'Relationship Links',
        'Card URL',
        'Realm Identifier',
        'Realm Resource Identifier',
        'Module Identifier',
        'Resolved Code Ref',
        'Adopts From Metadata',
      ]),
      lane('components', 'Boxel UI kernel', 'Compiled host components available before realm-loaded presentation', [
        'Card Container',
        'Field Container',
        'Grid Container',
        'Fitted Card',
        'Card Header',
        'Tabbed Header',
        'Button',
        'Icon Button',
        'Input',
        'Select',
        'Multi Select',
        'Radio Input',
        'Switch',
        'Picker',
        'File Chooser', // ⁴⁷ The picker/upload surface is host-owned, not FileDef.edit
        'Modal',
        'Popover',
      ]),
      lane('tools', 'Protocol, host & operator', 'Lowest-level operations, typed host tools, and shell adapters', [
        'GET Read Resource',
        'POST Create Resource',
        'PUT Replace Resource',
        'PATCH Update Resource',
        'DELETE Resource',
        'QUERY Search Index',
        'Get Card',
        'Save Card',
        'Search Cards',
        'Patch Code',
        'Write File',
        'Evaluate Module',
        'Reindex Realm',
        'Run Command',
        'Boxel Search CLI',
        'Boxel Realm Sync',
        'Add Field to Card Definition', // ²⁶ Current host-tool registry additions proposed by the BSL command layer
        'Apply Markdown Edit',
        'Apply Search/Replace',
        'Ask AI',
        'Authed Fetch',
        'Check Correctness',
        'Copy and Edit',
        'Copy Card',
        'Copy File to Realm',
        'Create Specs',
        'Execute Atomic Operations',
        'Fetch Card JSON',
        'Full Reindex Realm',
        'Generate Example Cards',
        'Get Card Type Schema',
        'Instantiate Card',
        'Lint and Fix',
        'One-shot LLM Request',
        'Patch Card Instance',
        'Patch Fields',
        'Patch Theme',
        'Preview Format',
        'Publish Realm',
        'Read Binary File',
        'Read Text File',
        'Screenshot Card',
        'Send Request via Proxy',
        'Show Card',
        'Switch Submode',
        'Unpublish Realm',
        'Validate Realm',
        'Write Binary File',
        'Write Text File',
        'Set Active LLM',
        'Summarize Session',
        'Update Room Skills',
      ]),
    ],
  ),
];

export class IntegratedLayerAtlas extends CardDef { // ⁵ A second atlas that integrates artifact kind with dependency depth
  static displayName = 'Integrated Software Layer Matrix';
  static icon = LayoutGridIcon;
  static prefersWideFormat = true;

  @field headline = contains(StringField);
  @field subhead = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: IntegratedLayerAtlas) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.headline ?? `Untitled ${this.constructor.displayName}`);
    },
  });

  @field cardDescription = contains(StringField, {
    computeVia: function (this: IntegratedLayerAtlas) {
      return this.cardInfo?.summary?.trim()?.length
        ? this.cardInfo.summary
        : this.subhead;
    },
  });

  static isolated = class Isolated extends Component<typeof IntegratedLayerAtlas> { // ⁵⁸ Seven dependency rows intersect four reusable artifact kinds after restoring domain kits
    layers = INTEGRATED_LAYERS;
    laneHeaders = LANE_HEADERS;

    get totalItems(): number {
      return this.layers.reduce((total, currentLayer) => total + currentLayer.count, 0);
    }

    get allItems(): MatrixItem[] { // ²⁸ Live audit totals make provenance coverage inspectable in the card itself
      return this.layers.flatMap((currentLayer) =>
        currentLayer.lanes.flatMap((itemLane) => itemLane.items),
      );
    }

    get originalItemCount(): number {
      return this.allItems.filter((item) => item.originalConcept).length;
    }

    get bslItemCount(): number {
      return this.allItems.filter((item) => item.isBsl).length;
    }

    get overlapItemCount(): number {
      return this.allItems.filter((item) => item.isOverlap).length;
    }

    get implementedItemCount(): number {
      return this.allItems.filter((item) => item.isImplemented).length;
    }

    get bslAdditionCount(): number {
      return this.allItems.filter((item) => item.isBslAddition).length;
    }

    get fileDefProposalCount(): number { // ³⁹ Keep the handoff coverage measurable as entries move upstream over time
      return this.allItems.filter((item) => item.isFileDefProposal).length;
    }

    get domainKitItemCount(): number { // ⁵⁹ Keep the restored kit population inspectable as more verticals graduate
      return this.allItems.filter((item) => item.domainCode).length;
    }

    <template>
      <PublicationNav @active='matrix' /> {{! ⁶⁷ Plain host-route navigation keeps this page directly printable }}
      <article class='matrix-atlas'>
        <header class='masthead'>
          <div>
            <p>Software elements · integrated dependency matrix · FileDef audit v3</p>
            <h1>{{@model.headline}}</h1>
            <span>{{@model.subhead}}</span>
          </div>
          <aside>
            <strong>{{this.totalItems}}</strong>
            <span>classified intersections</span>
            <small>7 dependency layers × 4 artifact kinds</small>
          </aside>
        </header>

        <section class='reading-rule' aria-label='How to read this matrix'>
          <div>
            <span>Vertical axis</span>
            <strong>Universal kernel → reusable contracts → domain records → composed apps.</strong>
          </div>
          <div>
            <span>Horizontal axis</span>
            <strong>Identity → value → presentation → execution.</strong>
          </div>
          <div>
            <span>Classification rule</span>
            <strong>Every element gets one primary layer and one artifact kind.</strong>
          </div>
        </section>

        <section class='provenance-legend' aria-label='Source and implementation legend'>
          <div class='legend-intro'>
            <span>Provenance overlay</span>
            <strong>Symbols accumulate. A concept can be original, BSL-aligned, and implemented at once.</strong>
          </div>
          <div class='legend-items'>
            <div>
              <span class='provenance-badge badge-original'>●</span>
              <p><strong>Original table</strong><small>{{this.originalItemCount}} matrix entries</small></p>
            </div>
            <div>
              <span class='provenance-badge badge-bsl'>◆</span>
              <p><strong>Named by BSL</strong><small>{{this.bslItemCount}} entries</small></p>
            </div>
            <div>
              <span class='provenance-badge badge-overlap'>↔</span>
              <p><strong>Original × BSL</strong><small>{{this.overlapItemCount}} direct overlaps</small></p>
            </div>
            <div>
              <span class='provenance-badge badge-implemented'>✓</span>
              <p><strong>Code-backed</strong><small>{{this.implementedItemCount}} verified entries</small></p>
            </div>
            <div>
              <span class='provenance-badge badge-added'>＋</span>
              <p><strong>Added from BSL</strong><small>{{this.bslAdditionCount}} additions</small></p>
            </div>
            <div>
              <span class='provenance-badge badge-filedef'>▣</span>
              <p><strong>FileDef handoff</strong><small>{{this.fileDefProposalCount}} proposals</small></p>
            </div>
            <div>
              <span class='provenance-badge badge-domain-kit'>DK</span>
              <p><strong>Domain kit</strong><small>{{this.domainKitItemCount}} classified entries</small></p>
            </div>
          </div>
        </section>

        <div class='lane-heads' aria-label='Artifact kinds'>
          <div class='axis-cell'>
            <span>Dependency</span>
            <strong>Layer ↓</strong>
          </div>
          {{#each this.laneHeaders as |laneHeader|}}
            <div class='lane-head lane-head-{{laneHeader.key}}'>
              <strong>{{laneHeader.symbol}}</strong>
              <div>
                <h2>{{laneHeader.name}}</h2>
                <p>{{laneHeader.question}}</p>
              </div>
            </div>
          {{/each}}
        </div>

        <main class='layer-matrix' aria-label='Integrated software taxonomy layers'>
          {{#each this.layers as |currentLayer|}}
            <section class='matrix-layer matrix-layer-{{currentLayer.key}}' aria-labelledby='layer-{{currentLayer.key}}'>
              <div class='layer-rail'>
                <span>{{currentLayer.number}}</span>
                <div>
                  <p>{{currentLayer.shortName}}</p>
                  <h2 id='layer-{{currentLayer.key}}'>{{currentLayer.name}}</h2>
                </div>
                <small>{{currentLayer.count}} elements</small>
              </div>
              <div class='layer-context'>
                <p>{{currentLayer.mandate}}</p>
                <small>Steward · {{currentLayer.steward}}</small>
              </div>
              <div class='layer-lanes'>
                {{#each currentLayer.lanes as |itemLane|}}
                  <section class='matrix-lane matrix-lane-{{itemLane.key}}' aria-label={{itemLane.name}}>
                    <div class='matrix-lane-head'>
                      <div>
                        <h3>{{itemLane.name}}</h3>
                        <p>{{itemLane.note}}</p>
                      </div>
                      <span>{{itemLane.items.length}}</span>
                    </div>
                    <div class='matrix-items'>
                      {{#each itemLane.items as |item|}}
                        <div class='matrix-item' data-original-concept={{item.originalConcept}}>
                          <strong>{{item.symbol}}</strong>
                          <div class='item-content'>
                            <span class='item-name'>{{item.name}}</span>
                            <span class='item-badges' aria-label='Concept provenance'>
                              {{#if item.originalConcept}}<abbr class='provenance-badge badge-original' title='Appeared in the original Periodic Table of Software'>●</abbr>{{/if}}
                              {{#if item.isBsl}}<abbr class='provenance-badge badge-bsl' title='Named concept in the BSL taxonomy or command/tool vocabulary'>◆</abbr>{{/if}}
                              {{#if item.isOverlap}}<abbr class='provenance-badge badge-overlap' title='Direct overlap between the original table and BSL'>↔</abbr>{{/if}}
                              {{#if item.isImplemented}}<abbr class='provenance-badge badge-implemented' title='Grounded in an existing Boxel, Boxel UI, host-tool, catalog, or BSL implementation'>✓</abbr>{{/if}}
                              {{#if item.isBslAddition}}<abbr class='provenance-badge badge-added' title='Added to this matrix during the BSL audit'>＋</abbr>{{/if}}
                              {{#if item.isFileDefProposal}}<abbr class='provenance-badge badge-filedef' title='Production-backed proposal in the FileDef developer handoff workspace'>▣</abbr>{{/if}}
                              {{#if item.domainCode}}<abbr class='provenance-badge badge-domain-kit' title={{item.domainKit}}>{{item.domainCode}}</abbr>{{/if}}
                            </span>
                          </div>
                        </div>
                      {{/each}}
                    </div>
                  </section>
                {{/each}}
              </div>
            </section>
          {{/each}}
        </main>

        <footer>
          <span>Cards remember · fields mean · components arrange · tools act.</span>
          <span>Sources · original 115 · BSL primer/v0/POCs · packages/base · boxel-ui · host/app/tools · catalog · FileDef handoff.</span> {{! ⁴⁰ The code-backed mark includes audited POC lineages and the production-backed FileDef proposal }}
        </footer>
      </article>

      <style scoped>
        .matrix-atlas { min-width: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
        .masthead { display: grid; grid-template-columns: minmax(0, 1fr) minmax(14rem, 0.3fr); gap: clamp(2rem, 5vw, 6rem); padding: clamp(2rem, 5vw, 5rem); background: var(--foreground); color: var(--background); }
        .masthead p, .reading-rule span, .axis-cell, .layer-rail p, .layer-rail small, .layer-context small, footer { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.11em; }
        .masthead p { margin: 0 0 1.3rem; color: var(--primary); font-size: 0.66rem; font-weight: 600; }
        .masthead h1 { max-width: 15ch; margin: 0; font-family: var(--font-serif); font-size: clamp(3rem, 7vw, 7.2rem); font-weight: 400; letter-spacing: -0.06em; line-height: 0.9; }
        .masthead > div > span { display: block; max-width: 55rem; margin-top: 1.7rem; color: var(--muted); font-family: var(--font-serif); font-size: clamp(1rem, 1.6vw, 1.3rem); line-height: 1.55; }
        .masthead aside { align-self: end; display: grid; gap: 0.35rem; border-top: 1px solid var(--muted-foreground); padding-top: 1.1rem; }
        .masthead aside strong { color: var(--primary); font-family: var(--font-serif); font-size: clamp(3.5rem, 7vw, 6.5rem); font-weight: 400; line-height: 0.8; }
        .masthead aside span { font-size: 0.9rem; font-weight: 700; }
        .masthead aside small { color: var(--muted); }
        .reading-rule { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--border); background: var(--card); }
        .reading-rule > div { display: grid; gap: 0.45rem; padding: 1.2rem clamp(1rem, 2.5vw, 2rem); }
        .reading-rule > div + div { border-left: 1px solid var(--border); }
        .reading-rule span { color: var(--muted-foreground); font-size: 0.58rem; }
        .reading-rule strong { font-size: 0.8rem; line-height: 1.4; }
        .provenance-legend { display: grid; grid-template-columns: minmax(10rem, 0.45fr) minmax(0, 1.55fr); border-bottom: 1px solid var(--border); background: var(--muted); } /* ²⁹ Compact audit key uses the same functional color language as the matrix */
        .legend-intro { display: grid; align-content: center; gap: 0.4rem; border-right: 1px solid var(--border); padding: 1rem clamp(1rem, 2vw, 1.5rem); }
        .legend-intro span { color: var(--muted-foreground); font: 600 0.55rem var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .legend-intro strong { max-width: 30rem; font-family: var(--font-serif); font-size: 0.75rem; line-height: 1.4; }
        .legend-items { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); } /* ⁶⁰ Domain-kit provenance is a seventh, independent annotation */
        .legend-items > div { min-width: 0; display: flex; gap: 0.55rem; align-items: center; padding: 0.85rem; }
        .legend-items > div + div { border-left: 1px solid var(--border); }
        .legend-items p { min-width: 0; display: grid; gap: 0.1rem; margin: 0; }
        .legend-items strong { font-size: 0.62rem; line-height: 1.2; }
        .legend-items small { color: var(--muted-foreground); font: 500 0.5rem var(--font-mono); }
        .provenance-badge { flex: 0 0 auto; display: inline-grid; place-items: center; width: 1.35rem; height: 1.35rem; border: 1px solid currentColor; border-radius: 50%; background: var(--card); font: 700 0.62rem var(--font-mono); line-height: 1; text-decoration: none; }
        .badge-original { color: var(--family-objects); }
        .badge-bsl { color: var(--primary); }
        .badge-overlap { color: var(--family-interfaces); }
        .badge-implemented { color: var(--family-rules); }
        .badge-added { color: var(--family-intelligence); }
        .badge-filedef { color: var(--family-properties); }
        .badge-domain-kit { color: var(--family-bsl); }
        .lane-heads { display: grid; grid-template-columns: clamp(8rem, 12vw, 11rem) repeat(4, minmax(0, 1fr)); position: sticky; top: 0; z-index: 2; border-bottom: 1px solid var(--border); background: var(--foreground); color: var(--background); }
        .axis-cell { display: grid; align-content: center; gap: 0.25rem; padding: 1rem; color: var(--muted); font-size: 0.58rem; }
        .axis-cell strong { color: var(--background); }
        .lane-head { --lane-accent: var(--family-bsl); min-width: 0; display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); gap: 0.7rem; align-items: center; border-top: 0.35rem solid var(--lane-accent); border-left: 1px solid var(--muted-foreground); padding: 0.8rem; }
        .lane-head-cards, .matrix-lane-cards { --lane-accent: var(--family-objects); }
        .lane-head-fields, .matrix-lane-fields { --lane-accent: var(--family-properties); }
        .lane-head-components, .matrix-lane-components { --lane-accent: var(--family-interfaces); }
        .lane-head-tools, .matrix-lane-tools { --lane-accent: var(--family-actions); }
        .lane-head > strong { color: var(--lane-accent); font-family: var(--font-serif); font-size: 1.3rem; font-weight: 500; }
        .lane-head h2 { margin: 0; font-size: 0.76rem; line-height: 1.1; }
        .lane-head p { margin: 0.2rem 0 0; color: var(--muted); font-family: var(--font-serif); font-size: 0.62rem; line-height: 1.25; }
        .layer-matrix { display: grid; }
        .matrix-layer { --layer-accent: var(--family-bsl); --layer-soft: var(--family-bsl-soft); display: grid; grid-template-columns: clamp(8rem, 12vw, 11rem) minmax(0, 1fr); border-bottom: 1px solid var(--border); background: var(--layer-soft); }
        .matrix-layer-solutions { --layer-accent: var(--family-intelligence); --layer-soft: var(--family-intelligence-soft); }
        .matrix-layer-domain-kits { --layer-accent: var(--family-bsl); --layer-soft: var(--family-bsl-soft); }
        .matrix-layer-records { --layer-accent: var(--family-interfaces); --layer-soft: var(--family-interfaces-soft); }
        .matrix-layer-standards { --layer-accent: var(--family-rules); --layer-soft: var(--family-rules-soft); }
        .matrix-layer-structures { --layer-accent: var(--family-objects); --layer-soft: var(--family-objects-soft); }
        .matrix-layer-contracts { --layer-accent: var(--family-properties); --layer-soft: var(--family-properties-soft); }
        .matrix-layer-kernel { --layer-accent: var(--family-actions); --layer-soft: var(--family-actions-soft); }
        .layer-rail { grid-row: 1 / span 2; display: grid; align-content: start; gap: 1rem; padding: clamp(1rem, 2vw, 1.7rem); background: var(--layer-accent); color: var(--card); }
        .layer-rail > span { font-family: var(--font-serif); font-size: clamp(2.7rem, 4.5vw, 4.7rem); letter-spacing: -0.06em; line-height: 0.8; }
        .layer-rail p { margin: 0 0 0.3rem; font-size: 0.58rem; }
        .layer-rail h2 { margin: 0; font-family: var(--font-serif); font-size: clamp(1.2rem, 1.8vw, 1.8rem); font-weight: 500; line-height: 1; }
        .layer-rail small { margin-top: auto; font-size: 0.52rem; opacity: 0.8; }
        .layer-context { display: flex; justify-content: space-between; gap: 2rem; align-items: baseline; border-bottom: 2px solid var(--layer-accent); padding: 1rem clamp(1rem, 2vw, 1.6rem); }
        .layer-context p { max-width: 62rem; margin: 0; color: var(--muted-foreground); font-family: var(--font-serif); font-size: 0.82rem; line-height: 1.45; }
        .layer-context small { color: var(--layer-accent); font-size: 0.52rem; white-space: nowrap; }
        .layer-lanes { min-width: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .matrix-lane { --lane-accent: var(--family-bsl); min-width: 0; padding: clamp(0.8rem, 1.5vw, 1.2rem); }
        .matrix-lane + .matrix-lane { border-left: 1px solid var(--border); }
        .matrix-lane > .matrix-lane-head { display: flex; justify-content: space-between; gap: 0.6rem; min-height: 4.2rem; border-top: 0.25rem solid var(--lane-accent); padding-top: 0.65rem; }
        .matrix-lane h3 { margin: 0; font-size: 0.72rem; }
        .matrix-lane .matrix-lane-head p { margin: 0.2rem 0 0; color: var(--muted-foreground); font-family: var(--font-serif); font-size: 0.63rem; line-height: 1.25; }
        .matrix-lane .matrix-lane-head > span { color: var(--lane-accent); font: 600 0.6rem var(--font-mono); }
        .matrix-items { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); gap: 0.28rem; }
        .matrix-item { min-width: 0; display: grid; grid-template-columns: 1.75rem minmax(0, 1fr); align-items: center; min-height: 2.35rem; border: 1px solid var(--border); background: var(--card); }
        .matrix-item strong { align-self: stretch; display: grid; place-items: center; border-right: 1px solid var(--border); color: var(--lane-accent); font-family: var(--font-serif); font-size: 0.75rem; font-weight: 500; }
        .item-content { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
        .item-name { min-width: 0; padding: 0.35rem 0.2rem 0.35rem 0.4rem; font-size: 0.58rem; font-weight: 600; line-height: 1.15; overflow-wrap: anywhere; }
        .item-badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.12rem; max-width: 2.9rem; padding: 0.18rem; }
        .matrix-item .provenance-badge { width: 0.9rem; height: 0.9rem; border: 0; background: transparent; font-size: 0.48rem; }
        .matrix-item .badge-domain-kit { width: auto; min-width: 1.15rem; padding-inline: 0.08rem; font-size: 0.4rem; } /* ⁶¹ Three-letter kit codes stay readable without obscuring other provenance */
        footer { display: flex; justify-content: space-between; gap: 2rem; padding: 1.2rem clamp(1rem, 3vw, 2.5rem); background: var(--foreground); color: var(--muted); font-size: 0.58rem; line-height: 1.5; }
        @page { size: A3 landscape; margin: 10mm; } /* ⁶⁴ Print contract favors a legible seven-sheet field guide over shrinking the entire matrix onto one page */
        @media print {
          .matrix-atlas { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 8pt; }
          .masthead { min-height: 88mm; grid-template-columns: minmax(0, 1fr) 46mm; gap: 12mm; padding: 14mm; }
          .masthead p { margin-bottom: 5mm; font-size: 6pt; }
          .masthead h1 { max-width: 18ch; font-size: 38pt; line-height: 0.92; }
          .masthead > div > span { max-width: 75ch; margin-top: 6mm; font-size: 10pt; line-height: 1.45; }
          .masthead aside strong { font-size: 36pt; }
          .reading-rule > div { padding: 4mm 5mm; }
          .reading-rule span { font-size: 5pt; }
          .reading-rule strong { font-size: 6.5pt; }
          .provenance-legend { grid-template-columns: 56mm minmax(0, 1fr); }
          .legend-intro, .legend-items > div { padding: 3mm; }
          .legend-intro strong { font-size: 6pt; }
          .legend-items strong { font-size: 5.2pt; }
          .legend-items small { font-size: 4.5pt; }
          .provenance-badge { width: 5mm; height: 5mm; font-size: 5pt; }
          .lane-heads { position: static; break-after: avoid; }
          .axis-cell, .lane-head { padding: 3mm; }
          .lane-head { grid-template-columns: 8mm minmax(0, 1fr); gap: 2mm; }
          .lane-head > strong { font-size: 11pt; }
          .lane-head h2 { font-size: 6pt; }
          .lane-head p { font-size: 5pt; }
          .matrix-layer { grid-template-columns: 24mm minmax(0, 1fr); break-before: page; break-inside: avoid-page; }
          .layer-rail { gap: 4mm; padding: 5mm 3mm; }
          .layer-rail > span { font-size: 28pt; }
          .layer-rail p, .layer-rail small { font-size: 4.5pt; }
          .layer-rail h2 { font-size: 11pt; }
          .layer-context { gap: 6mm; padding: 3mm 4mm; }
          .layer-context p { font-size: 6pt; line-height: 1.35; }
          .layer-context small { font-size: 4.5pt; }
          .layer-lanes { grid-template-columns: repeat(4, minmax(0, 1fr)); }
          .matrix-lane { padding: 3mm; }
          .matrix-lane > .matrix-lane-head { min-height: 15mm; padding-top: 2mm; }
          .matrix-lane h3 { font-size: 6pt; }
          .matrix-lane .matrix-lane-head p { font-size: 5pt; line-height: 1.2; }
          .matrix-lane .matrix-lane-head > span { font-size: 5pt; }
          .matrix-items { grid-template-columns: repeat(auto-fill, minmax(25mm, 1fr)); gap: 0.8mm; }
          .matrix-item { grid-template-columns: 6mm minmax(0, 1fr); min-height: 6.2mm; break-inside: avoid; }
          .matrix-item strong { font-size: 6pt; }
          .item-name { padding: 1mm; font-size: 5.1pt; line-height: 1.1; }
          .item-badges { gap: 0; max-width: 8mm; padding: 0.4mm; }
          .matrix-item .provenance-badge { width: 2.5mm; height: 2.5mm; font-size: 4pt; }
          .matrix-item .badge-domain-kit { width: auto; min-width: 4.5mm; padding-inline: 0.4mm; font-size: 3.2pt; } /* ⁶⁵ Preserve kit labels in PDF output */
          footer { display: none; }
        }
        @media (max-width: 62rem) {
          .lane-heads { display: none; }
          .provenance-legend { grid-template-columns: 1fr; }
          .legend-intro { border-right: 0; border-bottom: 1px solid var(--border); }
          .matrix-layer { grid-template-columns: 5rem minmax(0, 1fr); }
          .layer-lanes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .matrix-lane:nth-child(3) { border-left: 0; border-top: 1px solid var(--border); }
          .matrix-lane:nth-child(4) { border-top: 1px solid var(--border); }
        }
        @media (max-width: 46rem) {
          .masthead { grid-template-columns: 1fr; }
          .reading-rule { grid-template-columns: 1fr; }
          .reading-rule > div + div { border-left: 0; border-top: 1px solid var(--border); }
          .legend-items { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .legend-items > div { border-bottom: 1px solid var(--border); }
          .legend-items > div + div { border-left: 0; }
          .legend-items > div:nth-child(even) { border-left: 1px solid var(--border); }
          .matrix-layer { grid-template-columns: 1fr; }
          .layer-rail { grid-row: auto; display: flex; align-items: center; }
          .layer-rail small { margin: 0 0 0 auto; }
          .layer-context { flex-direction: column; gap: 0.5rem; }
          .layer-lanes { grid-template-columns: 1fr; }
          .matrix-lane + .matrix-lane { border-left: 0; border-top: 1px solid var(--border); }
          footer { flex-direction: column; }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof IntegratedLayerAtlas> { // ⁷ Compact rows preserve both axes
    layers = INTEGRATED_LAYERS;
    laneHeaders = LANE_HEADERS;

    <template>
      <article class='embedded'>
        <header>
          <span>Integrated dependency matrix</span>
          <strong>{{@model.headline}}</strong>
        </header>
        <div class='embedded-heads'>
          <span>Layer</span>
          {{#each this.laneHeaders as |laneHeader|}}
            <strong class='lane-{{laneHeader.key}}'>{{laneHeader.symbol}} · {{laneHeader.name}}</strong>
          {{/each}}
        </div>
        <div class='embedded-layers'>
          {{#each this.layers as |currentLayer|}}
            <div class='embedded-layer layer-{{currentLayer.key}}'>
              <div class='embedded-layer-name'>
                <span>{{currentLayer.number}}</span>
                <strong>{{currentLayer.shortName}}</strong>
              </div>
              {{#each currentLayer.lanes as |itemLane|}}
                <div class='embedded-count lane-{{itemLane.key}}'>
                  <span>{{itemLane.items.length}}</span>
                  <small>{{itemLane.name}}</small>
                </div>
              {{/each}}
            </div>
          {{/each}}
        </div>
      </article>
      <style scoped>
        .embedded { padding: 1rem; background: var(--card); color: var(--foreground); font-family: var(--font-sans); }
        header { display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; border-bottom: 1px solid var(--border); padding-bottom: 0.7rem; }
        header span { color: var(--muted-foreground); font: 600 0.58rem var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        header strong { font-family: var(--font-serif); font-size: 0.95rem; font-weight: 500; }
        .embedded-heads, .embedded-layer { display: grid; grid-template-columns: minmax(5.5rem, 0.7fr) repeat(4, minmax(0, 1fr)); }
        .embedded-heads { margin-top: 0.7rem; background: var(--foreground); color: var(--background); }
        .embedded-heads > * { min-width: 0; padding: 0.45rem; overflow: hidden; font: 600 0.52rem var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
        .embedded-layer { --layer-accent: var(--family-bsl); border-bottom: 1px solid var(--border); }
        .layer-solutions { --layer-accent: var(--family-intelligence); }
        .layer-domain-kits { --layer-accent: var(--family-bsl); }
        .layer-records { --layer-accent: var(--family-interfaces); }
        .layer-standards { --layer-accent: var(--family-rules); }
        .layer-structures { --layer-accent: var(--family-objects); }
        .layer-contracts { --layer-accent: var(--family-properties); }
        .layer-kernel { --layer-accent: var(--family-actions); }
        .embedded-layer-name { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.4rem; align-items: center; padding: 0.5rem; background: var(--layer-accent); color: var(--card); }
        .embedded-layer-name span { font: 500 0.65rem var(--font-serif); }
        .embedded-layer-name strong { overflow: hidden; font-size: 0.6rem; text-overflow: ellipsis; white-space: nowrap; }
        .lane-cards { --lane-accent: var(--family-objects); }
        .lane-fields { --lane-accent: var(--family-properties); }
        .lane-components { --lane-accent: var(--family-interfaces); }
        .lane-tools { --lane-accent: var(--family-actions); }
        .embedded-count { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.35rem; align-items: center; border-top: 2px solid var(--lane-accent); padding: 0.45rem; background: var(--muted); }
        .embedded-count span { color: var(--lane-accent); font: 600 0.66rem var(--font-mono); }
        .embedded-count small { overflow: hidden; font-size: 0.52rem; text-overflow: ellipsis; white-space: nowrap; }
        @media (max-width: 40rem) { .embedded-heads { display: none; } .embedded-layer { grid-template-columns: 1fr repeat(2, minmax(0, 1fr)); } .embedded-layer-name { grid-row: span 2; } }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof IntegratedLayerAtlas> { // ⁶² CQ heatmap summarizes the 7 × 4 classification at every tile size
    layers = INTEGRATED_LAYERS;
    laneHeaders = LANE_HEADERS;

    get totalItems(): number {
      return this.layers.reduce((total, currentLayer) => total + currentLayer.count, 0);
    }

    <template>
      <article class='fit'>
        <header class='fit-head'>
          <span>Integrated software matrix</span>
          <strong>{{@model.headline}}</strong>
        </header>
        <div class='fit-lane-heads'>
          <span></span>
          {{#each this.laneHeaders as |laneHeader|}}
            <strong class='lane-{{laneHeader.key}}'>{{laneHeader.symbol}}</strong>
          {{/each}}
        </div>
        <div class='fit-grid'>
          {{#each this.layers as |currentLayer|}}
            <div class='fit-layer layer-{{currentLayer.key}}'>
              <strong>{{currentLayer.number}}</strong>
              {{#each currentLayer.lanes as |itemLane|}}
                <span class='fit-cell lane-{{itemLane.key}}'>{{itemLane.items.length}}</span>
              {{/each}}
            </div>
          {{/each}}
        </div>
        <footer class='fit-meta'>
          <span>{{this.totalItems}} elements</span>
          <span>7 layers × 4 kinds</span>
        </footer>
      </article>
      <style scoped>
        .fit { --type-ratio: 1.25; --ar: calc(max(1cqi, 1cqb) - min(1cqi, 1cqb)); --type-base: clamp(10px, calc(3px + 2.2cqi + 1cqb - 0.6 * var(--ar)), 18px); --fit-label: max(7px, calc(var(--type-base) / pow(var(--type-ratio), 1.5))); --fit-meta-size: max(8px, calc(var(--type-base) / var(--type-ratio))); --fit-title: max(11px, calc(var(--type-base) * pow(var(--type-ratio), 1.5))); width: 100%; height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr) auto; gap: clamp(3px, 1.5cqi, 9px); padding: clamp(6px, 4cqi, 18px); overflow: hidden; background: var(--card); color: var(--foreground); font-family: var(--font-sans); }
        .fit-head { min-width: 0; display: grid; gap: 0.15rem; overflow: hidden; }
        .fit-head span { color: var(--muted-foreground); font: 600 var(--fit-label) var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; }
        .fit-head strong { overflow: hidden; font-family: var(--font-serif); font-size: var(--fit-title); font-weight: 500; line-height: 1; text-overflow: ellipsis; white-space: nowrap; }
        .fit-lane-heads, .fit-layer { min-width: 0; display: grid; grid-template-columns: minmax(1.6rem, 0.55fr) repeat(4, minmax(0, 1fr)); gap: 2px; }
        .fit-lane-heads strong { display: grid; place-items: center; border-top: 3px solid var(--lane-accent); color: var(--lane-accent); font: 600 var(--fit-label) var(--font-mono); }
        .fit-grid { min-width: 0; min-height: 0; display: grid; grid-template-rows: repeat(7, minmax(0, 1fr)); gap: 2px; overflow: hidden; } /* ⁶³ The restored domain-kit band receives an equal heatmap row */
        .fit-layer { --layer-accent: var(--family-bsl); min-height: 0; }
        .layer-solutions { --layer-accent: var(--family-intelligence); }
        .layer-domain-kits { --layer-accent: var(--family-bsl); }
        .layer-records { --layer-accent: var(--family-interfaces); }
        .layer-standards { --layer-accent: var(--family-rules); }
        .layer-structures { --layer-accent: var(--family-objects); }
        .layer-contracts { --layer-accent: var(--family-properties); }
        .layer-kernel { --layer-accent: var(--family-actions); }
        .fit-layer > strong { display: grid; place-items: center; overflow: hidden; background: var(--layer-accent); color: var(--card); font: 500 var(--fit-meta-size) var(--font-serif); }
        .lane-cards { --lane-accent: var(--family-objects); }
        .lane-fields { --lane-accent: var(--family-properties); }
        .lane-components { --lane-accent: var(--family-interfaces); }
        .lane-tools { --lane-accent: var(--family-actions); }
        .fit-cell { display: grid; place-items: center; min-height: 0; overflow: hidden; border-top: 3px solid var(--lane-accent); background: var(--muted); color: var(--lane-accent); font: 600 var(--fit-meta-size) var(--font-mono); }
        .fit-meta { display: flex; justify-content: space-between; gap: 0.5rem; overflow: hidden; color: var(--muted-foreground); font: 500 var(--fit-label) var(--font-mono); text-transform: uppercase; }
        @container fitted-card (height <= 80px) { .fit { grid-template-rows: minmax(0, 1fr); } .fit-head, .fit-lane-heads, .fit-meta { display: none; } }
        @container fitted-card (width <= 150px) { .fit-head strong { display: none; } .fit-meta span + span { display: none; } }
      </style>
    </template>
  };
}
