#! /bin/sh
CURRENT_DIR="$(pwd)"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

pnpm run drop-db boxel
pnpm run drop-db boxel_test
pnpm run drop-db boxel_base
pnpm run drop-db boxel_test_base_root

# clearing the DB means that we also lose all the info we have on the realm
# owners of the dynamic realms, which means that we should eliminate these as
# well.
rm -rf "${SCRIPTS_DIR}/../realms"

# also now you will have users that have realm associations to realms that don't
# exist anymore, so we should clear the matrix state so it can be in sync with
# the DB state
cd "${SCRIPTS_DIR}/../../matrix"
pnpm stop:synapse
rm -rf ./synapse-data
pnpm start:synapse
pnpm register-all

cd "${CURRENT_DIR}"

echo "
WARNING: Any matrix server authorization tokens cached in the browser's localstorage are now invalid. Make sure to clear browser localstorage. Also make sure to execute the following in the browser after logging in as 'user' to add the experiments realm: 

window['@cardstack/host'].lookup('service:matrix-service')._client.setAccountData('com.cardstack.boxel.realms', {realms: ['http://localhost:4201/experiments/']})
"
