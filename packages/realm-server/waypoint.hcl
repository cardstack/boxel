project = "cardstack"

app "boxel-realm-server" {
  build {
    use "docker" {
      context  = "../../"
      buildkit = true
      platform = "linux/amd64"

      build_args = {
        realm_server_script = "start:staging"
      }
    }

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "boxel-realm-server-staging"
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
      cluster             = "staging"
      subnets             = ["subnet-03791d3b2b429e0cf", "subnet-068197c72e4e1fad2"]
      task_role_name      = "boxel-realm-staging-ecs-task"
      execution_role_name = "boxel-realm-staging-ecs-task-execution"
      security_group_ids  = ["sg-081ca7969f2a67f42"]

      alb {
        subnets           = ["subnet-08897ea4379ab8c3e", "subnet-0b9b4c967b070590f"]
        load_balancer_arn = "arn:aws:elasticloadbalancing:us-east-1:680542703984:loadbalancer/app/waypoint-ecs-boxel-realm-staging/30dfa5ad88ce652d"
        certificate       = "arn:aws:acm:us-east-1:680542703984:certificate/739f0700-d97e-495d-9947-6b497eb578c6"
      }

      secrets = {
        # parameter store
        BOXEL_HTTP_BASIC_PW = "arn:aws:ssm:us-east-1:680542703984:parameter/staging/boxel/BOXEL_HTTP_BASIC_PW"
      }
    }
  }

  url {
    auto_hostname = false
  }
}
