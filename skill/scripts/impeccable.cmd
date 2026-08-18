@echo off
setlocal
rem Impeccable launcher (Windows). Runs bin\windows-x64\impeccable.exe next to this file.
if defined IMPECCABLE_BIN if exist "%IMPECCABLE_BIN%" (
  "%IMPECCABLE_BIN%" %*
  exit /b %ERRORLEVEL%
)
if not defined IMPECCABLE_SKILL_DIR set "IMPECCABLE_SKILL_DIR=%~dp0.."
if not defined IMPECCABLE_SELF set "IMPECCABLE_SELF=%~f0"
set "arch=x64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "arch=arm64"
set "bin=%~dp0bin\windows-%arch%\impeccable.exe"
if exist "%bin%" (
  "%bin%" %*
  exit /b %ERRORLEVEL%
)
if exist "%USERPROFILE%\.impeccable\bin\impeccable.exe" (
  "%USERPROFILE%\.impeccable\bin\impeccable.exe" %*
  exit /b %ERRORLEVEL%
)
set "version="
if exist "%~dp0VERSION" set /p version=<"%~dp0VERSION"
if not defined IMPECCABLE_HOME set "IMPECCABLE_HOME=%USERPROFILE%\.impeccable"
set "cached=%IMPECCABLE_HOME%\bin\%version%\impeccable.exe"
if defined version if exist "%cached%" (
  "%cached%" %*
  exit /b %ERRORLEVEL%
)
where impeccable >nul 2>nul && (
  impeccable %*
  exit /b %ERRORLEVEL%
)
if defined version (
  if not defined IMPECCABLE_DOWNLOAD_BASE set "IMPECCABLE_DOWNLOAD_BASE=https://github.com/renaissance-geek-inc/impeccable-dist/releases/download"
  set "url=%IMPECCABLE_DOWNLOAD_BASE%/v%version%/impeccable-windows-%arch%.exe"
  if not exist "%IMPECCABLE_HOME%\bin\%version%" mkdir "%IMPECCABLE_HOME%\bin\%version%" >nul 2>nul
  where curl.exe >nul 2>nul && curl.exe -fsSL -o "%cached%.part" "%url%" >nul 2>nul && move /y "%cached%.part" "%cached%" >nul 2>nul
  if exist "%cached%" (
    "%cached%" %*
    exit /b %ERRORLEVEL%
  )
)
echo impeccable: no binary found (looked in %bin%, %cached%, PATH). Install one: npm i -g impeccable 1>&2
exit /b 127
