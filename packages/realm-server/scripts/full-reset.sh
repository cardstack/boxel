#! /bin/sh
CURRENT_DIR="$(pwd)"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

errors=()

run_command() {
    "$@"
    if [ $? -ne 0 ]; then
        errors+=("Failed: $*")
    fi
}

cd ${SCRIPTS_DIR}/../../postgres || errors+=("Failed: changing to postgres directory")
run_command pnpm run drop-db boxel
run_command pnpm run drop-db boxel_test
run_command pnpm run drop-db boxel_base

if ! rm -rf "${SCRIPTS_DIR}/../realms"; then
    errors+=("Failed: removing realms directory")
fi

cd "${SCRIPTS_DIR}/../../matrix" || errors+=("Failed: changing to matrix directory")

run_command pnpm stop:synapse

if ! rm -rf ./synapse-data; then
    errors+=("Failed: removing synapse-data")
fi

run_command pnpm start:synapse
run_command pnpm register-all

cd "${CURRENT_DIR}" || errors+=("Failed: returning to original directory")

echo "
WARNING: Any matrix server authorization tokens cached in the browser's localstorage are now invalid. Make sure to clear browser localstorage. Also make sure to execute the following in the browser after logging in as 'user' to add the experiments realm:

window['@cardstack/host'].lookup('service:matrix-service')._client.setAccountData('com.cardstack.boxel.realms', {realms: ['http://localhost:4201/experiments/']})
"

if [ ${#errors[@]} -ne 0 ]; then
    echo "\nThe following errors occurred during execution:"
    printf '%s\n' "${errors[@]}"
    exit 1
else
    echo "\nAll operations completed successfully."
fi
