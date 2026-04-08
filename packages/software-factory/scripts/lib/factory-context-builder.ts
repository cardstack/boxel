import type {
  AgentContext,
  ClarificationAnswer,
  IssueCard,
  KnowledgeArticle,
  ProjectCard,
  TestResult,
  ValidationResults,
} from './factory-agent';

import type { ResolvedSkill } from './factory-agent';

import {
  enforceSkillBudget,
  type SkillLoaderInterface,
  type SkillResolver,
} from './factory-skill-loader';

// ---------------------------------------------------------------------------
// Issue relationship loader (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Loads related cards from an issue's relationships.
 *
 * The Phase 2 `buildForIssue()` method uses this to traverse the issue's
 * linksTo / linksToMany fields (project, relatedKnowledge, blockedBy)
 * without coupling ContextBuilder to the realm I/O layer.
 */
export interface IssueRelationshipLoader {
  loadProject(issue: IssueCard): Promise<ProjectCard | undefined>;
  loadKnowledge(issue: IssueCard): Promise<KnowledgeArticle[]>;
  loadBlockedBy(issue: IssueCard): Promise<IssueCard[]>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ContextBuilderConfig {
  skillResolver: SkillResolver;
  skillLoader: SkillLoaderInterface;
  /** Maximum token budget for skills. When set, enforceSkillBudget() trims. */
  maxSkillTokens?: number;
  /** Loader for traversing issue relationships (required for buildForIssue). */
  issueLoader?: IssueRelationshipLoader;
}

// ---------------------------------------------------------------------------
// ContextBuilder
// ---------------------------------------------------------------------------

export class ContextBuilder {
  private skillResolver: SkillResolver;
  private skillLoader: SkillLoaderInterface;
  private maxSkillTokens: number | undefined;
  private issueLoader: IssueRelationshipLoader | undefined;

  constructor(config: ContextBuilderConfig) {
    this.skillResolver = config.skillResolver;
    this.skillLoader = config.skillLoader;
    this.maxSkillTokens = config.maxSkillTokens;
    this.issueLoader = config.issueLoader;
  }

  /**
   * Assemble a complete AgentContext for one iteration of the execution loop.
   *
   * Steps:
   * 1. Resolve skill names from ticket + project context
   * 2. Load all resolved skills from disk
   * 3. Apply skill budget if configured
   * 4. Return AgentContext (tools are provided separately as FactoryTool[])
   */
  async build(params: {
    project: ProjectCard;
    issue: IssueCard;
    knowledge: KnowledgeArticle[];
    targetRealmUrl: string;
    testRealmUrl: string;
    /** Test results from the previous iteration, if any. */
    testResults?: TestResult;
  }): Promise<AgentContext> {
    let { project, issue, knowledge, targetRealmUrl, testRealmUrl } = params;

    // Step 1: Resolve which skills are needed for this issue
    let skillNames = this.skillResolver.resolve(issue, project);

    // Step 2: Load skill content from disk
    let skills: ResolvedSkill[] = await this.skillLoader.loadAll(
      skillNames,
      issue,
    );

    // Step 3: Enforce token budget if configured
    skills = enforceSkillBudget(skills, this.maxSkillTokens);

    // Step 4: Assemble the context
    let context: AgentContext = {
      project,
      issue,
      knowledge,
      skills,
      targetRealmUrl,
      testRealmUrl,
    };

    // Include test results when iterating after a failed test run
    if (params.testResults) {
      context.testResults = params.testResults;
    }

    return context;
  }

  /**
   * Build agent context from the current issue (Phase 2 issue-driven loop).
   *
   * Unlike `build()` which takes pre-loaded project/knowledge, this method
   * traverses issue relationships to load them automatically:
   * - project from issue.project
   * - knowledge from issue.relatedKnowledge
   * - resolved clarification answers from issue.blockedBy (done clarifications)
   *
   * Accepts optional validationResults from the prior inner-loop iteration
   * so the agent can self-correct on failures.
   */
  async buildForIssue(params: {
    issue: IssueCard;
    targetRealmUrl: string;
    testRealmUrl: string;
    workspaceDir?: string;
    validationResults?: ValidationResults;
    briefUrl?: string;
  }): Promise<AgentContext> {
    if (!this.issueLoader) {
      throw new Error(
        'buildForIssue() requires an issueLoader in ContextBuilderConfig',
      );
    }

    let { issue, targetRealmUrl, testRealmUrl } = params;

    // Step 1: Traverse issue relationships
    let [project, knowledge, blockedByIssues] = await Promise.all([
      this.issueLoader.loadProject(issue),
      this.issueLoader.loadKnowledge(issue),
      this.issueLoader.loadBlockedBy(issue),
    ]);

    if (!project) {
      throw new Error(
        `Issue "${issue.id}" has no linked project — cannot build context`,
      );
    }

    // Step 2: Extract clarification answers from resolved blockedBy issues
    let clarifications = extractClarifications(blockedByIssues);

    // Step 3: Resolve and load skills
    let skillNames = this.skillResolver.resolve(issue, project);
    let skills: ResolvedSkill[] = await this.skillLoader.loadAll(
      skillNames,
      issue,
    );

    // Step 4: Enforce token budget if configured
    skills = enforceSkillBudget(skills, this.maxSkillTokens);

    // Step 5: Assemble the context
    let context: AgentContext = {
      project,
      issue,
      knowledge,
      skills,
      targetRealmUrl,
      testRealmUrl,
    };

    if (params.validationResults) {
      context.validationResults = params.validationResults;
    }

    if (clarifications.length > 0) {
      context.clarifications = clarifications;
    }

    if (params.briefUrl) {
      context.briefUrl = params.briefUrl;
    }

    if (params.workspaceDir) {
      context.workspaceDir = params.workspaceDir;
    }

    return context;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract clarification answers from resolved blockedBy issues.
 *
 * A clarification issue is one with issueType === 'clarification' and
 * status === 'done'. The question comes from the issue summary, and the
 * answer from the issue description.
 */
function extractClarifications(
  blockedByIssues: IssueCard[],
): ClarificationAnswer[] {
  let clarifications: ClarificationAnswer[] = [];

  for (let blocked of blockedByIssues) {
    if (
      blocked.issueType === 'clarification' &&
      blocked.status === 'done' &&
      typeof blocked.summary === 'string' &&
      typeof blocked.description === 'string'
    ) {
      clarifications.push({
        issueId: blocked.id,
        question: blocked.summary,
        answer: blocked.description,
      });
    }
  }

  return clarifications;
}
