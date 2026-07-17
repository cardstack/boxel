import type {
  AgentContext,
  IssueData,
  KnowledgeArticleData,
  ProjectData,
  TestResult,
  ValidationResults,
} from './factory-agent/index.ts';

import type { ResolvedSkill } from './factory-agent/index.ts';

import {
  enforceSkillBudget,
  type SkillLoaderInterface,
  type SkillResolver,
} from './factory-skill-loader.ts';

// ---------------------------------------------------------------------------
// Issue relationship loader
// ---------------------------------------------------------------------------

/**
 * Loads related cards from an issue's relationships.
 *
 * The `buildForIssue()` method uses this to traverse the issue's
 * linksTo / linksToMany fields (project, relatedKnowledge)
 * without coupling ContextBuilder to the realm I/O layer.
 */
export interface IssueRelationshipLoader {
  loadProject(issue: IssueData): Promise<ProjectData | undefined>;
  loadKnowledge(issue: IssueData): Promise<KnowledgeArticleData[]>;
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
  /**
   * Feature flag — when true, the AgentContext carries
   * `enableBoxelUiDiscovery: true` so the system prompt template enables the
   * catalog-search exception. The resolver should also have been constructed
   * with the same value so the discovery skill is included in the load list.
   * See CS-10527.
   */
  enableBoxelUiDiscovery?: boolean;
  /** V2 lean/design-first mode — carried onto every AgentContext. */
  v2?: boolean;
}

// ---------------------------------------------------------------------------
// ContextBuilder
// ---------------------------------------------------------------------------

export class ContextBuilder {
  private skillResolver: SkillResolver;
  private skillLoader: SkillLoaderInterface;
  private maxSkillTokens: number | undefined;
  private issueLoader: IssueRelationshipLoader | undefined;
  private enableBoxelUiDiscovery: boolean;
  private v2: boolean;

  constructor(config: ContextBuilderConfig) {
    this.skillResolver = config.skillResolver;
    this.skillLoader = config.skillLoader;
    this.maxSkillTokens = config.maxSkillTokens;
    this.issueLoader = config.issueLoader;
    this.enableBoxelUiDiscovery = config.enableBoxelUiDiscovery === true;
    this.v2 = config.v2 === true;
  }

  /**
   * Assemble a complete AgentContext for one iteration of the execution loop.
   *
   * Steps:
   * 1. Resolve skill names from issue + project context
   * 2. Load all resolved skills from disk
   * 3. Apply skill budget if configured
   * 4. Return AgentContext (tools are provided separately as FactoryTool[])
   */
  async build(params: {
    project: ProjectData;
    issue: IssueData;
    knowledge: KnowledgeArticleData[];
    targetRealm: string;
    darkfactoryModuleUrl?: string;
    /** @deprecated Use validationResults/validationContext via buildForIssue() instead. */
    testResults?: TestResult;
  }): Promise<AgentContext> {
    let { project, issue, knowledge, targetRealm, darkfactoryModuleUrl } =
      params;

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
      targetRealm,
      enableBoxelUiDiscovery: this.enableBoxelUiDiscovery,
      v2: this.v2,
      ...(darkfactoryModuleUrl ? { darkfactoryModuleUrl } : {}),
    };

    // @deprecated — Phase 1 test results. Use buildForIssue() with validationContext instead.
    if (params.testResults) {
      context.testResults = params.testResults;
    }

    return context;
  }

  /**
   * Build agent context from the current issue (issue-driven loop).
   *
   * Unlike `build()` which takes pre-loaded project/knowledge, this method
   * traverses issue relationships to load them automatically:
   * - project from issue.project
   * - knowledge from issue.relatedKnowledge
   *
   * Accepts optional validationResults and pre-formatted validationContext
   * from the prior inner-loop iteration so the agent can self-correct on failures.
   */
  async buildForIssue(params: {
    issue: IssueData;
    targetRealm: string;
    darkfactoryModuleUrl?: string;
    validationResults?: ValidationResults;
    /** Pre-formatted validation context string from Validator.formatForContext(). */
    validationContext?: string;
    briefUrl?: string;
  }): Promise<AgentContext> {
    if (!this.issueLoader) {
      throw new Error(
        'buildForIssue() requires an issueLoader in ContextBuilderConfig',
      );
    }

    let { issue, targetRealm, darkfactoryModuleUrl } = params;

    // Step 1: Traverse issue relationships
    let [project, knowledge] = await Promise.all([
      this.issueLoader.loadProject(issue),
      this.issueLoader.loadKnowledge(issue),
    ]);

    if (!project) {
      // Bootstrap issues have no project yet — the agent creates it.
      // Supply a minimal stub so AgentContext.project stays required.
      let issueType = (issue as Record<string, unknown>).issueType;
      if (issueType === 'bootstrap') {
        project = { id: 'bootstrap-pending' };
      } else {
        throw new Error(
          `Issue "${issue.id}" has no linked project — cannot build context`,
        );
      }
    }

    // Step 2: Resolve and load skills
    let skillNames = this.skillResolver.resolve(issue, project);
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
      targetRealm,
      enableBoxelUiDiscovery: this.enableBoxelUiDiscovery,
      v2: this.v2,
      ...(darkfactoryModuleUrl ? { darkfactoryModuleUrl } : {}),
    };

    if (params.validationResults) {
      context.validationResults = params.validationResults;
    }

    if (params.validationContext) {
      context.validationContext = params.validationContext;
    }

    if (params.briefUrl) {
      context.briefUrl = params.briefUrl;
    }

    return context;
  }
}
