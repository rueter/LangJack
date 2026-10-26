#!/usr/bin/env bash
# ==============================================================================
# LangJack - Cross-Platform Packaging Script (Chrome, Firefox, Android)
# ==============================================================================
# Automatically generates clean, production-ready packages for:
#   1. Google Chrome Web Store & Chromium on Android (.zip)
#   2. Mozilla Firefox & Firefox for Android (.xpi / .zip)
#   3. Google Chrome on Android Progressive Web App (.zip)
# from a single unified codebase.
#
# Usage:
#   ./package_extension.sh [options]
#
# Targets:
#   --all                 Build packages for Chrome, Firefox, and Android PWA (Default)
#   --chrome              Build Chrome package only (.zip)
#   --firefox             Build Firefox package only (.xpi & .zip)
#   --android, --pwa      Build Chrome on Android Progressive Web App only (.zip)
#
# Options:
#   --without-paradigm    Hide Paradigm Discoverer UI in package (Default for v1.0)
#   --with-paradigm       Keep Paradigm Discoverer UI visible in package
#   --full                Bundle all offline models (~68MB, within store limits) (Default)
#   --lite                Bundle starter models only (~161KB, downloads on demand)
#   -o, --output <path>   Specify custom output file path (single target mode)
#   -h, --help            Show this help message and exit
# ==============================================================================

set -euo pipefail

# Ensure we run from the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Defaults
TARGET="all"
INCLUDE_PARADIGM=false
PACKAGE_MODE="full"
CUSTOM_OUTPUT=""

# Parse command line options
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      TARGET="all"
      shift
      ;;
    --chrome)
      TARGET="chrome"
      shift
      ;;
    --firefox)
      TARGET="firefox"
      shift
      ;;
    --android|--pwa)
      TARGET="android"
      shift
      ;;
    --without-paradigm)
      INCLUDE_PARADIGM=false
      shift
      ;;
    --with-paradigm)
      INCLUDE_PARADIGM=true
      shift
      ;;
    --full)
      PACKAGE_MODE="full"
      shift
      ;;
    --lite)
      PACKAGE_MODE="lite"
      shift
      ;;
    -o|--output)
      CUSTOM_OUTPUT="$2"
      shift 2
      ;;
    -h|--help)
      cat << 'EOF'
LangJack - Cross-Platform Production Packaging Script

Usage:
  ./package_extension.sh [options]

Targets:
  --all                 Build packages for Chrome, Firefox, and Android PWA (Default)
  --chrome              Build Chrome Web Store package (.zip)
  --firefox             Build Mozilla Firefox Add-on package (.xpi & .zip)
  --android, --pwa      Build Chrome on Android Progressive Web App package (.zip)

Options:
  --without-paradigm    Hide Paradigm Discoverer UI in package (Default for v1.0 launch)
  --with-paradigm       Keep Paradigm Discoverer UI visible in package
  --full                Bundle all offline models (~68MB zip) (Default)
  --lite                Bundle starter models only (~161KB zip, downloads models on demand)
  -o, --output <path>   Specify custom output path (when building a single target)
  -h, --help            Show this help message
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run './package_extension.sh --help' for usage." >&2
      exit 1
      ;;
  esac
done

echo "=========================================================="
echo "📦 LangJack - Cross-Browser Extension Packager"
echo "=========================================================="

# 1. Validate manifest files and read version
if [ ! -f "manifest.json" ]; then
  echo "❌ Error: manifest.json not found in $SCRIPT_DIR" >&2
  exit 1
fi
if [ ! -f "manifest.firefox.json" ]; then
  echo "❌ Error: manifest.firefox.json not found in $SCRIPT_DIR" >&2
  exit 1
fi

VERSION=$(grep -m 1 '"version"' manifest.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
NAME=$(grep -m 1 '"name"' manifest.json | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')

echo "• Extension Name:     $NAME"
echo "• Version:            $VERSION"
echo "• Target Browser(s):  $TARGET"
echo "• Package Mode:       $PACKAGE_MODE"
if [ "$INCLUDE_PARADIGM" = true ]; then
  echo "• Paradigm Tool:      Included (Enabled)"
else
  echo "• Paradigm Tool:      Excluded / Hidden (v1.0 Store Release Mode)"
fi
echo ""

mkdir -p "dist"

# Suffixes for output filenames
PARADIGM_SUFFIX=""
if [ "$INCLUDE_PARADIGM" = true ]; then
  PARADIGM_SUFFIX="-with-paradigm"
fi
LITE_SUFFIX=""
if [ "$PACKAGE_MODE" = "lite" ]; then
  LITE_SUFFIX="-lite"
fi

# Array to store built package summaries
BUILT_PACKAGES=()

# Function to build a package for a specific browser target
build_package() {
  local BROWSER="$1" # "chrome" or "firefox"
  local EXT_FORMAT="$2" # "zip" or "xpi"
  local MANIFEST_SRC="$3" # source manifest path
  local OUT_PATH="$4"

  local BROWSER_UPPER
  BROWSER_UPPER=$(echo "$BROWSER" | tr 'a-z' 'A-Z')
  local EXT_FORMAT_UPPER
  EXT_FORMAT_UPPER=$(echo "$EXT_FORMAT" | tr 'a-z' 'A-Z')

  echo "----------------------------------------------------------"
  echo "⚙️ Building for $BROWSER_UPPER ($EXT_FORMAT_UPPER)..."
  echo "----------------------------------------------------------"

  local STAGE_DIR
  STAGE_DIR=$(mktemp -d "/tmp/langjack-build-${BROWSER}-XXXXXX")

  # 1. Copy core shared assets
  cp "$MANIFEST_SRC" "$STAGE_DIR/manifest.json"
  cp background.js "$STAGE_DIR/"
  cp popup.html "$STAGE_DIR/"
  cp index.html "$STAGE_DIR/"

  mkdir -p "$STAGE_DIR/css"
  cp css/styles.css "$STAGE_DIR/css/"

  mkdir -p "$STAGE_DIR/icons"
  cp icons/*.png "$STAGE_DIR/icons/"

  mkdir -p "$STAGE_DIR/js"
  cp -r js/* "$STAGE_DIR/js/"

  mkdir -p "$STAGE_DIR/models"
  if [ "$PACKAGE_MODE" = "full" ]; then
    cp models/*.hfstol "$STAGE_DIR/models/"
    cp models/*.tsv "$STAGE_DIR/models/"
  else
    cp models/bundled_*.hfstol "$STAGE_DIR/models/"
    cp models/*.tsv "$STAGE_DIR/models/"
  fi

  # 2. Gate Paradigm Discoverer button if excluding for v1.0
  if [ "$INCLUDE_PARADIGM" = false ]; then
    if command -v node >/dev/null 2>&1; then
      node -e "
        const fs = require('fs');
        const p = '${STAGE_DIR}/index.html';
        let h = fs.readFileSync(p, 'utf8');
        h = h.replace(
          /<button id=\"openParadigmDiscovererBtn\" class=\"[^\"]*\" style=\"[^\"]*\"/g,
          '<button id=\"openParadigmDiscovererBtn\" class=\"btn btn-secondary btn-sm\" style=\"display: none;\"'
        );
        fs.writeFileSync(p, h, 'utf8');
      "
    else
      sed -i.bak -E 's/id="openParadigmDiscovererBtn"([^>]*)style="[^"]*"/id="openParadigmDiscovererBtn"\1style="display: none;"/g' "$STAGE_DIR/index.html"
      rm -f "$STAGE_DIR/index.html.bak"
    fi
  fi

  # 3. Sanitize staging directory
  find "$STAGE_DIR" -name ".DS_Store" -delete
  find "$STAGE_DIR" -name "._*" -delete
  find "$STAGE_DIR" -name "*~" -delete
  find "$STAGE_DIR" -name "*.bak" -delete
  find "$STAGE_DIR" -name "*.tmp" -delete

  # 4. Create archive
  local OUT_ABS
  OUT_ABS="$(cd "$(dirname "$OUT_PATH")" && pwd)/$(basename "$OUT_PATH")"
  rm -f "$OUT_ABS"

  export COPYFILE_DISABLE=1
  export COPY_EXTENDED_ATTRIBUTES_DISABLE=true

  (
    cd "$STAGE_DIR"
    zip -q -9 -r -X "$OUT_ABS" . \
      -x "*.DS_Store" \
      -x "*__MACOSX*" \
      -x "*~" \
      -x "._*"
  )

  # 5. Verify archive
  if ! unzip -l "$OUT_ABS" | grep -q " manifest.json$"; then
    echo "❌ Verification Failed: manifest.json missing from root of $OUT_PATH" >&2
    rm -rf "$STAGE_DIR"
    exit 1
  fi

  local FILE_COUNT
  FILE_COUNT=$(unzip -l "$OUT_ABS" | tail -n 1 | awk '{print $2}')
  local FILE_SIZE
  FILE_SIZE=$(ls -lh "$OUT_ABS" | awk '{print $5}')
  local SHA256
  SHA256=$(shasum -a 256 "$OUT_ABS" | awk '{print $1}')

  echo "✓ Built $OUT_PATH ($FILE_SIZE, $FILE_COUNT files)"
  echo "  SHA-256: $SHA256"

  BUILT_PACKAGES+=("$BROWSER|$OUT_PATH|$FILE_SIZE|$SHA256")
  rm -rf "$STAGE_DIR"
}

# Function to build a Progressive Web App (PWA) package for Chrome on Android & Mobile Web
build_pwa_package() {
  local OUT_PATH="$1"

  echo "----------------------------------------------------------"
  echo "⚙️ Building for CHROME ON ANDROID (PWA ZIP)..."
  echo "----------------------------------------------------------"

  local STAGE_DIR
  STAGE_DIR=$(mktemp -d "/tmp/langjack-build-pwa-XXXXXX")

  # 1. Copy PWA core assets
  cp index.html "$STAGE_DIR/"
  cp manifest.webmanifest "$STAGE_DIR/"
  cp sw.js "$STAGE_DIR/"

  mkdir -p "$STAGE_DIR/css"
  cp css/styles.css "$STAGE_DIR/css/"

  mkdir -p "$STAGE_DIR/icons"
  cp icons/*.png "$STAGE_DIR/icons/"

  mkdir -p "$STAGE_DIR/js"
  cp -r js/* "$STAGE_DIR/js/"

  mkdir -p "$STAGE_DIR/models"
  if [ "$PACKAGE_MODE" = "full" ]; then
    cp models/*.hfstol "$STAGE_DIR/models/"
    cp models/*.tsv "$STAGE_DIR/models/"
  else
    cp models/bundled_*.hfstol "$STAGE_DIR/models/"
    cp models/*.tsv "$STAGE_DIR/models/"
  fi

  # 2. Gate Paradigm Discoverer button if excluding for v1.0
  if [ "$INCLUDE_PARADIGM" = false ]; then
    if command -v node >/dev/null 2>&1; then
      node -e "
        const fs = require('fs');
        const p = '${STAGE_DIR}/index.html';
        let h = fs.readFileSync(p, 'utf8');
        h = h.replace(
          /<button id=\"openParadigmDiscovererBtn\" class=\"[^\"]*\" style=\"[^\"]*\"/g,
          '<button id=\"openParadigmDiscovererBtn\" class=\"btn btn-secondary btn-sm\" style=\"display: none;\"'
        );
        fs.writeFileSync(p, h, 'utf8');
      "
    else
      sed -i.bak -E 's/id="openParadigmDiscovererBtn"([^>]*)style="[^"]*"/id="openParadigmDiscovererBtn"\1style="display: none;"/g' "$STAGE_DIR/index.html"
      rm -f "$STAGE_DIR/index.html.bak"
    fi
  fi

  # 3. Sanitize staging directory
  find "$STAGE_DIR" -name ".DS_Store" -delete
  find "$STAGE_DIR" -name "._*" -delete
  find "$STAGE_DIR" -name "*~" -delete
  find "$STAGE_DIR" -name "*.bak" -delete
  find "$STAGE_DIR" -name "*.tmp" -delete

  # 4. Create archive
  local OUT_ABS
  OUT_ABS="$(cd "$(dirname "$OUT_PATH")" && pwd)/$(basename "$OUT_PATH")"
  rm -f "$OUT_ABS"

  export COPYFILE_DISABLE=1
  export COPY_EXTENDED_ATTRIBUTES_DISABLE=true

  (
    cd "$STAGE_DIR"
    zip -q -9 -r -X "$OUT_ABS" . \
      -x "*.DS_Store" \
      -x "*__MACOSX*" \
      -x "*~" \
      -x "._*"
  )

  # 5. Verify archive
  if ! unzip -l "$OUT_ABS" | grep -q " manifest.webmanifest$"; then
    echo "❌ Verification Failed: manifest.webmanifest missing from root of $OUT_PATH" >&2
    rm -rf "$STAGE_DIR"
    exit 1
  fi

  local FILE_COUNT
  FILE_COUNT=$(unzip -l "$OUT_ABS" | tail -n 1 | awk '{print $2}')
  local FILE_SIZE
  FILE_SIZE=$(ls -lh "$OUT_ABS" | awk '{print $5}')
  local SHA256
  SHA256=$(shasum -a 256 "$OUT_ABS" | awk '{print $1}')

  echo "✓ Built $OUT_PATH ($FILE_SIZE, $FILE_COUNT files)"
  echo "  SHA-256: $SHA256"

  BUILT_PACKAGES+=("android-pwa|$OUT_PATH|$FILE_SIZE|$SHA256")
  rm -rf "$STAGE_DIR"
}

# Execute builds based on target
if [ "$TARGET" = "chrome" ] || [ "$TARGET" = "all" ]; then
  CHROME_OUT="${CUSTOM_OUTPUT:-dist/langjack-v${VERSION}-chrome${PARADIGM_SUFFIX}${LITE_SUFFIX}.zip}"
  build_package "chrome" "zip" "manifest.json" "$CHROME_OUT"

  # For standard releases, also keep dist/langjack-v1.0.0.zip as Chrome default
  if [ -z "$CUSTOM_OUTPUT" ]; then
    cp -f "$CHROME_OUT" "dist/langjack-v${VERSION}${PARADIGM_SUFFIX}${LITE_SUFFIX}.zip"
  fi
fi

if [ "$TARGET" = "firefox" ] || [ "$TARGET" = "all" ]; then
  FIREFOX_OUT="${CUSTOM_OUTPUT:-dist/langjack-v${VERSION}-firefox${PARADIGM_SUFFIX}${LITE_SUFFIX}.xpi}"
  build_package "firefox" "xpi" "manifest.firefox.json" "$FIREFOX_OUT"

  # Also produce a .zip copy for Firefox (AMO accepts both .xpi and .zip)
  if [ -z "$CUSTOM_OUTPUT" ]; then
    cp -f "$FIREFOX_OUT" "dist/langjack-v${VERSION}-firefox${PARADIGM_SUFFIX}${LITE_SUFFIX}.zip"
  fi
fi

if [ "$TARGET" = "android" ] || [ "$TARGET" = "all" ]; then
  ANDROID_OUT="${CUSTOM_OUTPUT:-dist/langjack-v${VERSION}-android-pwa${PARADIGM_SUFFIX}${LITE_SUFFIX}.zip}"
  build_pwa_package "$ANDROID_OUT"

  # Also keep alias
  if [ -z "$CUSTOM_OUTPUT" ]; then
    cp -f "$ANDROID_OUT" "dist/langjack-v${VERSION}-android${PARADIGM_SUFFIX}${LITE_SUFFIX}.zip"
  fi
fi

echo ""
echo "=========================================================="
echo "🎉 ALL BUILDS COMPLETED SUCCESSFULLY!"
echo "=========================================================="
echo ""
echo "📦 Generated Packages:"
for entry in "${BUILT_PACKAGES[@]}"; do
  IFS='|' read -r b_name b_path b_size b_sha <<< "$entry"
  b_upper=$(echo "$b_name" | tr 'a-z' 'A-Z')
  printf "  • %-12s %-45s (%s)\n    SHA-256: %s\n" "[$b_upper]" "$b_path" "$b_size" "$b_sha"
done

echo ""
echo "📋 Installation & Store Submission Instructions:"
echo "  • Google Chrome Web Store:"
echo "      Dashboard: https://chrome.google.com/webstore/devconsole"
echo "      Upload:    dist/langjack-v${VERSION}-chrome${PARADIGM_SUFFIX}${LITE_SUFFIX}.zip"
echo ""
echo "  • Mozilla Firefox Add-ons (AMO):"
echo "      Dashboard: https://addons.mozilla.org/developers/addon/submit/upload-listed"
echo "      Upload:    dist/langjack-v${VERSION}-firefox${PARADIGM_SUFFIX}${LITE_SUFFIX}.xpi"
echo "      Local test: In Firefox, open about:debugging -> 'This Firefox' -> 'Load Temporary Add-on...'"
echo ""
echo "  • Chrome on Android (Progressive Web App):"
echo "      Deploy:    Extract dist/langjack-v${VERSION}-android-pwa${PARADIGM_SUFFIX}${LITE_SUFFIX}.zip to web host (or GitHub Pages)"
echo "      Install:   Open in Chrome on Android -> Tap ⋮ (menu) -> 'Install app' / 'Add to Home screen'"
echo ""
echo "  • Chromium on Android (Kiwi Browser, Lemur, Yandex):"
echo "      Install:   Open browser extensions page -> Load dist/langjack-v${VERSION}-chrome.zip"
echo "=========================================================="
