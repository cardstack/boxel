#!/usr/bin/env bash
# Run one DB-migration phase as a one-shot ECS task and gate on its exit code,
# so the deploy never proceeds past a failed migration. Shared by the
# migrate-db (expand) and migrate-db-remove (removal) jobs in manual-deploy.yml
# so both phases use identical, in-lockstep orchestration.
#
# The in-container command to run is passed as this script's arguments, e.g.
#   run-gated-migration-task.sh ./scripts/run-migrations.sh
#   run-gated-migration-task.sh ./scripts/run-migrations.sh migrations-removal migrations_removal
#
# Everything else comes from the job environment:
#   CLUSTER SERVICE CONTAINER IMAGE LOG_GROUP TIMEOUT_SECONDS GITHUB_SHA
set -euo pipefail

region=us-east-1
console_logs="https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${LOG_GROUP}"

# Register a new revision of the pg-migration task definition pinned to the
# image just built. Strip the read-only fields describe returns that
# register-task-definition rejects.
aws ecs describe-task-definition --task-definition "$SERVICE" \
  --query 'taskDefinition' --output json > td.json
jq --arg IMAGE "$IMAGE" --arg CONTAINER "$CONTAINER" '
  .containerDefinitions |= map(if .name == $CONTAINER then .image = $IMAGE else . end)
  | del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
        .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)
' td.json > td-new.json
task_def=$(aws ecs register-task-definition --cli-input-json file://td-new.json \
  --query 'taskDefinition.taskDefinitionArn' --output text)
echo "Registered migration task definition: $task_def"

# Place the one-shot task in the pg-migration service's own network config —
# its security group is the one allowed to reach the DB.
net=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].networkConfiguration.awsvpcConfiguration' --output json)
subnets=$(echo "$net" | jq -r '.subnets | join(",")')
groups=$(echo "$net" | jq -r '.securityGroups | join(",")')
public=$(echo "$net" | jq -r '.assignPublicIp // "DISABLED"')

# Override the command to run the migrations WITHOUT the service's trailing
# `sleep infinity`, so the task exits with the migration's status instead of
# staying up. The command comes from this script's arguments.
overrides=$(jq -cn --arg CONTAINER "$CONTAINER" \
  '{containerOverrides: [{name: $CONTAINER, command: $ARGS.positional}]}' \
  --args "$@")
run_out=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$task_def" \
  --launch-type FARGATE \
  --count 1 \
  --started-by "deploy-${GITHUB_SHA:0:7}" \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$groups],assignPublicIp=$public}" \
  --overrides "$overrides" \
  --output json)
task_arn=$(echo "$run_out" | jq -r '.tasks[0].taskArn // empty')
if [ -z "$task_arn" ]; then
  echo "::error::Failed to start the migration task."
  echo "$run_out" | jq '.failures'
  exit 1
fi
echo "Started migration task: $task_arn"

# Wait for the task to stop, then gate on the container's exit code.
deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
while :; do
  status=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].lastStatus' --output text)
  echo "migration task status: $status"
  [ "$status" = "STOPPED" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error::Timed out after ${TIMEOUT_SECONDS}s waiting for the migration task to finish."
    echo "Migration logs: ${console_logs}"
    aws ecs stop-task --cluster "$CLUSTER" --task "$task_arn" \
      --reason "migration gate timeout" >/dev/null 2>&1 || true
    exit 1
  fi
  sleep 10
done

exit_code=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
  --query "tasks[0].containers[?name=='${CONTAINER}']|[0].exitCode" --output text)
echo "migration container exit code: ${exit_code}"
if [ "$exit_code" != "0" ]; then
  echo "::error::DB migration failed (exit ${exit_code}) — deploy blocked so the app never runs ahead of its schema."
  aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$task_arn" \
    --query "tasks[0].{stopCode:stopCode,taskReason:stoppedReason,containerReason:containers[?name=='${CONTAINER}']|[0].reason}" \
    --output table || true
  echo "Migration logs: ${console_logs}"
  exit 1
fi
echo "DB migration succeeded."
