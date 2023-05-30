project = "cardstack"

app "realm-base" {
  path = "./packages/realm-server"

  build {
    use "docker" {
      # This just means the root of the repository, it’s not relative to the above
      context = "./"

      build_args = {
        realm_server_script = "start:base:staging"
      }
    }

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "realm-base-staging"
        tag        = "latest"
      }
    }
  }

  deploy {
    use "aws-ecs" {
      region              = "us-east-1"
      memory              = 4096
      cpu                 = 2048 # 2 vCPU's
      cluster             = "realm-base-staging"
      count               = 1
      subnets             = ["subnet-099d721ad678d073a", "subnet-0d1196fa815f3d057"]
      task_role_name      = "realm-base-ecs-task"
      execution_role_name = "realm-base-ecs-task-execution"
      security_group_ids  = ["sg-0c6700e72bc20f766"]

      alb {
        subnets     = ["subnet-099d721ad678d073a", "subnet-0d1196fa815f3d057"]
        certificate = "arn:aws:acm:us-east-1:680542703984:certificate/739f0700-d97e-495d-9947-6b497eb578c6"
      }
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/waypoint-ecs-add-tags.mjs", "realm-base"]
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/waypoint-ecs-add-efs.mjs", "realm-base", "realm-server-storage", "fs-07b96c537c8c42381", "fsap-05f6f7e465f171f43", "/persistent"]
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/wait-service-stable.mjs", "realm-base"]
    }
  }

  url {
    auto_hostname = false
  }
}

app "realm-demo" {
  path = "./packages/realm-server"

  build {
    use "docker" {
      context = "./"

      build_args = {
        realm_server_script = "start:demo:staging"
      }
    }

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "realm-demo-staging"
        tag        = "latest"
      }
    }
  }

  deploy {
    use "aws-ecs" {
      region              = "us-east-1"
      memory              = 4096
      cpu                 = 2048 # 2 vCPU's
      cluster             = "realm-demo-staging"
      count               = 1
      subnets             = ["subnet-099d721ad678d073a", "subnet-0d1196fa815f3d057"]
      task_role_name      = "realm-demo-ecs-task"
      execution_role_name = "realm-demo-ecs-task-execution"
      security_group_ids  = ["sg-0c6700e72bc20f766"]

      alb {
        subnets     = ["subnet-099d721ad678d073a", "subnet-0d1196fa815f3d057"]
        certificate = "arn:aws:acm:us-east-1:680542703984:certificate/739f0700-d97e-495d-9947-6b497eb578c6"
      }
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/waypoint-ecs-add-tags.mjs", "realm-demo"]
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/waypoint-ecs-add-efs.mjs", "realm-demo", "realm-server-storage", "fs-07b96c537c8c42381", "fsap-05f6f7e465f171f43", "/persistent"]
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
