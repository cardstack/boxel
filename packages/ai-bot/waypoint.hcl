project = "cardstack"

app "boxel-ai-bot" {
  build {
    use "docker" {
      context  = "../../"
      buildkit = true
      platform = "linux/amd64"
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
      architecture        = "x86_64"
      cluster             = "staging"
      task_role_name      = "boxel-ai-bot-staging-ecs-task"
      execution_role_name = "boxel-ai-bot-staging-ecs-task-execution"
      security_group_ids  = ["sg-026f518a4e82d8a44"]
      region              = "us-east-1"
      disable_alb         = true

      subnets = ["subnet-03791d3b2b429e0cf", "subnet-068197c72e4e1fad2"]

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
