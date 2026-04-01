import type {
  AgentAction,
  AgentContext,
  KnowledgeArticle,
  ProjectCard,
  TestResult,
  TicketCard,
  ToolManifest,
  ToolResult,
} from './factory-agent';

import type { ResolvedSkill } from './factory-agent';

import {
  enforceSkillBudget,
  type SkillLoaderInterface,
  type SkillResolver,
} from './factory-skill-loader';

import type { ToolRegistry } from './factory-tool-registry';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ContextBuilderConfig {
  skillResolver: SkillResolver;
  skillLoader: SkillLoaderInterface;
  toolRegistry: ToolRegistry;
  /** Maximum token budget for skills. When set, enforceSkillBudget() trims. */
  maxSkillTokens?: number;
}

// ---------------------------------------------------------------------------
// Iteration state (fed back between loop iterations)
// ---------------------------------------------------------------------------

export interface IterationState {
  testResults?: TestResult;
  toolResults?: ToolResult[];
  previousActions?: AgentAction[];
  iteration?: number;
}

// ---------------------------------------------------------------------------
// ContextBuilder
// ---------------------------------------------------------------------------

export class ContextBuilder {
  private skillResolver: SkillResolver;
  private skillLoader: SkillLoaderInterface;
  private toolRegistry: ToolRegistry;
  private maxSkillTokens: number | undefined;

  constructor(config: ContextBuilderConfig) {
    this.skillResolver = config.skillResolver;
    this.skillLoader = config.skillLoader;
    this.toolRegistry = config.toolRegistry;
    this.maxSkillTokens = config.maxSkillTokens;
  }

  /**
   * Assemble a complete AgentContext for one iteration of the execution loop.
   *
   * Steps:
   * 1. Resolve skill names from ticket + project context
   * 2. Load all resolved skills from disk
   * 3. Apply skill budget if configured
   * 4. Get tool manifests from the registry
   * 5. Merge with iteration state and return AgentContext
   */
  async build(params: {
    project: ProjectCard;
    ticket: TicketCard;
    knowledge: KnowledgeArticle[];
    targetRealmUrl: string;
    testRealmUrl: string;
    iterationState?: IterationState;
  }): Promise<AgentContext> {
    let { project, ticket, knowledge, targetRealmUrl, testRealmUrl } = params;
    let iterationState = params.iterationState ?? {};

    // Step 1: Resolve which skills are needed for this ticket
    let skillNames = this.skillResolver.resolve(ticket, project);

    // Step 2: Load skill content from disk
    let skills: ResolvedSkill[] = await this.skillLoader.loadAll(
      skillNames,
      ticket,
    );

    // Step 3: Enforce token budget if configured
    skills = enforceSkillBudget(skills, this.maxSkillTokens);

    // Step 4: Get tool manifests
    let tools: ToolManifest[] = this.toolRegistry.getManifests();

    // Step 5: Assemble the context
    let context: AgentContext = {
      project,
      ticket,
      knowledge,
      skills,
      tools,
      targetRealmUrl,
      testRealmUrl,
    };

    // Merge iteration state when present
    if (iterationState.testResults) {
      context.testResults = iterationState.testResults;
    }
    if (iterationState.toolResults) {
      context.toolResults = iterationState.toolResults;
    }
    if (iterationState.previousActions) {
      context.previousActions = iterationState.previousActions;
    }
    if (iterationState.iteration !== undefined) {
      context.iteration = iterationState.iteration;
    }

    return context;
  }
}
