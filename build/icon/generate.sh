#!/usr/bin/env bash
# Regenerate the platform icon assets from icon.svg:
#   icon.icns  — macOS app bundle (Velopack --icon)
#   icon.ico   — Windows installer/exe (Velopack --icon) and the Photino window icon
#   icon.png   — 512px, the Photino window icon on macOS/Linux
#
# Requires: Google Chrome (headless SVG render), iconutil + sips (macOS), python3.
# Run after editing icon.svg, then commit the regenerated binaries.
set -euo pipefail
cd "$(dirname "$0")"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# 1. Render a 1024px master PNG with transparent corners.
"$CHROME" --headless --disable-gpu --force-device-scale-factor=1 --hide-scrollbars \
  --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot="$TMP/m1024.png" "file://$PWD/icon.svg" >/dev/null 2>&1

png() { sips -z "$1" "$1" "$TMP/m1024.png" --out "$TMP/i$1.png" >/dev/null; }
for s in 16 32 48 64 128 256 512 1024; do png "$s"; done

# 2. macOS .icns via iconutil.
SET="$TMP/icon.iconset"; mkdir -p "$SET"
cp "$TMP/i16.png"   "$SET/icon_16x16.png"
cp "$TMP/i32.png"   "$SET/icon_16x16@2x.png"
cp "$TMP/i32.png"   "$SET/icon_32x32.png"
cp "$TMP/i64.png"   "$SET/icon_32x32@2x.png"
cp "$TMP/i128.png"  "$SET/icon_128x128.png"
cp "$TMP/i256.png"  "$SET/icon_128x128@2x.png"
cp "$TMP/i256.png"  "$SET/icon_256x256.png"
cp "$TMP/i512.png"  "$SET/icon_256x256@2x.png"
cp "$TMP/i512.png"  "$SET/icon_512x512.png"
cp "$TMP/i1024.png" "$SET/icon_512x512@2x.png"
iconutil -c icns "$SET" -o icon.icns

# 3. Windows .ico (PNG-compressed entries; Vista+). Pure-python, no deps.
python3 - "$TMP" <<'PY'
import struct, sys, os
tmp = sys.argv[1]
sizes = [16, 32, 48, 64, 128, 256]
imgs = [(s, open(os.path.join(tmp, f"i{s}.png"), "rb").read()) for s in sizes]
out = bytearray(struct.pack("<HHH", 0, 1, len(imgs)))   # ICONDIR
offset = 6 + 16 * len(imgs)
for s, data in imgs:
    b = s if s < 256 else 0
    out += struct.pack("<BBBBHHII", b, b, 0, 0, 1, 32, len(data), offset)  # ICONDIRENTRY
    offset += len(data)
for _, data in imgs:
    out += data
open("icon.ico", "wb").write(out)
print("icon.ico:", len(out), "bytes")
PY

# 4. Runtime window icon for macOS/Linux.
cp "$TMP/i512.png" icon.png

echo "generated: icon.icns icon.ico icon.png"
