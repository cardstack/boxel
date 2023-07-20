// This is copied from cardstack/cardstack

import hcl from 'hcl2-parser';
import fs from 'fs';
import { execSync } from 'child_process';

function execute(command, options) {
  return execSync(command, options ?? {})
    .toString()
    .trim();
}

function stripArnPrefix(value) {
  const arnPrefixPattern = /^.*\//;
  return value.replace(arnPrefixPattern, '');
}

function getAppConfig(waypointConfigFilePath, appName) {
  const waypointHcl = fs.readFileSync(waypointConfigFilePath, 'utf8');
  const waypointConfig = hcl.parseToObject(waypointHcl)[0];
  const waypointApp = waypointConfig.app[appName][0];
  const cluster = waypointApp.deploy[0].use['aws-ecs'][0].cluster;

  return { cluster };
}

function listServices(cluster, appName) {
  console.log(`-> Discovering services in cluster "${cluster}"`);
  let serviceNames = [];
  let nextToken = null;
  const serviceNameSuffixPattern = /-[^-]*$/;
  do {
    let responseJson;
    if (nextToken) {
      responseJson = execute(
        `aws ecs list-services --cluster ${cluster} --starting-token ${nextToken}`
      );
    } else {
      responseJson = execute(`aws ecs list-services --cluster ${cluster}`);
    }

    const response = JSON.parse(responseJson);

    const filteredNames = response.serviceArns
      .map((arn) => stripArnPrefix(arn))
      .filter((name) => name.replace(serviceNameSuffixPattern, '') == appName);

    serviceNames = serviceNames.concat(filteredNames);
    nextToken = response.nextToken;
  } while (nextToken);

  return serviceNames;
}

function findService(serviceNames, appName, cluster) {
  console.log(`-> Looking for the latest service`);

  let services = [];
  for (let i = 0; i < serviceNames.length; i += 10) {
    const slicedServiceNames = serviceNames.slice(
      i,
      i + 10 > serviceNames.length ? serviceNames.length : i + 10
    );
    const responseJson = execute(
      `aws ecs describe-services --cluster ${cluster} --services ${slicedServiceNames.join(
        ' '
      )}`
    );
    const response = JSON.parse(responseJson);
    services = services.concat(response.services);
  }

  services.sort((a, b) => {
    if (a.createdAt < b.createdAt) {
      return 1;
    } else if (a.createdAt > b.createdAt) {
      return -1;
    } else {
      return 0;
    }
  });

  console.log(
    `-> Found the latest service ${stripArnPrefix(services[0].serviceArn)}`
  );
  return services[0];
}

function waitServiceStable(service, cluster) {
  const serviceName = stripArnPrefix(service.serviceArn);

  console.log(`-> Waiting until the service is stable: ${serviceName}`);
  execute(
    `aws ecs wait services-stable --cluster ${cluster} --services ${serviceName}`
  );
  console.log(`-> Service is stable: ${serviceName}`);
}

function serviceHasTargetGroup(service) {
  return service.loadBalancers && service.loadBalancers.length > 0;
}

function waitTargetInService(service) {
  const targetGroupSuffixPattern = /\/[^/]*$/;
  const targetGroupArn = service.loadBalancers[0].targetGroupArn;
  const targetGroupName = targetGroupArn.split('/')[1];

  console.log(
    `-> Waiting until targets in target group are in service: ${targetGroupName}`
  );

  let retries = 40;
  let healthy = false;

  while (!healthy && retries > 0) {
    const responseJson = execute(
      `aws elbv2 describe-target-health --target-group-arn ${targetGroupArn}`
    );
    const response = JSON.parse(responseJson);

    for (const target of response.TargetHealthDescriptions) {
      if (target.TargetHealth.State === 'healthy') {
        healthy = true;
        break;
      }
    }

    if (!healthy) {
      execute(`sleep 15`);
      retries--;
    }
  }

  if (!healthy) {
    console.log(`-> Targets not healthy after 10 minutes: ${targetGroupName}`);
    throw 'Targets in target group are not healthy';
  }

  console.log(
    `-> All targets in target group are in service: ${targetGroupName}`
  );
}

function main() {
  console.log('\n» Waiting for service and target group to be ready...');

  const [appName, ...extraArgs] = process.argv.slice(2);
  const waypointConfigFilePath =
    extraArgs.length > 0 ? extraArgs[0] : 'waypoint.hcl';

  const config = getAppConfig(waypointConfigFilePath, appName);
  const services = listServices(config.cluster, appName);
  const service = findService(services, appName, config.cluster);

  waitServiceStable(service, config.cluster);
  if (serviceHasTargetGroup(service)) {
    waitTargetInService(service);
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  throw err;
}
