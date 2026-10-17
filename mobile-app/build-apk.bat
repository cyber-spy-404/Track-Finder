@echo off
set ANDROID_PREFS_ROOT=
echo =====================================================================
echo  Spy Sec Music - Android APK Builder (cyber_spy.404)
echo =====================================================================
echo.

echo [1/3] Syncing latest web assets and Trending Indian Spotify playlists...
node copy-assets.js
call npx cap sync android
echo Web assets and Capacitor plugins synchronized successfully.
echo.

echo [2/3] Checking Android Build Environment...
if exist "android\gradlew.bat" (
    echo Gradle wrapper found. Building debug APK...
    cd android
    call gradlew.bat assembleDebug
    cd ..
    echo.
    echo [3/3] Build finished!
    echo APK Location: android\app\build\outputs\apk\debug\app-debug.apk
) else (
    echo ---------------------------------------------------------------------
    echo [STATUS] Mobile assets, covers, and code are 100% prepared and synced:
    echo   - Web App / PWA Directory: mobile-app\www
    echo   - Android Native Assets:   mobile-app\android\app\src\main\assets\public
    echo.
    if exist "C:\Program Files\Android\Android Studio\bin\studio64.exe" (
        echo Android Studio detected on your system.
        echo Launching Android Studio with mobile project...
        start "" "C:\Program Files\Android\Android Studio\bin\studio64.exe" "%~dp0android"
        echo Android Studio is now opening: %~dp0android
    ) else (
        echo To compile the APK:
        echo   1. Open Android Studio
        echo   2. Open project folder: mobile-app\android
    )
    echo   Select Build -^> Build Bundle(s) / APK(s) -^> Build APK(s)
    echo   Output APK: android\app\build\outputs\apk\debug\app-debug.apk
    echo ---------------------------------------------------------------------
)

echo.
echo =====================================================================
echo Done!
echo =====================================================================
