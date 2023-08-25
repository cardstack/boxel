project = "cardstack"

app "aibot" {
  build {
    use "docker" {}

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "boxel-aibot-production"
        tag        = "latest"
      }
    }
  }

  deploy {
    use "aws-ecs" {
      count   = 1
      cpu     = 256
      memory  = 512
      cluster = "production"

      subnets = [
        "subnet-0464e7c634d7d2bb8",
        "subnet-0a03d794786fca955",
        "subnet-0e7de528f9d7cd414",
      ]

      task_role_name      = "boxel-aibot-production-ecs-task"
      execution_role_name = "boxel-aibot-production-ecs-task-execution"
      security_group_ids  = ["sg-0be7b0aab8ba531e5"]
      region              = "us-east-1"

      secrets = {
        BOXEL_AIBOT_USERNAME = "arn:aws:ssm:us-east-1:120317779495:parameter/production/aibot/matrix/username"
        BOXEL_AIBOT_PASSWORD = "arn:aws:ssm:us-east-1:120317779495:parameter/production/aibot/matrix/password"
        OPENAI_API_KEY       = "arn:aws:ssm:us-east-1:120317779495:parameter/production/aibot/openai/apikey"
      }
    }
  }

  url {
    auto_hostname = false
  }
}
