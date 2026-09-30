#!/usr/bin/env bash
set -euo pipefail

# ExecRelay Icon Asset Pipeline
# Generates all required desktop icon variants from the canonical master PNG.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MASTER_SOURCE="${1:-"$REPO_ROOT/icon.png"}"
OUTPUT_DIR="$REPO_ROOT/native/icons"

if [ ! -f "$MASTER_SOURCE" ]; then
  echo "Error: Master icon not found at: $MASTER_SOURCE" >&2
  exit 1
fi

echo "ExecRelay Icon Pipeline: Processing master icon: $MASTER_SOURCE"

mkdir -p "$OUTPUT_DIR"

# 1. Try cargo tauri icon if available
if command -v cargo &>/dev/null && cargo tauri icon --help &>/dev/null; then
  echo "Using cargo-tauri icon generation tool..."
  (cd "$REPO_ROOT/native" && cargo tauri icon "$MASTER_SOURCE")
  echo "✓ Tauri icon assets generated successfully."
  exit 0
fi

# 2. Native macOS fallback via sips and node icns packaging
echo "Generating macOS / desktop icon assets via sips and node..."

# 32x32.png
sips -z 32 32 "$MASTER_SOURCE" --out "$OUTPUT_DIR/32x32.png" >/dev/null

# 128x128.png
sips -z 128 128 "$MASTER_SOURCE" --out "$OUTPUT_DIR/128x128.png" >/dev/null

# 128x128@2x.png (256x256)
sips -z 256 256 "$MASTER_SOURCE" --out "$OUTPUT_DIR/128x128@2x.png" >/dev/null

# icon.png (512x512)
sips -z 512 512 "$MASTER_SOURCE" --out "$OUTPUT_DIR/icon.png" >/dev/null

# icon.ico (Windows icon)
sips -s format ico "$OUTPUT_DIR/32x32.png" --out "$OUTPUT_DIR/icon.ico" >/dev/null

# icon.icns (macOS multi-resolution icon)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
node -e '
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const masterPath = process.argv[1];
const outIcnsPath = process.argv[2];
const tmpDir = "/tmp/icns_build";
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const sizes = [
  { type: "ic07", size: 128 },
  { type: "ic08", size: 256 },
  { type: "ic09", size: 512 },
  { type: "ic10", size: 1024 }
];

const chunks = [];
for (const s of sizes) {
  const pngPath = path.join(tmpDir, `${s.size}.png`);
  execSync(`sips -z ${s.size} ${s.size} "${masterPath}" --out "${pngPath}" >/dev/null`);
  const pngBuf = fs.readFileSync(pngPath);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write(s.type, 0, 4, "ascii");
  chunkHeader.writeUInt32BE(pngBuf.length + 8, 4);
  chunks.push(chunkHeader);
  chunks.push(pngBuf);
}

const totalBody = Buffer.concat(chunks);
const fileHeader = Buffer.alloc(8);
fileHeader.write("icns", 0, 4, "ascii");
fileHeader.writeUInt32BE(totalBody.length + 8, 4);

const icnsBuf = Buffer.concat([fileHeader, totalBody]);
fs.writeFileSync(outIcnsPath, icnsBuf);
' "$MASTER_SOURCE" "$OUTPUT_DIR/icon.icns"

echo "✓ All icon assets generated at $OUTPUT_DIR:"
ls -la "$OUTPUT_DIR"
