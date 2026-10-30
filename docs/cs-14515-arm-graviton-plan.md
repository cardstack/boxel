# CS-14515: Run the Fargate services on ARM (Graviton) — plan

## Goal

All boxel ECS services in staging and production run with
`cpuArchitecture = ARM64`. Daily Fargate cost falls by about 20%
(about $575/mo across both accounts).

## Rule for every step: staging first

No step changes what production builds or runs until the same change has run
in staging without problems. Shared code (cardstack/gh-actions, the infra ECS
module) changes only behind a default that keeps the current behavior.

## Facts this plan depends on

- Each environment has its own ECR repositories
  (`boxel-<service>-${{ inputs.environment }}`), and `manual-deploy.yml`
  builds the images on every deploy. So the image platforms can differ per
  environment.
- `cardstack/gh-actions/.github/workflows/docker-ecr.yml` already has a
  `platforms` input. It runs on `ubuntu-latest` (x86), so an arm64 build there
  uses QEMU and is slow.
- Callers of `docker-ecr.yml` in boxel: `manual-deploy.yml` (ai-bot,
  bot-runner, realm-server, prerender-manager, prerender, worker,
  pg-migration), `manual-deploy-bot-runner.yml`,
  `manual-deploy-actions-collector.yml`.
- Deploys copy the live task definition and swap only the image. So an image
  must be multi-arch before its task definition switches to ARM64.

## Steps

### (a) CS-14517: multi-arch images, staging only

1. **cardstack/gh-actions:** make arm64 builds fast without QEMU. Build each
   platform on a native runner (RunsOn arm64 for arm64) and join the results
   with `docker buildx imagetools create`. A caller that passes no `platforms`
   gets the current behavior. This PR merges before the boxel PR.
2. **boxel:** pass `platforms` on each `docker-ecr.yml` call, by environment:

   ```yaml
   platforms: ${{ inputs.environment == 'staging' && 'linux/amd64,linux/arm64' || 'linux/amd64' }}
   ```

   Production builds stay amd64 only. The prerender image stays amd64 only in
   both environments (Google's apt repository is `[arch=amd64]`; see (c)).

3. Check that each Dockerfile builds on arm64: native npm dependencies and apt
   packages.
4. Deploy to staging. Check with `docker buildx imagetools inspect` that each
   staging image (except prerender) lists linux/amd64 and linux/arm64. Check
   that staging still runs normally (x86 tasks use the amd64 variant) and the
   build time per deploy rises by no more than a few minutes.

### (b) CS-14518: ARM64 task definitions, staging

1. **cardstack/infra:** add a CPU-architecture variable to
   `modules/aws/ecs/service`, default `X86_64`, and set `runtime_platform` on
   `aws_ecs_task_definition.this`. A plan on at least two configs must show no
   task-definition change.
2. Switch the staging services one per infra PR, lowest risk first: small
   services (cardie, cavy, grafana, loki, actions-collector,
   claude-fs-readonly), then bot-runner, ai-bot, pg-migration,
   prerender-manager, worker, realm-server, synapse.
3. Before each switch: check the image in the config's
   `container_definitions_json` (no stale image), and check that every
   container in the task has an arm64 image, sidecars included.
4. After each switch: the service is stable, with normal errors and latency,
   for a day before the next one.

### (c) CS-14519: prerender-server on arm64, staging

1. Choose the arm64 browser (Google Chrome for Linux arm64 if it exists now,
   else Debian `chromium`), select it by `TARGETARCH`, and pin its version
   against the lockfile's Puppeteer.
2. Build the prerender image multi-arch for staging only.
3. Compare amd64 and arm64 in staging: HTML output, screenshots (fonts), render
   time and memory per page.
4. Switch the staging prerender-server task definition to ARM64.

### Production, after staging has run on ARM for a week

1. **boxel:** build production images multi-arch too (drop the environment
   condition in `platforms`). Deploy to production and check the images.
2. **cardstack/infra:** switch the production services in the same order as
   staging, one per PR, a day apart. prerender-server last.

## Handoff and rollback

- Infra PRs: a person applies each from its branch, then merges. An agent
  cannot apply.
- Rollback for a service: set the variable back to `X86_64` and apply. The
  images stay multi-arch, so the x86 task starts with the amd64 variant.
- Rollback for (a): remove the `platforms` input. The images become amd64 only
  again; do this only for services whose task definitions are still x86.

## Testing notes

- No code tests apply to these workflow and Terraform changes. Verification is
  `docker buildx imagetools inspect`, `terraform plan`, `aws ecs
describe-task-definition`, service health in staging, and Cost Explorer.

## Done when

All services run ARM64 in both accounts (check with
`aws ecs describe-task-definition`), and Cost Explorer shows the daily Fargate
cost about 20% lower.
