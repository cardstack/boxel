project = "cardstack"

app "realm-server-base" {
  path = "./packages/realm-server"

  build {
    use "docker" {
      dockerfile = "Dockerfile"
      context = "../../"

      build_args = {
        fixme = "FIXME"
      }
    }

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "boxel-realm-server-base-staging"
        tag        = "latest"
      }
    }
  }

  deploy {
    use "aws-ecs" {
      region              = "us-east-1"
      memory              = "512"
      cluster             = "boxel-realm-server-base-staging"
      count               = 2
      subnets             = ["subnet-099d721ad678d073a", "subnet-0d1196fa815f3d057"]
      task_role_name      = "boxel-realm-server-base-ecs-task"
      execution_role_name = "boxel-realm-server-base-ecs-task-execution"
      security_group_ids  = ["sg-00448d469414495bb"] # FIXME this should be a Terraform output maybe?
      disable_alb         = true
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/waypoint-ecs-add-tags.mjs", "hub-worker"]
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/wait-service-stable.mjs", "hub-worker"]
    }
  }

  url {
    auto_hostname = false
  }
}
