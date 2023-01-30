import fs from 'fs';
import { execSync } from 'child_process';
import { getAppConfig, getAppNameFromServiceArn, getServices } from './waypoint-ecs-add-tags-and-grace.mjs';

function execute(command, options = {}) {
  return execSync(command, options).toString().trim();
}

function addVolume(cluster, service) {
  const taskDefinition = JSON.parse(execute(`aws ecs describe-task-definition --task-definition ${service.taskDefinition}`));
  taskDefinition.taskDefinition.volumes = [
    {
        "name": "doesitexist",
        "efsVolumeConfiguration": {
            "fileSystemId": "fs-07b96c537c8c42381",
            "rootDirectory": "/",
            "transitEncryption": "ENABLED",
            "authorizationConfig": {
                "accessPointId": "fsap-05f6f7e465f171f43",
                "iam": "ENABLED"
            }
        }
    }
  ];

  taskDefinition.taskDefinition.containerDefinitions[0].mountPoints = [{
    containerPath: '/persistent',
    sourceVolume: 'doesitexist',
  }];

  console.log('td', taskDefinition);

  delete taskDefinition.taskDefinition.taskDefinitionArn;
  delete taskDefinition.taskDefinition.revision;
  delete taskDefinition.taskDefinition.status;
  delete taskDefinition.taskDefinition.requiresAttributes;
  delete taskDefinition.taskDefinition.compatibilities;
  delete taskDefinition.taskDefinition.registeredAt;
  delete taskDefinition.taskDefinition.registeredBy;

  fs.writeFileSync('modified-task-definition.json', JSON.stringify(taskDefinition.taskDefinition, null, 2));

  const family = taskDefinition.taskDefinition.family;
  const registeredTaskDefinition = JSON.parse(execute(
    `aws ecs register-task-definition` +
      ` --family ${family}` +
      ` --cli-input-json file://modified-task-definition.json`
  ));

  console.log('rtd', registeredTaskDefinition);

  console.log(`-> Updating service: ${service.serviceName}`);
  execute(
    `aws ecs update-service` +
      ` --cluster ${cluster}` +
      ` --service ${service.serviceArn}` +
      ` --task-definition ${registeredTaskDefinition.taskDefinition.taskDefinitionArn}` +
      ` --force-new-deployment` +
      ` --health-check-grace-period-seconds 240` +
      ` --enable-ecs-managed-tags`
  );
}

function main() {
  const [appName, ...extraArgs] = process.argv.slice(2);
  const waypointConfigFilePath = extraArgs.length > 0 ? extraArgs[0] : 'waypoint.hcl';

  const config = getAppConfig(waypointConfigFilePath, appName);

  console.log('\n» Adding volume to task definition…');
  const services = getServices(config.cluster, appName);
  const latestService = services[0];

  addVolume(config.cluster, latestService);
}

try {
  main();
} catch (err) {
  console.error(err);
}
