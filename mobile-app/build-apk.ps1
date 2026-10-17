$env:ANDROID_PREFS_ROOT = $null
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host " Spy Sec Music - Android APK Builder (cyber_spy.404)" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Syncing latest web assets and Trending Indian Spotify playlists..." -ForegroundColor Yellow
node copy-assets.js
npx cap sync android
Write-Host "Web assets and Capacitor plugins synchronized successfully." -ForegroundColor Green
Write-Host ""

Write-Host "[2/3] Checking Android Build Environment..." -ForegroundColor Yellow
if (Test-Path "android\gradlew.bat") {
    Write-Host "Gradle wrapper found. Building debug APK..." -ForegroundColor Cyan
    Push-Location "android"
    & .\gradlew.bat assembleDebug
    Pop-Location
    Write-Host ""
    Write-Host "[3/3] Build finished!" -ForegroundColor Green
    Write-Host "APK Location: android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Green
} else {
    Write-Host "---------------------------------------------------------------------" -ForegroundColor Gray
    Write-Host "[STATUS] Mobile assets, covers, and code are 100% prepared and synced:" -ForegroundColor Green
    Write-Host "  - Web App / PWA Directory: mobile-app\www" -ForegroundColor White
    Write-Host "  - Android Native Assets:   mobile-app\android\app\src\main\assets\public" -ForegroundColor White
    Write-Host ""
    $studioPath = "C:\Program Files\Android\Android Studio\bin\studio64.exe"
    $androidDir = (Resolve-Path "android").Path
    if (Test-Path $studioPath) {
        Write-Host "Android Studio detected on your system." -ForegroundColor Cyan
        Write-Host "Launching Android Studio with mobile project..." -ForegroundColor Cyan
        Start-Process $studioPath -ArgumentList $androidDir
        Write-Host "Android Studio is now opening: $androidDir" -ForegroundColor Green
    } else {
        Write-Host "To compile the APK:" -ForegroundColor Yellow
        Write-Host "  1. Open Android Studio" -ForegroundColor White
        Write-Host "  2. Open project folder: $androidDir" -ForegroundColor White
    }
    Write-Host "  3. Select Build -> Build Bundle(s) / APK(s) -> Build APK(s)" -ForegroundColor White
    Write-Host "  Output APK: android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Green
    Write-Host "---------------------------------------------------------------------" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "Done!" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan
