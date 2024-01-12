#! /bin/sh
if [ \"$(docker ps -f name='boxel-synapse' --format '{{.Names}}')\" = 'boxel-synapse' ]; then
  echo 'synapse is already running'
else
  pnpm run start:synapse
fi
