#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out=/tmp/surgeon-secret-hits
: >"$out"

# Credential formats are always reported.
git -C "$root" grep -I -E 'sk-[A-Za-z0-9]{10,}|BEGIN (OPENSSH|RSA) PRIVATE KEY' -- ':!docs' ':!test' >>"$out" || true
# A bare API key mention is reported too, except for the first-party package
# @deepseek-ai/dsh-llm-deepseek-api-key, which is a package name, not a secret.
git -C "$root" grep -I -E 'api[_-]?key' -- ':!docs' ':!test' \
  | grep -v -E '@deepseek-ai/dsh-llm-deepseek-api-key' >>"$out" || true

if [ -s "$out" ]; then
  echo "possible secrets:" >&2
  cat "$out" >&2
  exit 1
fi
echo "no obvious secrets"
