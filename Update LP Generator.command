#!/bin/bash
# Double-click this file in Finder to update the LP Generator.
cd "$(dirname "$0")"
chmod +x update.sh
osascript - <<EOF
tell application "Terminal"
    activate
    do script "cd '$(dirname "$0")' && bash update.sh; exit"
end tell
EOF
