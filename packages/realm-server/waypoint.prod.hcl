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
      subnets             = []
      task_role_name      = ""
      execution_role_name = ""
      security_group_ids  = [""]

      alb {
        subnets           = []
        load_balancer_arn = ""
        certificate       = "arn:aws:acm:us-east-1:120317779495:certificate/55a995ef-6f98-4834-a953-e1517cc74fb7"
      }

      secrets = {
        # parameter store
        BOXEL_HTTP_BASIC_PW = "arn:aws:ssm:us-east-1:120317779495:parameter/production/boxel/BOXEL_HTTP_BASIC_PW"
      }
    }
  }

  url {
    auto_hostname = false
  }
}
