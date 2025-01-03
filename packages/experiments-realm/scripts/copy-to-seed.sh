#!/usr/bin/env bash

set -eu

EXPERIMENTS_PATH="."
SEED_PATH="../seed-realm"

if [ "$#" -lt 2 ]; then
    printf "Usage: %s <extension> <name1> [name2 ...]\n" "$0"
    printf "Example: %s gts blog-post task\n" "$0"
    printf "Example: %s json blog-post task\n" "$0"
    exit 1
fi

EXTENSION="$1"
shift

copy_to_seed() {
    name="$1"
    source_file="${name}.${EXTENSION}"
    dir_name="${name}"

    # Check if source files/directories exist
    if [ ! -f "${EXPERIMENTS_PATH}/${source_file}" ] && [ ! -d "${EXPERIMENTS_PATH}/${dir_name}" ]; then
        printf "Error: Neither %s nor %s/ found in %s\n" "${source_file}" "${dir_name}" "${EXPERIMENTS_PATH}"
        return 1
    fi

    # Copy file if it exists
    if [ -f "${EXPERIMENTS_PATH}/${source_file}" ]; then
        if [ -f "${SEED_PATH}/${source_file}" ] && [ "${FORCE_COPY_TO_SEED:-false}" != "true" ]; then
            if diff -q "${EXPERIMENTS_PATH}/${source_file}" "${SEED_PATH}/${source_file}" >/dev/null; then
                printf "Skipping %s (files are identical)\n" "${source_file}"
            else
                printf "Warning: %s exists in %s with different content\n" "${source_file}" "${SEED_PATH}"
                printf "Diff:\n"
                diff "${EXPERIMENTS_PATH}/${source_file}" "${SEED_PATH}/${source_file}" || true
            fi
        else
            printf "Copying file:\n  From: %s/%s\n    To: %s/%s\n" "${EXPERIMENTS_PATH}" "${source_file}" "${SEED_PATH}" "${source_file}"
            cp "${EXPERIMENTS_PATH}/${source_file}" "${SEED_PATH}/${source_file}"
        fi
    fi

    # Copy directory if it exists
    if [ -d "${EXPERIMENTS_PATH}/${dir_name}" ]; then
        # Use find to locate files with the specified extension
        find "${EXPERIMENTS_PATH}/${dir_name}" -type f -name "*.${EXTENSION}" | while IFS= read -r file; do
            relative_path="${file#${EXPERIMENTS_PATH}/}"
            target_dir="${SEED_PATH}/$(dirname "${relative_path}")"
            target_file="${SEED_PATH}/${relative_path}"
            
            if [ -f "${target_file}" ] && [ "${FORCE_COPY_TO_SEED:-false}" != "true" ]; then
                if diff -q "${file}" "${target_file}" >/dev/null; then
                    printf "Skipping %s (files are identical)\n" "${relative_path}"
                else
                    printf "Warning: %s exists in %s with different content\n" "${relative_path}" "${SEED_PATH}"
                    printf "Diff:\n"
                    diff "${file}" "${target_file}" || true
                fi
            else
                printf "Copying:\n  From: %s\n    To: %s\n" "${file}" "${target_file}"
                mkdir -p "${target_dir}"
                cp "${file}" "${target_file}"
            fi
        done
    fi
}

for name in "$@"; do
    copy_to_seed "${name}"
done 