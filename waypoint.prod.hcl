project = "cardstack"

app "realm-demo" {
  path = "./packages/realm-server"

  build {
    use "docker" {
      context = "./"

      build_args = {
        realm_server_script = "start:demo:production"
      }
    }

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "realm-demo-production"
        tag        = "latest"
      }
    }
  }

  deploy {
    use "aws-ecs" {
      region              = "us-east-1"
      memory              = 4096
      cpu                 = 2048 # 2 vCPU's
      cluster             = "realm-demo-production"
      count               = 1
      subnets             = ["subnet-06c640c2bc3b46c6a", "subnet-0ca4ab0b29849bfff"]
      task_role_name      = "realm-demo-ecs-task"
      execution_role_name = "realm-demo-ecs-task-execution"
      security_group_ids  = ["sg-0086ae7f442318880"]

      alb {
        subnets     = ["subnet-06c640c2bc3b46c6a", "subnet-0ca4ab0b29849bfff"]
        certificate = "arn:aws:acm:us-east-1:120317779495:certificate/55a995ef-6f98-4834-a953-e1517cc74fb7"
      }
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/waypoint-ecs-add-tags.mjs", "realm-demo"]
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/waypoint-ecs-add-efs.mjs", "realm-demo", "realm-server-storage", "fs-01beb05ea57cb4894", "fsap-0e1180270a9526966", "/persistent"]
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/wait-service-stable.mjs", "realm-demo"]
    }
  }

  url {
    auto_hostname = false
  }
}
