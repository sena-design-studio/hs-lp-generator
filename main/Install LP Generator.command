#!/bin/bash
# Double-click this file in Finder to install the LP Generator.
# If macOS asks for permission, click Open.

cd "$(dirname "$0")"
chmod +x install.sh

osascript - <<EOF
tell application "Terminal"
    activate
    do script "cd '$(dirname "$0")' && bash install.sh; exit"
end tell
EOF
