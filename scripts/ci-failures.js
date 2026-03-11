#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

const { spawnSync } = require('node:child_process');

const FAILISH = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'stale',
]);

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const DEFAULT_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const ENV_MAX_BUFFER_MB = 'CI_FAILURES_MAX_BUFFER_MB';

function resolveMaxBufferBytes() {
  let raw = process.env[ENV_MAX_BUFFER_MB];
  if (!raw) {
    return DEFAULT_MAX_BUFFER_BYTES;
  }

  let mb = Number.parseInt(raw, 10);
  if (!Number.isFinite(mb) || mb <= 0) {
    return DEFAULT_MAX_BUFFER_BYTES;
  }

  return mb * 1024 * 1024;
}

function usage() {
  console.log(
    `Usage: pnpm ci:failures -- [options]\n\nOptions:\n  --run <id|url>      GitHub Actions run id or run URL\n  --pr <number|url>   Pull request number or URL\n  --branch <name>     Branch name (defaults to current git branch)\n  --workflow <name>   Workflow name filter (substring match)\n  --repo <o/r>        Repository in owner/repo form\n  --limit <n>         Runs to scan when resolving by branch/pr (default: 30)\n  --max-lines <n>     Max extracted failure lines to print (default: 30)\n  --context-lines <n> Extra lines of failure context (default: 3)\n  --no-progress       Disable progress messages (enabled by default)\n  --fail-on-findings  Exit with code 1 when failed jobs are found\n  --json              Print JSON output\n  -h, --help          Show this help\n\nExamples:\n  pnpm ci:failures -- --run 22916286599\n  pnpm ci:failures -- --run https://github.com/cardstack/boxel/actions/runs/22916286599\n  pnpm ci:failures -- --pr 4153\n  pnpm ci:failures -- --branch main\n  pnpm ci:failures -- --branch main --workflow "CI Host"\n`,
  );
}

function parseArgs(argv) {
  let args = {
    limit: 30,
    maxLines: 30,
    contextLines: 3,
    progress: true,
    failOnFindings: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    let token = argv[i];

    if (token === '--') {
      continue;
    }

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--no-progress') {
      args.progress = false;
      continue;
    }
    if (token === '--fail-on-findings') {
      args.failOnFindings = true;
      continue;
    }

    let takesValue = [
      '--run',
      '--pr',
      '--branch',
      '--workflow',
      '--repo',
      '--limit',
      '--max-lines',
      '--context-lines',
    ];
    if (takesValue.includes(token)) {
      let value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      i++;
      switch (token) {
        case '--run':
          args.run = value;
          break;
        case '--pr':
          args.pr = value;
          break;
        case '--branch':
          args.branch = value;
          break;
        case '--repo':
          args.repo = value;
          break;
        case '--workflow':
          args.workflow = value;
          break;
        case '--limit':
          args.limit = Number.parseInt(value, 10);
          break;
        case '--max-lines':
          args.maxLines = Number.parseInt(value, 10);
          break;
        case '--context-lines':
          args.contextLines = Number.parseInt(value, 10);
          break;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!Number.isInteger(args.limit) || args.limit <= 0) {
    throw new Error('--limit must be a positive integer');
  }
  if (!Number.isInteger(args.maxLines) || args.maxLines <= 0) {
    throw new Error('--max-lines must be a positive integer');
  }
  if (!Number.isInteger(args.contextLines) || args.contextLines < 0) {
    throw new Error('--context-lines must be a non-negative integer');
  }

  return args;
}

function createProgressReporter(args) {
  let enabled = args.progress && !args.json;
  return (message) => {
    if (!enabled) {
      return;
    }
    let now = new Date().toISOString().slice(11, 19);
    console.error(`[ci-failures ${now}] ${message}`);
  };
}

function runCommand(command, commandArgs, options = {}) {
  let result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    maxBuffer: resolveMaxBufferBytes(),
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !options.allowFailure) {
    let stderr = (result.stderr || '').trim();
    let stdout = (result.stdout || '').trim();
    let output = stderr || stdout || `exit code ${result.status}`;
    throw new Error(`${command} ${commandArgs.join(' ')} failed: ${output}`);
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status ?? 0,
    signal: result.signal ?? null,
  };
}

function gh(args, options) {
  return runCommand('gh', args, options);
}

function ghJson(args) {
  let { stdout } = gh(args);
  try {
    return JSON.parse(stdout);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from gh ${args.join(' ')}: ${err.message}`,
    );
  }
}

function git(args, options) {
  return runCommand('git', args, options);
}

function stripAnsi(text) {
  return text.replaceAll(ANSI_RE, '');
}

function toCleanLine(text) {
  return stripAnsi(text)
    .replace(/^\uFEFF/, '')
    .trim();
}

function isFailish(value) {
  return typeof value === 'string' && FAILISH.has(value);
}

function normalizeRunId(value) {
  if (!value) {
    return null;
  }

  let urlMatch = value.match(/\/actions\/runs\/(\d+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  if (/^\d+$/.test(value)) {
    return value;
  }

  throw new Error(`Could not parse run id from "${value}"`);
}

function resolveRepo(explicitRepo, progress) {
  if (explicitRepo) {
    progress(`Using repo ${explicitRepo}`);
    return explicitRepo;
  }

  progress('Resolving repo from `gh repo view`');
  let viewed = gh(
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    {
      allowFailure: true,
    },
  );
  let resolved = viewed.stdout.trim();
  if (resolved) {
    progress(`Resolved repo ${resolved}`);
    return resolved;
  }

  progress('Falling back to git remote for repo resolution');
  let remote = git(['remote', 'get-url', 'origin'], {
    allowFailure: true,
  }).stdout.trim();
  let sshMatch = remote.match(/^git@github.com:([^/]+)\/([^/.]+)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  let httpsMatch = remote.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  throw new Error('Unable to determine repo. Pass --repo <owner/repo>.');
}

function resolveBranchFromPr(pr, repo) {
  let branch = gh([
    'pr',
    'view',
    String(pr),
    '--repo',
    repo,
    '--json',
    'headRefName',
    '--jq',
    '.headRefName',
  ]).stdout.trim();

  if (!branch) {
    throw new Error(`No head branch found for PR ${pr}`);
  }

  return branch;
}

function resolveCurrentBranch() {
  let branch = git(['branch', '--show-current'], {
    allowFailure: true,
  }).stdout.trim();
  if (branch) {
    return branch;
  }
  throw new Error(
    'Could not determine current git branch. Pass --branch explicitly.',
  );
}

function matchesWorkflow(run, workflowFilter) {
  if (!workflowFilter) {
    return true;
  }
  let workflowName = String(run.workflowName || '');
  return workflowName.toLowerCase().includes(workflowFilter.toLowerCase());
}

function resolveRunTargets(args, repo, progress) {
  if (args.run) {
    progress(`Using explicit run ${args.run}`);
    return {
      runIds: [normalizeRunId(args.run)],
      branch: args.branch || null,
      selection: 'explicit_run',
      runListChoice: null,
    };
  }

  let branch = args.branch;
  if (args.pr) {
    branch = resolveBranchFromPr(args.pr, repo);
  }

  if (!branch) {
    branch = resolveCurrentBranch();
  }

  progress(`Loading workflow runs for branch ${branch} (limit ${args.limit})`);
  let runs = ghJson([
    'run',
    'list',
    '--repo',
    repo,
    '--branch',
    branch,
    '--limit',
    String(args.limit),
    '--json',
    'databaseId,number,status,conclusion,workflowName,displayTitle,url,createdAt,updatedAt,headBranch,event,headSha',
  ]).filter((run) => matchesWorkflow(run, args.workflow));

  if (runs.length === 0) {
    throw new Error('No workflow runs found for the provided filters.');
  }
  progress(
    `Found ${runs.length} run(s)${args.workflow ? ` matching workflow ${args.workflow}` : ''}`,
  );

  let completedRuns = runs.filter((run) => run.status === 'completed');
  if (completedRuns.length === 0) {
    return {
      runIds: [String(runs[0].databaseId)],
      branch,
      selection: 'latest_any',
      runListChoice: [runs[0]],
    };
  }

  let latestCompleted = completedRuns[0];
  let latestHeadSha = latestCompleted.headSha;
  let completedForLatestSha = completedRuns.filter(
    (run) => run.headSha === latestHeadSha,
  );
  let failedForLatestSha = completedForLatestSha.filter((run) =>
    isFailish(run.conclusion),
  );

  if (failedForLatestSha.length > 0) {
    progress(
      `Selected ${failedForLatestSha.length} failed run(s) for latest completed commit ${latestHeadSha}`,
    );
    return {
      runIds: failedForLatestSha.map((run) => String(run.databaseId)),
      branch,
      selection: 'latest_commit_failed_runs',
      runListChoice: failedForLatestSha,
    };
  }

  progress(
    `No failed runs on latest completed commit ${latestHeadSha}; selecting latest completed run`,
  );
  return {
    runIds: [String(latestCompleted.databaseId)],
    branch,
    selection: 'latest_completed',
    runListChoice: [latestCompleted],
  };
}

function summarizeJob(job) {
  let failedSteps = Array.isArray(job.steps)
    ? job.steps
        .filter((step) => isFailish(step.conclusion))
        .map((step) => ({
          number: step.number,
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
        }))
    : [];

  return {
    id: job.databaseId,
    name: job.name,
    status: job.status,
    conclusion: job.conclusion,
    url: job.url,
    failedSteps,
  };
}

function parseLogRecord(line, fallbackJob) {
  let raw = line.replace(/^\uFEFF/, '');
  let parts = raw.split('\t');
  if (parts.length >= 3) {
    let job = parts[0] || fallbackJob;
    let step = parts[1] || 'UNKNOWN STEP';
    let rest = parts.slice(2).join('\t');
    let tsMatch = rest.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/);
    return {
      job,
      step,
      timestamp: tsMatch ? tsMatch[1] : null,
      message: toCleanLine(tsMatch ? tsMatch[2] : rest),
    };
  }

  return {
    job: fallbackJob,
    step: 'UNKNOWN STEP',
    timestamp: null,
    message: toCleanLine(raw),
  };
}

function unwrapStructuredLogMessage(message) {
  if (!message || message[0] !== '{' || !message.includes('"text"')) {
    return message;
  }
  try {
    let parsed = JSON.parse(message);
    if (parsed && typeof parsed.text === 'string') {
      let text = parsed.text.replace(/\s+/g, ' ').trim();
      if (text.length > 260) {
        text = `${text.slice(0, 257)}...`;
      }
      if (parsed.type && typeof parsed.type === 'string') {
        return `${parsed.type}: ${text}`;
      }
      return text;
    }
  } catch (_err) {
    // Keep original message when this is not valid JSON.
  }
  return message;
}

function extractFailureMessage(message) {
  let normalized = unwrapStructuredLogMessage(message);
  if (
    !normalized ||
    normalized.startsWith('##[group]') ||
    normalized.startsWith('##[endgroup]')
  ) {
    return null;
  }

  if (/^at\s+/.test(normalized)) {
    return null;
  }

  let patterns = [
    /^not ok\s+\d+\s+(.*)$/i,
    /^FAIL(?:URE)?\s+(.*)$/i,
    /^[✕×x]\s+(.*)$/i,
    /^Error:\s+(.*)$/,
    /^Assertion(?:Error)?:\s*(.*)$/i,
    /^ELIFECYCLE\s+Command failed(?: with exit code \d+)?\.?$/i,
    /^Testem finished with non-zero exit code\. Tests failed\.?$/i,
    /^Test took longer than \d+ms; test timed out\.?$/i,
    /^Command failed with exit code \d+:\s*(.*)$/i,
    /^Unhandled(?:Promise)?\s*Rejection\s*:?(.*)$/i,
    /^Timed out(?:.*)$/i,
  ];

  for (let pattern of patterns) {
    let match = normalized.match(pattern);
    if (match) {
      let extracted = (match[1] || normalized).trim();
      return extracted || normalized;
    }
  }

  return null;
}

function isPrimaryFailureLine(message) {
  return extractFailureMessage(message) !== null;
}

function normalizeContextMessage(message) {
  let normalized = unwrapStructuredLogMessage(message);
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith('##[group]') ||
    normalized.startsWith('##[endgroup]') ||
    /^\s*shell:\s+/i.test(normalized) ||
    /^\s*env:\s*$/i.test(normalized)
  ) {
    return null;
  }

  if (/^\s*at\s+/.test(normalized)) {
    return normalized;
  }

  if (
    /^(actual|expected|received|diff|operator|stack|stack trace|call log)\b/i.test(
      normalized,
    )
  ) {
    return normalized;
  }

  if (/^\s*[|>]/.test(normalized)) {
    return normalized;
  }

  if (/^error:/i.test(normalized) || /^Error:/.test(normalized)) {
    return normalized;
  }

  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 217)}...`;
}

function collectContext(records, startIndex, maxContextLines) {
  if (maxContextLines <= 0) {
    return [];
  }

  let base = records[startIndex];
  let context = [];

  for (let i = startIndex + 1; i < records.length; i++) {
    let record = records[i];
    if (record.job !== base.job || record.step !== base.step) {
      break;
    }

    if (isPrimaryFailureLine(record.message)) {
      break;
    }

    let normalized = normalizeContextMessage(record.message);
    if (!normalized) {
      continue;
    }

    context.push(normalized);
    if (context.length >= maxContextLines) {
      break;
    }
  }

  return context;
}

function collectFailuresForJob(
  repo,
  runId,
  runSummary,
  jobSummary,
  maxLines,
  contextLines,
) {
  let log = gh(
    [
      'run',
      'view',
      runId,
      '--repo',
      repo,
      '--job',
      String(jobSummary.id),
      '--log-failed',
    ],
    {
      allowFailure: true,
    },
  );

  if (log.status !== 0) {
    return {
      failures: [],
      error: (log.stderr || log.stdout || '').trim() || 'failed to fetch logs',
    };
  }

  let seen = new Set();
  let failures = [];
  let records = log.stdout
    .split(/\r?\n/)
    .filter((line) => Boolean(line.trim()))
    .map((line) => parseLogRecord(line, jobSummary.name));

  for (let index = 0; index < records.length; index++) {
    let record = records[index];
    let extracted = extractFailureMessage(record.message);
    if (!extracted) {
      continue;
    }

    let key = `${record.job}::${record.step}::${extracted}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    failures.push({
      runId: runSummary.id,
      workflowName: runSummary.workflowName,
      runNumber: runSummary.number,
      job: record.job,
      step: record.step,
      timestamp: record.timestamp,
      message: extracted,
      context: collectContext(records, index, contextLines),
    });

    if (failures.length >= maxLines) {
      break;
    }
  }

  return { failures };
}

function textReport(data, maxLines) {
  let lines = [];
  if (data.runs.length === 1) {
    lines.push(
      `Run: ${data.runs[0].workflowName} #${data.runs[0].number} (${data.runs[0].conclusion || data.runs[0].status})`,
    );
    lines.push(`URL: ${data.runs[0].url}`);
  } else {
    lines.push(
      `Runs: ${data.runs.length} selected workflow runs (head sha: ${data.headSha || 'unknown'})`,
    );
  }
  lines.push(`Repo: ${data.repo}`);
  lines.push(`Branch: ${data.selectedBy.branch || 'unknown'}`);
  lines.push('');

  if (data.failedRuns.length === 0) {
    lines.push('No failed jobs in selected run(s).');
    return lines.join('\n');
  }

  lines.push(`Failed workflow runs (${data.failedRuns.length}):`);
  for (let run of data.failedRuns) {
    lines.push(`- ${run.workflowName} #${run.number} (${run.conclusion})`);
    lines.push(`  ${run.url}`);
    for (let job of run.failedJobs) {
      lines.push(`  job: ${job.name} (${job.conclusion || job.status})`);
      if (job.failedSteps.length > 0) {
        for (let step of job.failedSteps) {
          lines.push(`    step ${step.number}: ${step.name}`);
        }
      }
    }
  }

  lines.push('');

  if (data.failures.length === 0) {
    lines.push(
      'No explicit failure lines were extracted from failed-step logs.',
    );
    if (data.logErrors.length > 0) {
      lines.push('');
      lines.push('Log fetch issues:');
      for (let issue of data.logErrors) {
        lines.push(`- ${issue.job}: ${issue.error}`);
      }
    }
    return lines.join('\n');
  }

  lines.push(`Extracted failure lines (showing up to ${maxLines}):`);
  data.failures.slice(0, maxLines).forEach((failure, index) => {
    lines.push(
      `${index + 1}. [${failure.workflowName} #${failure.runNumber} | ${failure.job} > ${failure.step}] ${failure.message}`,
    );
    for (let contextLine of failure.context) {
      lines.push(`   ↳ ${contextLine}`);
    }
  });

  if (data.logErrors.length > 0) {
    lines.push('');
    lines.push('Log fetch issues:');
    for (let issue of data.logErrors) {
      lines.push(
        `- ${issue.workflowName} #${issue.runNumber} :: ${issue.job}: ${issue.error}`,
      );
    }
  }

  return lines.join('\n');
}

function summarizeRun(runData) {
  return {
    id: runData.databaseId,
    number: runData.number,
    workflowName: runData.workflowName,
    displayTitle: runData.displayTitle,
    status: runData.status,
    conclusion: runData.conclusion,
    url: runData.url,
    headBranch: runData.headBranch,
    headSha: runData.headSha,
    event: runData.event,
    createdAt: runData.createdAt,
    updatedAt: runData.updatedAt,
  };
}

function buildOutput(args, repo, resolved, runDataList, progress) {
  let runs = runDataList.map(summarizeRun);
  let failures = [];
  let logErrors = [];
  let failedRuns = [];

  for (let runIndex = 0; runIndex < runDataList.length; runIndex++) {
    let runData = runDataList[runIndex];
    let runSummary = summarizeRun(runData);
    let allJobs = Array.isArray(runData.jobs) ? runData.jobs : [];
    let failedJobs = allJobs
      .filter((job) => isFailish(job.conclusion))
      .map(summarizeJob);

    if (failedJobs.length === 0) {
      continue;
    }

    failedRuns.push({
      ...runSummary,
      failedJobs,
    });

    for (let jobIndex = 0; jobIndex < failedJobs.length; jobIndex++) {
      let job = failedJobs[jobIndex];
      progress(
        `Fetching failed logs for run ${runIndex + 1}/${runDataList.length} (${runSummary.workflowName} #${runSummary.number}), job ${jobIndex + 1}/${failedJobs.length}: ${job.name}`,
      );
      let collected = collectFailuresForJob(
        repo,
        String(runSummary.id),
        runSummary,
        job,
        args.maxLines,
        args.contextLines,
      );
      if (collected.error) {
        logErrors.push({
          workflowName: runSummary.workflowName,
          runNumber: runSummary.number,
          job: job.name,
          error: collected.error,
        });
        continue;
      }
      failures.push(...collected.failures);
    }
  }

  return {
    repo,
    headSha: runs[0]?.headSha || null,
    selection: resolved.selection,
    selectedBy: {
      run: args.run || null,
      pr: args.pr || null,
      branch: resolved.branch || args.branch || null,
      workflow: args.workflow || null,
    },
    selectedRunFromList: resolved.runListChoice || null,
    runs,
    failedRuns,
    failures,
    logErrors,
  };
}

function main() {
  let args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  let progress = createProgressReporter(args);
  progress('Starting triage');

  let repo = resolveRepo(args.repo, progress);
  let resolved = resolveRunTargets(args, repo, progress);
  progress(`Fetching details for ${resolved.runIds.length} selected run(s)`);

  let runDataList = resolved.runIds.map((runId, index) => {
    progress(`Fetching run ${index + 1}/${resolved.runIds.length}: ${runId}`);
    return ghJson([
      'run',
      'view',
      runId,
      '--repo',
      repo,
      '--json',
      'databaseId,number,workflowName,displayTitle,status,conclusion,url,headBranch,headSha,event,createdAt,updatedAt,jobs',
    ]);
  });

  progress('Extracting failed jobs and failure lines');
  let output = buildOutput(args, repo, resolved, runDataList, progress);
  progress(
    `Done: ${output.failedRuns.length} failed run(s), ${output.failures.length} extracted failure line(s)`,
  );

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(textReport(output, args.maxLines));

  if (args.failOnFindings && output.failedRuns.length > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(`ci-failures: ${error.message}`);
  process.exit(2);
}
