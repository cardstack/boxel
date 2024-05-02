#! /bin/sh

NODE_NO_WARNINGS=1 run-p \
  start-and-wait:development \
  start-and-wait:base:root \
  start-and-wait:test-realms \
  start-and-wait:test-container
