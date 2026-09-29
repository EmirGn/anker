#!/usr/bin/env bash
# Builds an unsigned Anker .ipa for iPad and iPhone (needs macOS + Xcode 16+).
# Sideload it with AltStore or Sideloadly, which sign it with your Apple ID.
# usage: scripts/build-ios.sh [out-dir]   (default: packages/app/ios/App/output)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/packages/app"
out="${1:-$app/ios/App/output}"
version="$(node -p "require('$root/package.json').version")"
# Same scheme as Android's versionCode: 1.2.3 → 10203
build="$(node -p "'$version'.split('.').map(Number).reduce((a, n) => a * 100 + n, 0)")"

(cd "$root" && npm run build -w @anker/app)
(cd "$app" && npx cap sync ios)

derived="$app/ios/App/build"
xcodebuild \
  -project "$app/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$derived" \
  MARKETING_VERSION="$version" \
  CURRENT_PROJECT_VERSION="$build" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

staging="$(mktemp -d)"
mkdir -p "$staging/Payload" "$out"
cp -R "$derived/Build/Products/Release-iphoneos/App.app" "$staging/Payload/Anker.app"
rm -f "$out/Anker-$version.ipa"
(cd "$staging" && zip -qry "$out/Anker-$version.ipa" Payload)
rm -rf "$staging"
echo "→ $out/Anker-$version.ipa"
