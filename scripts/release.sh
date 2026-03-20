#!/usr/bin/env bash

set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/release.sh [--push-only] [--yes]

Create the next numeric release tag in the form v1, v2, v3, ...

The script will:
1. Fetch tags from origin
2. Find the highest existing vN tag
3. Create the next annotated tag on the current HEAD
4. Push the tag to origin
5. Create a GitHub release if `gh` is available and authenticated

Options:
  --push-only  Skip GitHub release creation and only push the tag
  --yes        Skip the confirmation prompt
EOF
}

require_command() {
    local command_name="$1"
    if ! command -v "${command_name}" >/dev/null 2>&1; then
        echo "Missing required command: ${command_name}" >&2
        exit 1
    fi
}

PUSH_ONLY=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --push-only)
            PUSH_ONLY=1
            shift
            ;;
        --yes)
            ASSUME_YES=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

require_command git

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

current_branch="$(git branch --show-current)"
current_head="$(git rev-parse --short HEAD)"

if [[ -z "${current_branch}" ]]; then
    echo "You are in a detached HEAD state. Check out a branch before releasing." >&2
    exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Working tree is not clean. Commit or stash changes before releasing." >&2
    exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Remote 'origin' is not configured." >&2
    exit 1
fi

echo "Fetching tags from origin..."
git fetch --tags origin

latest_tag="$(
    git tag --list 'v*' \
    | grep -E '^v[0-9]+$' \
    | sort -V \
    | tail -n 1 || true
)"

if [[ -z "${latest_tag}" ]]; then
    next_version=1
else
    next_version="${latest_tag#v}"
    next_version="$((next_version + 1))"
fi

new_tag="v${next_version}"
tag_message="Release ${new_tag}"

echo "Current branch: ${current_branch}"
echo "Current HEAD:   ${current_head}"
echo "Latest tag:     ${latest_tag:-<none>}"
echo "Next tag:       ${new_tag}"

if [[ "${ASSUME_YES}" -ne 1 ]]; then
    read -r -p "Create and push ${new_tag} from ${current_branch}@${current_head}? [y/N] " reply
    case "${reply}" in
        y|Y|yes|YES)
            ;;
        *)
            echo "Cancelled."
            exit 1
            ;;
    esac
fi

git tag -a "${new_tag}" -m "${tag_message}"
git push origin "${new_tag}"

echo "Tag ${new_tag} pushed to origin."
echo "GitHub Actions will now build the versioned artefact for this tag."

if [[ "${PUSH_ONLY}" -eq 1 ]]; then
    exit 0
fi

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh release view "${new_tag}" >/dev/null 2>&1; then
        echo "GitHub release ${new_tag} already exists. Skipping release creation."
    else
        gh release create "${new_tag}" \
            --title "${new_tag}" \
            --generate-notes
        echo "GitHub release ${new_tag} created."
    fi
else
    echo "Skipping GitHub release creation because \`gh\` is not available or not authenticated."
fi
