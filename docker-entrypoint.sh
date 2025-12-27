#!/bin/bash
set -e

# Start Xvfb (virtual display) in background
echo "🖥️ Starting Xvfb virtual display..."
Xvfb :99 -screen 0 1280x1024x24 -ac &
sleep 2

# Start PulseAudio in background (for audio)
echo "🔊 Starting PulseAudio..."
pulseaudio --start --exit-idle-time=-1 2>/dev/null || true

echo "✅ Virtual display ready (DISPLAY=:99)"

# Execute the command passed to docker run
exec "$@"
