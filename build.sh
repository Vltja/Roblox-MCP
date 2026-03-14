#!/bin/bash
# Build-Skript für RobloxMCP Plugin

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$SCRIPT_DIR/neue-plugin-architektur"
OUTPUT_FILE="$PLUGIN_DIR/RobloxMCP.rbxmx"

echo "=========================================="
echo "  🔨 RobloxMCP Plugin Builder"
echo "=========================================="
echo ""
echo "📁 Plugin-Ordner: $PLUGIN_DIR"
echo "📄 Output-Datei: $OUTPUT_FILE"
echo ""

# Prüfe ob Python vorhanden ist
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 nicht gefunden!"
    exit 1
fi

# Führe Konvertierung durch
cd "$PLUGIN_DIR"
python3 convert_to_rbxmx.py "$PLUGIN_DIR" "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Build erfolgreich!"
    echo ""
    echo "📋 Kopiere die Datei nach Roblox Studio:"
    echo "   $OUTPUT_FILE"
    echo ""
    echo "Oder nutze das Plugin direkt in Roblox Studio:"
    echo "   Plugins → Open Plugins Folder → Kopiere RobloxMCP.rbxmx"
else
    echo ""
    echo "❌ Build fehlgeschlagen!"
    exit 1
fi
