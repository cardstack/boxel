import type { FactoryBrief } from './factory-brief';
import { formatErrorResponse, formatUnknownError } from './error-format';

const cardSourceMimeType = 'application/vnd.card+source';

export interface FactoryBootstrapResult {
  project: FactoryBootstrapArtifact;
  knowledgeArticles: FactoryBootstrapArtifact[];
  tickets: FactoryBootstrapArtifact[];
  activeTicket: FactoryBootstrapArtifact;
}

export interface FactoryBootstrapArtifact {
  id: string;
  status: 'created' | 'existing';
}

export interface FactoryBootstrapOptions {
  fetch?: typeof globalThis.fetch;
  darkfactoryModuleUrl?: string;
}

interface CardDocument {
  data: {
    type: 'card';
    attributes: Record<string, unknown>;
    relationships?: Record<string, { links: { self: string | null } }>;
    meta: {
      adoptsFrom: {
        module: string;
        name: string;
      };
    };
  };
}

export async function bootstrapProjectArtifacts(
  brief: FactoryBrief,
  targetRealmUrl: string,
  options?: FactoryBootstrapOptions,
): Promise<FactoryBootstrapResult> {
  let fetchImpl = options?.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available');
  }

  let darkfactoryModuleUrl =
    options?.darkfactoryModuleUrl ?? inferDarkfactoryModuleUrl(targetRealmUrl);
  let slug = deriveSlug(brief.title);
  let projectCode = deriveProjectCode(brief.title);
  let now = new Date().toISOString();
  let sections = extractSections(brief.content);

  let projectPath = `Project/${slug}-mvp`;
  let knowledgePaths = [
    `KnowledgeArticle/${slug}-brief-context`,
    `KnowledgeArticle/${slug}-agent-onboarding`,
  ];
  let ticketPaths = [
    `Ticket/${slug}-define-core`,
    `Ticket/${slug}-design-views`,
    `Ticket/${slug}-add-integration`,
  ];

  let projectDoc = buildProjectDocument(brief, {
    darkfactoryModuleUrl,
    projectCode,
    slug,
    sections,
  });
  let knowledgeDocs = buildKnowledgeDocuments(brief, {
    darkfactoryModuleUrl,
    now,
  });
  let ticketDocs = buildTicketDocuments(brief, {
    darkfactoryModuleUrl,
    projectCode,
    slug,
    sections,
    now,
  });

  let project = await createCardIfMissing(
    targetRealmUrl,
    projectPath,
    projectDoc,
    fetchImpl,
  );
  let knowledgeArticles = await Promise.all(
    knowledgePaths.map((path, i) =>
      createCardIfMissing(targetRealmUrl, path, knowledgeDocs[i], fetchImpl),
    ),
  );
  let tickets = await Promise.all(
    ticketPaths.map((path, i) =>
      createCardIfMissing(targetRealmUrl, path, ticketDocs[i], fetchImpl),
    ),
  );

  let inProgressPath = await hasInProgressTicket(
    targetRealmUrl,
    ticketPaths,
    fetchImpl,
  );

  let activeTicket: FactoryBootstrapArtifact;

  if (inProgressPath) {
    let idx = ticketPaths.indexOf(inProgressPath);
    activeTicket = idx >= 0 ? tickets[idx] : tickets[0];
  } else {
    await patchTicketStatus(
      targetRealmUrl,
      ticketPaths[0],
      'in_progress',
      darkfactoryModuleUrl,
      fetchImpl,
    );
    activeTicket = tickets[0];
  }

  return {
    project,
    knowledgeArticles,
    tickets,
    activeTicket,
  };
}

export function deriveSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveProjectCode(title: string): string {
  let words = title.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return words
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 4);
}

export function inferDarkfactoryModuleUrl(targetRealmUrl: string): string {
  let parsed = new URL(targetRealmUrl);
  return new URL('software-factory/darkfactory', parsed.origin + '/').href;
}

export function extractSections(
  content: string,
): { heading: string; body: string }[] {
  let lines = content.split('\n');
  let sections: { heading: string; body: string }[] = [];
  let currentHeading = '';
  let currentBody: string[] = [];

  for (let line of lines) {
    let headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentHeading || currentBody.length > 0) {
        sections.push({
          heading: currentHeading,
          body: currentBody.join('\n').trim(),
        });
      }
      currentHeading = headingMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentHeading || currentBody.length > 0) {
    sections.push({
      heading: currentHeading,
      body: currentBody.join('\n').trim(),
    });
  }

  return sections;
}

function buildProjectDocument(
  brief: FactoryBrief,
  context: {
    darkfactoryModuleUrl: string;
    projectCode: string;
    slug: string;
    sections: { heading: string; body: string }[];
  },
): CardDocument {
  let scope = context.sections
    .filter((s) => s.heading)
    .map((s) => `## ${s.heading}\n\n${s.body}`)
    .join('\n\n');
  if (!scope) {
    scope = brief.content || brief.contentSummary;
  }

  let successCriteria = buildSuccessCriteria(context.sections);

  return {
    data: {
      type: 'card',
      attributes: {
        projectCode: context.projectCode,
        projectName: `${brief.title} MVP`,
        projectStatus: 'active',
        objective: brief.contentSummary,
        scope,
        technicalContext: `Generated by factory:go from brief at ${brief.sourceUrl}`,
        successCriteria,
      },
      relationships: {
        'knowledgeBase.0': {
          links: {
            self: `../KnowledgeArticle/${context.slug}-brief-context`,
          },
        },
        'knowledgeBase.1': {
          links: {
            self: `../KnowledgeArticle/${context.slug}-agent-onboarding`,
          },
        },
      },
      meta: {
        adoptsFrom: {
          module: context.darkfactoryModuleUrl,
          name: 'Project',
        },
      },
    },
  };
}

function buildKnowledgeDocuments(
  brief: FactoryBrief,
  context: {
    darkfactoryModuleUrl: string;
    now: string;
  },
): CardDocument[] {
  let briefContextTags = [...brief.tags, 'brief-context'].filter(Boolean);

  return [
    {
      data: {
        type: 'card',
        attributes: {
          articleTitle: `${brief.title} — Brief Context`,
          articleType: 'context',
          content: brief.content || brief.contentSummary,
          tags: briefContextTags,
          updatedAt: context.now,
        },
        meta: {
          adoptsFrom: {
            module: context.darkfactoryModuleUrl,
            name: 'KnowledgeArticle',
          },
        },
      },
    },
    {
      data: {
        type: 'card',
        attributes: {
          articleTitle: `${brief.title} — Agent Onboarding`,
          articleType: 'onboarding',
          content: buildOnboardingContent(brief),
          tags: ['onboarding', ...brief.tags].filter(Boolean),
          updatedAt: context.now,
        },
        meta: {
          adoptsFrom: {
            module: context.darkfactoryModuleUrl,
            name: 'KnowledgeArticle',
          },
        },
      },
    },
  ];
}

function buildTicketDocuments(
  brief: FactoryBrief,
  context: {
    darkfactoryModuleUrl: string;
    projectCode: string;
    slug: string;
    sections: { heading: string; body: string }[];
    now: string;
  },
): CardDocument[] {
  let ticketTemplates = deriveTicketContent(brief, context.sections);

  return ticketTemplates.map((template, i) => ({
    data: {
      type: 'card' as const,
      attributes: {
        ticketId: `${context.projectCode}-${i + 1}`,
        summary: template.summary,
        description: template.description,
        ticketType: 'feature',
        status: i === 0 ? 'in_progress' : 'backlog',
        priority: i === 0 ? 'high' : 'medium',
        acceptanceCriteria: template.acceptanceCriteria,
        createdAt: context.now,
        updatedAt: context.now,
      },
      relationships: {
        project: {
          links: { self: `../Project/${context.slug}-mvp` },
        },
      },
      meta: {
        adoptsFrom: {
          module: context.darkfactoryModuleUrl,
          name: 'Ticket',
        },
      },
    },
  }));
}

interface TicketTemplate {
  summary: string;
  description: string;
  acceptanceCriteria: string;
}

function deriveTicketContent(
  brief: FactoryBrief,
  sections: { heading: string; body: string }[],
): TicketTemplate[] {
  let namedSections = sections.filter((s) => s.heading);

  let coreMechanicsSection = namedSections.find((s) =>
    /core|mechanic|structure|fundamentals/i.test(s.heading),
  );
  let viewsSection = namedSections.find((s) =>
    /view|design|ui|layout|display|render/i.test(s.heading),
  );
  let integrationSection = namedSections.find((s) =>
    /integrat|link|connect|automat|workflow/i.test(s.heading),
  );

  let coreDescription = coreMechanicsSection
    ? `${coreMechanicsSection.body}\n\nDerived from the "${coreMechanicsSection.heading}" section of the brief.`
    : `Create the card definition with required fields and basic structure.\n\n${brief.contentSummary}`;

  let viewsDescription = viewsSection
    ? `${viewsSection.body}\n\nDerived from the "${viewsSection.heading}" section of the brief.`
    : `Design and implement the card views (fitted, isolated, embedded) for display in different contexts.\n\n${brief.contentSummary}`;

  let integrationDescription = integrationSection
    ? `${integrationSection.body}\n\nDerived from the "${integrationSection.heading}" section of the brief.`
    : `Add linking, automation, and workflow integration points.\n\n${brief.contentSummary}`;

  let coreCriteria = extractChecklistItems(coreMechanicsSection?.body);
  let viewsCriteria = extractChecklistItems(viewsSection?.body);
  let integrationCriteria = extractChecklistItems(integrationSection?.body);

  return [
    {
      summary: `Define the core ${brief.title} card`,
      description: coreDescription,
      acceptanceCriteria:
        coreCriteria ||
        `- [ ] Card definition exists\n- [ ] Core fields are defined\n- [ ] Card renders in isolated view`,
    },
    {
      summary: `Design ${brief.title} card views`,
      description: viewsDescription,
      acceptanceCriteria:
        viewsCriteria ||
        `- [ ] Fitted view renders correctly\n- [ ] Isolated view renders correctly\n- [ ] Embedded view renders correctly`,
    },
    {
      summary: `Add ${brief.title} integration points`,
      description: integrationDescription,
      acceptanceCriteria:
        integrationCriteria ||
        `- [ ] Linked cards resolve correctly\n- [ ] Automation hooks are functional\n- [ ] Workflow integration works end-to-end`,
    },
  ];
}

function extractChecklistItems(body: string | undefined): string {
  if (!body) {
    return '';
  }

  let bullets = body.match(/^\s*[-*+]\s+\*?\*?(.+)/gm);
  if (!bullets || bullets.length === 0) {
    return '';
  }

  return bullets
    .slice(0, 6)
    .map((b) => {
      let text = b
        .replace(/^\s*[-*+]\s+/, '')
        .replace(/\*\*/g, '')
        .trim();
      return `- [ ] ${text}`;
    })
    .join('\n');
}

function buildSuccessCriteria(
  sections: { heading: string; body: string }[],
): string {
  let headings = sections.filter((s) => s.heading).map((s) => s.heading);

  if (headings.length === 0) {
    return '- [ ] Core card definition renders\n- [ ] Card views display correctly\n- [ ] Integration points are functional';
  }

  return headings
    .slice(0, 5)
    .map((h) => `- [ ] ${h} implementation complete`)
    .join('\n');
}

function buildOnboardingContent(brief: FactoryBrief): string {
  let lines = [
    `# ${brief.title} — Agent Onboarding`,
    '',
    `This project implements **${brief.title}**: ${brief.contentSummary}`,
    '',
    '## How to Work on This Project',
    '',
    '- Use the Project card for scope and success criteria',
    '- Use Ticket cards for execution — pick the active ticket and implement it',
    '- Update agent notes on each ticket as you make progress',
    '- Create or update Knowledge Articles when meaningful decisions occur',
  ];

  if (brief.tags.length > 0) {
    lines.push('', `## Tags`, '', `${brief.tags.join(', ')}`);
  }

  lines.push('', '## Source Brief', '', `Original brief: ${brief.sourceUrl}`);

  return lines.join('\n');
}

async function createCardIfMissing(
  realmUrl: string,
  cardPath: string,
  document: CardDocument,
  fetchImpl: typeof globalThis.fetch,
): Promise<FactoryBootstrapArtifact> {
  let cardUrl = new URL(cardPath, realmUrl).href;
  let writeUrl = new URL(`${cardPath}.json`, realmUrl).href;

  let existsResponse = await fetchImpl(cardUrl, {
    method: 'GET',
    headers: { Accept: cardSourceMimeType },
  });

  if (existsResponse.ok) {
    return { id: cardPath, status: 'existing' };
  }

  let writeResponse = await fetchImpl(writeUrl, {
    method: 'POST',
    headers: {
      Accept: cardSourceMimeType,
      'Content-Type': cardSourceMimeType,
    },
    body: JSON.stringify(document, null, 2),
  });

  if (!writeResponse.ok) {
    let text = await formatErrorResponse(writeResponse);
    throw new Error(
      `Failed to create card ${cardPath} in ${realmUrl}: HTTP ${writeResponse.status} ${text}`.trim(),
    );
  }

  await waitForCardToBeReadable(realmUrl, cardPath, fetchImpl);

  return { id: cardPath, status: 'created' };
}

async function hasInProgressTicket(
  realmUrl: string,
  ticketPaths: string[],
  fetchImpl: typeof globalThis.fetch,
): Promise<string | null> {
  for (let path of ticketPaths) {
    let url = new URL(path, realmUrl).href;
    let response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: cardSourceMimeType },
    });

    if (!response.ok) {
      continue;
    }

    let json = (await response.json()) as {
      data?: { attributes?: { status?: string } };
    };
    if (json.data?.attributes?.status === 'in_progress') {
      return path;
    }
  }
  return null;
}

async function patchTicketStatus(
  realmUrl: string,
  ticketPath: string,
  status: string,
  darkfactoryModuleUrl: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  let url = new URL(ticketPath, realmUrl).href;
  let writeUrl = new URL(`${ticketPath}.json`, realmUrl).href;

  let getResponse = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: cardSourceMimeType },
  });

  if (!getResponse.ok) {
    return;
  }

  let existing = (await getResponse.json()) as CardDocument;
  existing.data.attributes.status = status;
  existing.data.meta = {
    adoptsFrom: { module: darkfactoryModuleUrl, name: 'Ticket' },
  };

  let patchResponse = await fetchImpl(writeUrl, {
    method: 'POST',
    headers: {
      Accept: cardSourceMimeType,
      'Content-Type': cardSourceMimeType,
    },
    body: JSON.stringify(existing, null, 2),
  });

  if (!patchResponse.ok) {
    let text = await formatErrorResponse(patchResponse);
    throw new Error(
      `Failed to patch ticket status for ${ticketPath}: HTTP ${patchResponse.status} ${text}`.trim(),
    );
  }

  await waitForCardToBeReadable(realmUrl, ticketPath, fetchImpl);
}

async function waitForCardToBeReadable(
  realmUrl: string,
  cardPath: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  let cardUrl = new URL(cardPath, realmUrl).href;
  let timeoutMs = 15_000;
  let retryDelayMs = 250;
  let startedAt = Date.now();
  let lastError: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await fetchImpl(cardUrl, {
        method: 'GET',
        headers: { Accept: cardSourceMimeType },
      });

      if (response.ok) {
        return;
      }

      lastError = `HTTP ${response.status} ${await formatErrorResponse(
        response,
      )}`.trim();
    } catch (error) {
      lastError = formatUnknownError(error);
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  throw new Error(
    `Timed out waiting for card ${cardPath} in ${realmUrl} to become readable${
      lastError ? `: ${lastError}` : ''
    }`,
  );
}
