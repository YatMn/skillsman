#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The original five regression intentions now use the real filesystem fixture.
exec node --test "${ROOT_DIR}/test/entrypoints.test.cjs"
