project = "cardstack"

app "boxel-ai-bot" {
  build {
    use "docker" {
      context = "../../"
    }

    registry {
      use "aws-ecr" {
        region     = "us-east-1"
        repository = "boxel-ai-bot-production"
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

      task_role_name      = "boxel-ai-bot-production-ecs-task"
      execution_role_name = "boxel-ai-bot-production-ecs-task-execution"
      security_group_ids  = ["sg-0e54d5c1e42f8ef20"]
      region              = "us-east-1"

      secrets = {
        MATRIX_URL           = "arn:aws:ssm:us-east-1:120317779495:parameter/production/aibot/matrix/host"
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
