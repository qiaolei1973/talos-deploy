#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-patch}"
ROOT="$(git rev-parse --show-toplevel)"
CLI="$ROOT/cli"

cd "$CLI"

# Bump version without creating a git tag (we use cli-v* format)
npm version "$BUMP" --no-git-tag-version

# Re-sync root lockfile (workspace mode)
cd "$ROOT"
npm install --package-lock-only

VER=$(node -e "console.log(require('./cli/package.json').version)")
TAG="cli-v${VER}"

git add cli/package.json package-lock.json
git commit -m "release: cli v${VER}"
git tag -a "$TAG" -m "release: cli v${VER}"
BRANCH=$(git branch --show-current)
git push origin "$BRANCH" --follow-tags

echo "✅ Released cli v${VER} — tag $TAG pushed, publish workflow triggered."
