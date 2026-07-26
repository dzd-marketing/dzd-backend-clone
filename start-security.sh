#!/bin/bash
# Start security monitor in background
cd "$(dirname "$0")"
nohup node security-monitor.js > security-monitor.log 2>&1 &
echo $! > security-monitor.pid
echo "Security monitor started with PID: $(cat security-monitor.pid)"
