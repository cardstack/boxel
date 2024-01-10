project = "cardstack"

app "boxel-realm-server" {
  build {
    use "docker" {
      context  = "../../"
      buildkit = true
      platform = "linux/amd64"

      build_args = {
        realm_server_script = "start:production"
      }
    }

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "boxel-realm-server-production"
        tag        = "latest"
      }
    }
  }

  deploy {
    use "aws-ecs" {
      count               = 1
      cpu                 = 2048
      memory              = 4096
      architecture        = "x86_64"
      region              = "us-east-1"
      cluster             = "production"
      subnets             = ["subnet-0464e7c634d7d2bb8", "subnet-0a03d794786fca955", "subnet-0e7de528f9d7cd414"]
      task_role_name      = "boxel-realm-server-production-ecs-task"
      execution_role_name = "boxel-realm-server-production-ecs-task-execution"
      security_group_ids  = ["sg-062749d2e257fb537"]

      alb {
        subnets           = ["subnet-05b7ef803ba833852", "subnet-09ceeebe1c07bbf29", "subnet-0f9605892633c55be"]
        load_balancer_arn = "arn:aws:elasticloadbalancing:us-east-1:120317779495:loadbalancer/app/waypoint-ecs-boxel-realm-server/29e02ba86af26414"
        certificate       = "arn:aws:acm:us-east-1:120317779495:certificate/55a995ef-6f98-4834-a953-e1517cc74fb7"
      }

      # parameter store
      secrets = {
        BOXEL_HTTP_BASIC_PW = "arn:aws:ssm:us-east-1:120317779495:parameter/production/boxel/BOXEL_HTTP_BASIC_PW"
        REALM_USER_PERMISSONS = "arn:aws:ssm:us-east-1:120317779495:parameter/production/boxel/REALM_USER_PERMISSONS"
      }
    }
  }

  url {
    auto_hostname = false
  }
}
