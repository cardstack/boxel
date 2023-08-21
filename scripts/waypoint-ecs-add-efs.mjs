import fs from 'fs';
import { execSync } from 'child_process';
import {
  getAppConfig,
  getAppNameFromServiceArn,
  getServices,
} from './waypoint-ecs-add-tags.mjs';

function execute(command, options = {}) {
  return execSync(command, options).toString().trim();
}

function taskDefinitionHasVolume(
  taskDefinition,
  name,
  fileSystemId,
  accessPointId,
) {
  if (taskDefinition.volumes?.length === 0) return false;

  const volume = taskDefinition.volumes.find((vol) => vol.name === name);

  if (
    volume?.efsVolumeConfiguration?.fileSystemId !== fileSystemId ||
    volume.efsVolumeConfiguration.authorizationConfig?.accessPointId !==
      accessPointId
  )
    return false;

  return true;
}

function addVolume(
  cluster,
  service,
  volumeName,
  fileSystemId,
  accessPointId,
  containerPath,
) {
  const taskDefinition = JSON.parse(
    execute(
      `aws ecs describe-task-definition --task-definition ${service.taskDefinition}`,
    ),
  );

  if (
    taskDefinitionHasVolume(
      taskDefinition.taskDefinition,
      volumeName,
      fileSystemId,
      accessPointId,
    )
  ) {
    console.log('» Volume already attached');
    return;
  }

  taskDefinition.taskDefinition.volumes = [
    {
      name: volumeName,
      efsVolumeConfiguration: {
        fileSystemId: fileSystemId,
        rootDirectory: '/',
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPointId,
          iam: 'ENABLED',
        },
      },
    },
  ];

  taskDefinition.taskDefinition.containerDefinitions[0].mountPoints = [
    {
      containerPath: containerPath,
      sourceVolume: volumeName,
    },
  ];

  // Remove post-deployment attributes from the fetched task definition, they cannot be specified in a new one
  delete taskDefinition.taskDefinition.taskDefinitionArn;
  delete taskDefinition.taskDefinition.revision;
  delete taskDefinition.taskDefinition.status;
  delete taskDefinition.taskDefinition.requiresAttributes;
  delete taskDefinition.taskDefinition.compatibilities;
  delete taskDefinition.taskDefinition.registeredAt;
  delete taskDefinition.taskDefinition.registeredBy;

  fs.writeFileSync(
    'modified-task-definition.json',
    JSON.stringify(taskDefinition.taskDefinition, null, 2),
  );

  const family = taskDefinition.taskDefinition.family;
  const registeredTaskDefinition = JSON.parse(
    execute(
      `aws ecs register-task-definition` +
        ` --family ${family}` +
        ` --cli-input-json file://modified-task-definition.json`,
    ),
  );

  console.log(`-> Updating service: ${service.serviceName}`);
  execute(
    `aws ecs update-service` +
      ` --cluster ${cluster}` +
      ` --service ${service.serviceArn}` +
      ` --task-definition ${registeredTaskDefinition.taskDefinition.taskDefinitionArn}` +
      ` --force-new-deployment` +
      ` --health-check-grace-period-seconds 330` +
      ` --enable-ecs-managed-tags`,
  );
}

function main() {
  const [
    appName,
    volumeName,
    fileSystemId,
    accessPointId,
    containerPath,
    ...extraArgs
  ] = process.argv.slice(2);
  const waypointConfigFilePath =
    extraArgs.length > 0 ? extraArgs[0] : 'waypoint.hcl';

  const config = getAppConfig(waypointConfigFilePath, appName);

  console.log('\n» Adding volume to task definition…');
  const services = getServices(config.cluster, appName);
  const latestService = services[0];

  addVolume(
    config.cluster,
    latestService,
    volumeName,
    fileSystemId,
    accessPointId,
    containerPath,
  );
}

try {
  main();
} catch (err) {
  console.error(err);
}
