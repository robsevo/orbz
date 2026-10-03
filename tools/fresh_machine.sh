#!/usr/bin/env bash
# PLAN 1.3_t: a fresh machine with NO Python gets a working kit.
#
# A clean ubuntu:24.04 container (it ships no Python; F.0 proves it), a non-root user, a checkout
# of the repo as this working tree has it (tracked files plus new ones git does not ignore,
# committed into a fresh repository, as a clone would give), and `uv` — the
# one binary Orbs' installer bundles (PLAN 6.1). Then `uv` installs the kit's own Python and its
# locked packages by itself, and the kit's suites run: Ash's carried suites, the MCP server
# through the SDK's own client, and the carry check.
#
#   tools/fresh_machine.sh              needs docker and network (uv downloads Python and packages)
#   tools/fresh_machine.sh --download   also download the 510 MB of models from upstream; by default
#                                       they come from this machine's kit/ash/models, and either way
#                                       each is kept only if its pinned sha256 matches
#
# git: a checkout is a git repository, and the carried secretscan suites scan what git tracks.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v docker >/dev/null || { echo "needs docker"; exit 2; }
UV="$(command -v uv)" || { echo "needs uv on this machine, to hand to the container"; exit 2; }
TAR="$(mktemp --suffix=.tar)"
trap 'rm -f "$TAR"' EXIT
git -C "$ROOT" ls-files -z --cached --others --exclude-standard \
  | tar -C "$ROOT" --null -T - -cf "$TAR"
chmod 0644 "$TAR"   # mktemp makes it 0600; the container's user must read it

MODELS_ARGS=(); MODELS_FROM=""
if [ "${1:-}" != "--download" ] && [ -d "$ROOT/kit/ash/models" ]; then
  MODELS_ARGS=(-v "$ROOT/kit/ash/models":/models:ro); MODELS_FROM="--from /models"
fi

exec docker run --rm -e MODELS_FROM="$MODELS_FROM" "${MODELS_ARGS[@]}" -v "$TAR":/src.tar:ro -v "$UV":/usr/local/bin/uv:ro ubuntu:24.04 bash -c '
set -u
fail=0
if command -v python3 >/dev/null || command -v python >/dev/null; then
  echo "FAIL  F.0 this image already has a Python, so it proves nothing"; exit 1
fi
echo "PASS  F.0 no Python on this machine"
apt-get update -qq >/dev/null && apt-get install -y -qq git >/dev/null 2>&1 || { echo "apt failed"; exit 3; }
useradd -m t
su t -c "mkdir -p ~/orbs && tar -C ~/orbs -xf /src.tar && cd ~/orbs && git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm checkout"
echo "== uv prepares the kit (its own Python, the locked packages)"
su t -c "cd ~/orbs && uv sync --project kit --locked --quiet && echo \"kit python: \$(uv run --project kit --locked python -c \"import sys; print(sys.version.split()[0], sys.executable)\")\"" || fail=1
echo "== the models (${MODELS_FROM:-downloaded from upstream}), each checked against its pinned sha256"
su t -c "cd ~/orbs/kit && uv run --project . --locked python -m orbs_kit.models $MODELS_FROM" || fail=1
echo "== the kit suites"
su t -c "cd ~/orbs && uv run --project kit --locked python kit/tests/run.py" > /tmp/kit.log 2>&1; rc=$?
grep -E "^(FAIL|    )|kit test files" /tmp/kit.log | head -40
[ $rc = 0 ] && echo "PASS  F.1 every kit suite passes on a machine that had no Python" || { echo "FAIL  F.1 kit suites (exit $rc)"; fail=1; }
echo "== the carry check"
su t -c "cd ~/orbs && uv run --project kit --locked python tools/adoption/carry.py --check" && echo "PASS  F.2 the carried files are what carry.py carried" || fail=1
[ $fail = 0 ] && echo "ALL PASS" || echo "FAILED"
exit $fail
'
