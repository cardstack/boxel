project = "cardstack"

app "realm-demo" {
  path = "./packages/realm-server"

  build {
    use "docker" {
      context = "./"

      build_args = {
        realm_server_script = "start:staging"
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
        subnets           = ["subnet-099d721ad678d073a", "subnet-0d1196fa815f3d057"]
        load_balancer_arn = "arn:aws:elasticloadbalancing:us-east-1:680542703984:loadbalancer/app/waypoint-ecs-realm-demo/7e699a3b9ff13ebc"
        certificate       = "arn:aws:acm:us-east-1:680542703984:certificate/739f0700-d97e-495d-9947-6b497eb578c6"
      }

      secrets = {
        # parameter store
        BOXEL_HTTP_BASIC_PW = "arn:aws:ssm:us-east-1:680542703984:parameter/staging/boxel/BOXEL_HTTP_BASIC_PW"
      }
    }

    hook {
      when    = "after"
      command = ["node", "./scripts/waypoint-ecs-add-efs.mjs", "realm-demo", "realm-server-storage", "fs-07b96c537c8c42381", "fsap-05f6f7e465f171f43", "/persistent"]
    }
  }

  url {
    auto_hostname = false
  }
}


app "boxel-ai-bot" {
  path = "./packages/ai-bot"

  build {
    use "docker" {
      context = "./"
    }

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "boxel-ai-bot-staging"
        tag        = "latest"
      }
    }
  }

  deploy {
    use "aws-ecs" {
      count               = 1
      cpu                 = 256
      memory              = 512
      cluster             = "staging"
      subnets             = ["subnet-03791d3b2b429e0cf", "subnet-068197c72e4e1fad2"]
      task_role_name      = "boxel-ai-bot-staging-ecs-task"
      execution_role_name = "boxel-ai-bot-staging-ecs-task-execution"
      security_group_ids  = ["sg-026f518a4e82d8a44"]
      region              = "us-east-1"
      disable_alb         = true

      secrets = {
        MATRIX_URL           = "arn:aws:ssm:us-east-1:680542703984:parameter/staging/aibot/matrix/host"
        BOXEL_AIBOT_USERNAME = "arn:aws:ssm:us-east-1:680542703984:parameter/staging/aibot/matrix/username"
        BOXEL_AIBOT_PASSWORD = "arn:aws:ssm:us-east-1:680542703984:parameter/staging/aibot/matrix/password"
        OPENAI_API_KEY       = "arn:aws:ssm:us-east-1:680542703984:parameter/staging/aibot/openai/apikey"
      }
    }
  }

  url {
    auto_hostname = false
  }
}