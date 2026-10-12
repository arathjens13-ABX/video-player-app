#!/usr/bin/env bash
# Runs the stream pipeline (plan → download → decrypt → assemble) on the test
# fixtures in Node and in the Hermes VM, and checks the MP4s are byte-identical.
# Phones run Hermes, which has no JIT and fewer built-ins than Node.
#
# Usage: scripts/hermes/check.sh /path/to/hermes
# Build Hermes (needs cmake, ninja, clang, libicu-dev):
#   git clone --depth 1 --branch hermes-v250829098.0.17 https://github.com/facebook/hermes
#   cmake -S hermes -B hermes-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DHERMES_ENABLE_INTL=OFF -DHERMES_ENABLE_TEST_SUITE=OFF
#   ninja -C hermes-build hermes
set -euo pipefail
HERMES=${1:?usage: check.sh /path/to/hermes}
DIR=$(cd "$(dirname "$0")" && pwd)
OUT=$(mktemp -d)
cd "$DIR/../.."

node -e "
const fs=require('fs'),path=require('path');
const root='tests/fixtures', out={};
(function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f); fs.statSync(p).isDirectory()?walk(p):out[path.relative(root,p)]=fs.readFileSync(p).toString('base64');}})(root);
fs.writeFileSync('$DIR/fixtures.gen.js','export default '+JSON.stringify(out)+';');"

npx -y esbuild@0.25.10 "$DIR/entry.ts" --bundle --format=iife --target=es2020 --platform=neutral \
  --main-fields=main,module --outfile="$OUT/bundle.js" --log-level=warning
rm -f "$DIR/fixtures.gen.js"

node "$OUT/bundle.js" > "$OUT/node.out"
# React Native's Babel preset always transforms block scoping; -Xes6-block-scoping gives Hermes the same semantics.
"$HERMES" -O -Xes6-block-scoping -w "$OUT/bundle.js" > "$OUT/hermes.out"

status=0
for name in $(grep '^RESULT' "$OUT/node.out" | awk '{print $2}'); do
  a=$(grep "^B64 $name " "$OUT/node.out" | md5sum | cut -c1-12)
  b=$(grep "^B64 $name " "$OUT/hermes.out" | md5sum | cut -c1-12)
  if [ "$a" = "$b" ]; then echo "✓ $name identical in Node and Hermes"; else echo "✗ $name differs"; status=1; fi
done
grep -q '^DONE' "$OUT/hermes.out" || { echo "✗ Hermes run did not finish:"; grep FAILED "$OUT/hermes.out"; status=1; }
exit $status
