@echo off
title Spy Sec Music - High-Speed Audio Tunnel
echo ================================================================
echo    SPY SEC MUSIC - HIGH SPEED PUBLIC TUNNEL (LOW LATENCY)
echo ================================================================
echo.
echo [Option 1 - FASTEST FOR MOBILE ON WI-FI (0 ms Latency)]:
echo   Open in your phone's browser directly:
echo   http://10.166.244.87:3050
echo.
echo [Option 2 - WORLDWIDE PUBLIC HTTPS (Zero Interstitials, Full Audio)]:
echo   Starting built-in Windows SSH High-Speed Tunnel...
echo   (No bot screens, no audio blocking, low latency)
echo ================================================================
echo.
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3050 nokey@localhost.run
pause
