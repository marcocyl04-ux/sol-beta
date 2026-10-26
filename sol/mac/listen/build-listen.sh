#!/usr/bin/env bash
# build-listen.sh: builds Sol's listener, the small Swift helper that hears both sides of a conversation for
# Anticipate (this folder), into bin/listen beside this script, where the engine looks for it. One swiftc call, no
# Xcode project. The helper's Info.plist is baked into the binary so macOS can show the mic and system-audio permission
# prompts. It is built for macOS 13 and up so that, on a Mac older than macOS 26, it still starts and says plainly that
# it needs macOS 26. Prints the path; non-zero on failure.
#
# Signing is per machine. The signature is what macOS remembers a permission by. Ad hoc ("-") changes with every
# build, so a granted microphone is forgotten at the next build. When this Mac's keychain holds an Apple Development
# certificate, the first one found signs the helper, the same identity every time, and the grant survives rebuilds;
# without one it is signed ad hoc. SOL_SIGN=<identity> picks another certificate, SOL_SIGN=- forces ad hoc.
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$src/bin"
xcrun swiftc -O -swift-version 5 \
  -target "$(uname -m)-apple-macos13.0" \
  -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$src/Info.plist" \
  -o "$src/bin/listen" \
  "$src/main.swift" "$src/Own.swift" "$src/Lane.swift" "$src/Output.swift" "$src/Sources.swift"
id=${SOL_SIGN:-$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)}
[ -n "$id" ] || id=-
if ! codesign --force --sign "$id" --identifier sol.listen "$src/bin/listen" >/dev/null 2>&1; then
  echo "build-listen: signing with \"$id\" failed; signed ad hoc instead (the mic grant will not survive a rebuild)" >&2
  codesign --force --sign - --identifier sol.listen "$src/bin/listen" >/dev/null 2>&1 || true
fi
echo "$src/bin/listen"
