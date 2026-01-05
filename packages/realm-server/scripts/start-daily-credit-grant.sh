#! /bin/sh

NODE_NO_WARNINGS=1 \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}" \
  ts-node \
  --transpileOnly daily-credit-grant \
  --priority="${DAILY_CREDIT_GRANT_PRIORITY:-0}"
