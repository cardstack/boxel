import type {
  AgentContext,
  KnowledgeArticle,
  ProjectCard,
  TestResult,
  TicketCard,
} from './factory-agent';

import type { ResolvedSkill } from './factory-agent';

import {
  enforceSkillBudget,
  type SkillLoaderInterface,
  type SkillResolver,
} from './factory-skill-loader';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ContextBuilderConfig {
  skillResolver: SkillResolver;
  skillLoader: SkillLoaderInterface;
  /** Maximum token budget for skills. When set, enforceSkillBudget() trims. */
  maxSkillTokens?: number;
}

// ---------------------------------------------------------------------------
// ContextBuilder
// ---------------------------------------------------------------------------

export class ContextBuilder {
  private skillResolver: SkillResolver;
  private skillLoader: SkillLoaderInterface;
  private maxSkillTokens: number | undefined;

  constructor(config: ContextBuilderConfig) {
    this.skillResolver = config.skillResolver;
    this.skillLoader = config.skillLoader;
    this.maxSkillTokens = config.maxSkillTokens;
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
    ticket: TicketCard;
    knowledge: KnowledgeArticle[];
    targetRealmUrl: string;
    testRealmUrl: string;
    /** Test results from the previous iteration, if any. */
    testResults?: TestResult;
  }): Promise<AgentContext> {
    let { project, ticket, knowledge, targetRealmUrl, testRealmUrl } = params;

    // Step 1: Resolve which skills are needed for this ticket
    let skillNames = this.skillResolver.resolve(ticket, project);

    // Step 2: Load skill content from disk
    let skills: ResolvedSkill[] = await this.skillLoader.loadAll(
      skillNames,
      ticket,
    );

    // Step 3: Enforce token budget if configured
    skills = enforceSkillBudget(skills, this.maxSkillTokens);

    // Step 4: Assemble the context
    let context: AgentContext = {
      project,
      ticket,
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
}
