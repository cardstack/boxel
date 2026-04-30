#!/usr/bin/env bash
#
# claude-aws.sh — generate an AWS STS session for Claude Code to use.
#
# Identity model (CS-10962):
#
#   user IAM identity (long-lived access keys + MFA token)
#     └─ sts:AssumeRole boxel-claude-readonly  (with --serial-number / --token-code)
#         └─ creds written to [claude-<env>]   ← what Claude sees
#
# The named profile `claude-staging` / `claude-prod` ends up holding the
# *role's* credentials, not the user's. This means every `aws --profile
# claude-<env> ...` call Claude makes runs as the dedicated, scoped
# `boxel-claude-readonly` role — independent of which IAM groups the user
# happens to be in. The role is provisioned by separate infra.
#
# We call AssumeRole directly (with --serial-number / --token-code so MFA
# is applied at the role-assumption boundary itself), rather than chaining
# GetSessionToken → AssumeRole. The direct path matches the security model
# more cleanly and gets the full 12h role session — chaining would cap us
# at 1h regardless of the role's max_session_duration.
#
# This script writes the temporary credentials to a named profile in
# ~/.aws/credentials rather than exporting shell-local environment
# variables, so a separate shell (e.g. Claude Code's Bash tool) can pick
# them up via `aws --profile claude-<env>`.
#
# Usage:
#   claude-aws staging <MFA_TOKEN>
#   claude-aws prod    <MFA_TOKEN>
#
# Optional flags:
#   --source-profile <name>   override / set the source AWS profile to use
#                             for this env (cached for next time)
#
# Reset:
#   claude-aws --reset        wipes ${XDG_CONFIG_HOME:-~/.config}/claude-aws/config
#                             so the interactive source-profile prompt
#                             fires from scratch on the next run. Useful
#                             if you typed the wrong profile name. Takes
#                             no other arguments. Does not need aws/jq
#                             installed.
#
# On first run for a given env, the script prompts for the source AWS
# profile (since teammates pick their own profile names) and caches the
# choice at ${XDG_CONFIG_HOME:-~/.config}/claude-aws/config.
#
# After running, Claude can run:
#   aws --profile claude-staging <command>
#   aws --profile claude-prod    <command>

set -euo pipefail

# Fail early with a clear hint if a required dep is missing — without
# this, the user gets an opaque "jq: command not found" mid-script.
# Defined here, but the aws/jq invocations live below the --reset
# early-exit so a teammate without aws/jq installed can still run
# `claude-aws --reset` to recover from a bad cached source-profile.
require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Error: required command '$1' is not installed or not on PATH." >&2
        echo "Install $1 and try again." >&2
        exit 1
    fi
}

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/claude-aws"
CONFIG_FILE="$CONFIG_DIR/config"

# Hardcoded — same role name in both AWS accounts. The role is provisioned
# by the infra side of CS-10962. Don't make this configurable; the whole
# point is that "what Claude is" is fixed and reviewable.
ROLE_NAME="boxel-claude-readonly"

# Role's max_session_duration is 12h; AssumeRole-with-MFA from long-lived
# user creds (the path we use) honors that fully.
ROLE_DURATION_SECONDS=43200

usage() {
    echo "Usage: $0 <staging|prod> <MFA_TOKEN> [--source-profile <name>]" >&2
    echo "   or: $0 --reset       (wipe cached source-profile choices)" >&2
    echo "Example: $0 staging 123456" >&2
    exit 1
}

# --- arg parsing -----------------------------------------------------------

ENV_NAME=""
MFA_TOKEN=""
SOURCE_PROFILE_OVERRIDE=""
RESET=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --source-profile)
            SOURCE_PROFILE_OVERRIDE=${2:-}
            if [ -z "$SOURCE_PROFILE_OVERRIDE" ]; then
                echo "--source-profile requires a value" >&2
                usage
            fi
            shift 2
            ;;
        --reset)
            # Wipe $CONFIG_FILE — forgets all cached source-profile
            # choices. Useful when you typed the wrong profile name and
            # want the prompt back from a clean slate.
            RESET=1
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            if [ -z "$ENV_NAME" ]; then
                ENV_NAME=$1
            elif [ -z "$MFA_TOKEN" ]; then
                MFA_TOKEN=$1
            else
                echo "Unexpected argument: $1" >&2
                usage
            fi
            shift
            ;;
    esac
done

if [ "$RESET" -eq 1 ]; then
    if [ -n "$ENV_NAME" ] || [ -n "$MFA_TOKEN" ] || [ -n "$SOURCE_PROFILE_OVERRIDE" ]; then
        echo "--reset takes no other arguments" >&2
        usage
    fi
    if [ -f "$CONFIG_FILE" ]; then
        rm -f "$CONFIG_FILE"
        echo "Cleared $CONFIG_FILE" >&2
    else
        echo "Nothing to clear (no $CONFIG_FILE)" >&2
    fi
    exit 0
fi

if [ -z "$ENV_NAME" ] || [ -z "$MFA_TOKEN" ]; then
    usage
fi

# Tools needed for the AWS path (not for --reset).
require_command aws
require_command jq

case "$ENV_NAME" in
    staging) TARGET_PROFILE="claude-staging" ;;
    prod)    TARGET_PROFILE="claude-prod"    ;;
    *)
        echo "Unknown environment: $ENV_NAME (expected staging or prod)" >&2
        usage
        ;;
esac

# --- resolve source profile (override > config file > prompt) --------------

# Config file format: simple KEY=VALUE lines, e.g.
#   staging_source_profile=cardstack
#   prod_source_profile=cardstack-prod
CONFIG_KEY="${ENV_NAME}_source_profile"

read_config_value() {
    local key=$1
    [ -f "$CONFIG_FILE" ] || return 0
    # POSIX-friendly extraction. Note: under `set -euo pipefail`, a grep
    # with no match exits 1 and would kill the script silently. The
    # trailing `|| true` makes "no match" behave as "empty result".
    grep -E "^${key}=" "$CONFIG_FILE" | tail -1 | cut -d= -f2- || true
}

write_config_value() {
    local key=$1
    local value=$2
    mkdir -p "$CONFIG_DIR"
    touch "$CONFIG_FILE"
    chmod 600 "$CONFIG_FILE"
    # Strip any existing entry for this key, then append the new one.
    local tmp
    tmp=$(mktemp)
    grep -vE "^${key}=" "$CONFIG_FILE" > "$tmp" || true
    echo "${key}=${value}" >> "$tmp"
    mv "$tmp" "$CONFIG_FILE"
}

prompt_for_source_profile() {
    # Interactive numbered menu — same UX as `boxel profile add`.
    # Reads from ~/.aws/credentials and lets the user type a digit.
    # Falls back to a free-form prompt for the "(other)" option.
    #
    # Refuse to prompt when there's no controlling TTY (CI, automation,
    # piped invocation) — the redirections below would error out
    # unhelpfully. Tell the operator how to provide the value without
    # the interactive flow.
    if [ ! -r /dev/tty ]; then
        echo "No source AWS profile is configured for '$ENV_NAME' and there's no controlling TTY to prompt on." >&2
        echo "" >&2
        echo "Either re-run with --source-profile <name>:" >&2
        echo "  $0 $ENV_NAME <MFA_TOKEN> --source-profile <name>" >&2
        echo "" >&2
        echo "Or pre-populate ~/.config/claude-aws/config before running:" >&2
        echo "  mkdir -p ~/.config/claude-aws && \\" >&2
        echo "    echo '${ENV_NAME}_source_profile=<name>' >> ~/.config/claude-aws/config" >&2
        exit 1
    fi

    local available=()
    if [ -f "$HOME/.aws/credentials" ]; then
        # Strip [profile] headers down to the bare names.
        while IFS= read -r line; do
            available+=("$line")
        done < <(grep -E "^\[" "$HOME/.aws/credentials" | tr -d '[]')
    fi
    available+=("(other — type a custom name)")

    echo "No source AWS profile is configured for '$ENV_NAME'." >&2
    echo "Which AWS profile from ~/.aws/credentials should be the source for $ENV_NAME?" >&2

    local choice=""
    # `select` reads from stdin; force it to the controlling TTY so it
    # works under mise/CI where stdin may be detached. PS3 must be set
    # as its own statement (bash doesn't accept the inline form before
    # `select`).
    PS3="Choice: "
    select choice in "${available[@]}"; do
        [ -n "$choice" ] && break
        echo "Invalid choice — type a number from the list." >&2
    done < /dev/tty >&2

    if [ "$choice" = "(other — type a custom name)" ]; then
        printf "Source AWS profile name: " >&2
        read -r choice < /dev/tty
    fi

    if [ -z "$choice" ]; then
        echo "No profile entered, aborting." >&2
        exit 1
    fi

    printf '%s' "$choice"
}

if [ -n "$SOURCE_PROFILE_OVERRIDE" ]; then
    SOURCE_PROFILE="$SOURCE_PROFILE_OVERRIDE"
    write_config_value "$CONFIG_KEY" "$SOURCE_PROFILE"
    echo "Saved $ENV_NAME source profile = $SOURCE_PROFILE to $CONFIG_FILE" >&2
else
    SOURCE_PROFILE=$(read_config_value "$CONFIG_KEY")
    if [ -z "$SOURCE_PROFILE" ]; then
        SOURCE_PROFILE=$(prompt_for_source_profile)
        write_config_value "$CONFIG_KEY" "$SOURCE_PROFILE"
        echo "Saved $ENV_NAME source profile = $SOURCE_PROFILE to $CONFIG_FILE" >&2
    fi
fi

# --- discover MFA ARN + account ------------------------------------------

# Auto-detect the caller's MFA ARN from their IAM user — keeps the
# script portable across team members without per-user editing.
# The MFA ARN looks like: arn:aws:iam::<account-id>:mfa/<device-name>
# We use the same ARN to figure out which AWS account we're in below,
# so we don't need a sts:GetCallerIdentity round-trip.
MFA_ARN=$(aws iam list-mfa-devices \
    --profile "$SOURCE_PROFILE" \
    --query 'MFADevices[0].SerialNumber' \
    --output text)

if [ -z "$MFA_ARN" ] || [ "$MFA_ARN" = "None" ]; then
    echo "No MFA device registered for profile $SOURCE_PROFILE" >&2
    exit 1
fi

# Extract the 12-digit account id from the MFA ARN. Format guarantee:
# arn:aws:iam::<account>:mfa/<name>. cut on ':' (field 5) gets us the
# account; we sanity-check it's 12 digits before using it downstream.
ACCOUNT_ID=$(printf '%s' "$MFA_ARN" | cut -d: -f5)
if ! printf '%s' "$ACCOUNT_ID" | grep -Eq '^[0-9]{12}$'; then
    echo "Could not parse account id from MFA ARN: $MFA_ARN" >&2
    exit 1
fi

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# --- assume the boxel-claude-readonly role with MFA ----------------------

# Direct AssumeRole — MFA is applied at the role-assumption boundary itself
# via --serial-number / --token-code. The role's trust policy requires
# `aws:MultiFactorAuthPresent`, which is satisfied by these flags.
#
# We pass --output json explicitly so the call doesn't depend on the
# user's `output = ...` AWS CLI default; jq below would break if the
# format were `text` or `table`.
#
# Exit non-zero on AssumeRole failure. Do NOT fall back to writing the
# user's long-lived creds — that would silently put the user's full IAM
# identity into [claude-<env>], which is the exact thing CS-10962 fixes.
ASSUME_STDERR=$(mktemp)
trap 'rm -f "$ASSUME_STDERR"' EXIT

set +e
ASSUME_OUTPUT=$(aws sts assume-role \
    --profile "$SOURCE_PROFILE" \
    --serial-number "$MFA_ARN" \
    --token-code "$MFA_TOKEN" \
    --role-arn "$ROLE_ARN" \
    --role-session-name "claude-${ENV_NAME}-$(date +%s)" \
    --duration-seconds "$ROLE_DURATION_SECONDS" \
    --output json \
    --no-cli-pager \
    2> "$ASSUME_STDERR")
ASSUME_STATUS=$?
set -e

if [ "$ASSUME_STATUS" -ne 0 ]; then
    echo "AssumeRole failed for $ROLE_ARN:" >&2
    cat "$ASSUME_STDERR" >&2
    echo "" >&2
    echo "If the role does not exist yet, the infra side of CS-10962 has not" >&2
    echo "been applied to account $ACCOUNT_ID. If the role exists but you got" >&2
    echo "AccessDenied, check that your IAM user is in a group that's allowed" >&2
    echo "to assume $ROLE_NAME (read-only or full-access). If the MFA token" >&2
    echo "was rejected, wait for a fresh code and retry." >&2
    exit 1
fi

ROLE_ACCESS_KEY_ID=$(printf '%s' "$ASSUME_OUTPUT"     | jq -r '.Credentials.AccessKeyId')
ROLE_SECRET_ACCESS_KEY=$(printf '%s' "$ASSUME_OUTPUT" | jq -r '.Credentials.SecretAccessKey')
ROLE_SESSION_TOKEN=$(printf '%s' "$ASSUME_OUTPUT"     | jq -r '.Credentials.SessionToken')
ROLE_EXPIRATION=$(printf '%s' "$ASSUME_OUTPUT"        | jq -r '.Credentials.Expiration')

# Defensive check: STS should always return non-empty creds on a successful
# call, but if jq somehow extracted "null" (e.g. a future API shape change),
# we'd silently write a broken profile. Catch that here.
for var_name in ROLE_ACCESS_KEY_ID ROLE_SECRET_ACCESS_KEY ROLE_SESSION_TOKEN ROLE_EXPIRATION; do
    if [ -z "${!var_name}" ] || [ "${!var_name}" = "null" ]; then
        echo "AssumeRole returned empty/null $var_name. Aborting without writing profile." >&2
        echo "Raw response: $ASSUME_OUTPUT" >&2
        exit 1
    fi
done

# --- write the role's creds to the named profile -------------------------

aws configure set aws_access_key_id     "$ROLE_ACCESS_KEY_ID"     --profile "$TARGET_PROFILE"
aws configure set aws_secret_access_key "$ROLE_SECRET_ACCESS_KEY" --profile "$TARGET_PROFILE"
aws configure set aws_session_token     "$ROLE_SESSION_TOKEN"     --profile "$TARGET_PROFILE"
# Custom key — `aws sts ...` does not read this, but Claude can grep
# it to know whether the session is still valid. Note: `aws configure
# set` routes any non-credential key to ~/.aws/config (not credentials),
# so this line lands in ~/.aws/config alongside `region`. The skill
# documents that location for the expiration check.
aws configure set claude_session_expiration "$ROLE_EXPIRATION" --profile "$TARGET_PROFILE"

# Carry the source profile's default region forward so commands run
# against $TARGET_PROFILE don't fail with "NoRegion".
SOURCE_REGION=$(aws configure get region --profile "$SOURCE_PROFILE" 2>/dev/null || true)
if [ -n "$SOURCE_REGION" ]; then
    aws configure set region "$SOURCE_REGION" --profile "$TARGET_PROFILE"
fi

echo "Wrote profile [$TARGET_PROFILE] to ~/.aws/credentials"
echo "Identity: $ROLE_ARN (assumed)"
echo "Expires:  $ROLE_EXPIRATION"
echo ""
echo "Claude can now run: aws --profile $TARGET_PROFILE <command>"
