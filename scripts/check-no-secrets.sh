#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
if git -C "$root" grep -I -E 'sk-[A-Za-z0-9]{10,}|BEGIN (OPENSSH|RSA) PRIVATE KEY|api[_-]?key' -- ':!docs' >/tmp/surgeon-secret-hits 2>/dev/null; then
  echo "possible secrets:" >&2
  cat /tmp/surgeon-secret-hits >&2
  exit 1
fi
echo "no obvious secrets"
