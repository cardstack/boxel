#! /bin/sh
if [ \"$(docker ps -f name='boxel-smtp' --format '{{.Names}}')\" = 'boxel-smtp' ]; then
  echo 'SMTP is already running'
else
  pnpm run start:smtp
fi
