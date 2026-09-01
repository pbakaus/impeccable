@echo off
setlocal
rem Impeccable launcher (Windows). Runs bin\windows-<arch>\impeccable.exe next
rem to this file, else a cached or freshly downloaded engine binary.
rem
rem Structure notes (this file is exercised by dry parsing and string-level
rem tests, not yet on a real Windows machine):
rem - No multi-line parenthesized blocks: cmd expands %var% at block parse
rem   time, which made the old download path read back empty %url%/%cached%.
rem   Linear goto flow keeps every expansion on its own line, and avoids
rem   delayed expansion eating ! characters in user arguments.
rem - The unversioned user binary and the PATH candidate are validated with
rem   the engine-probe handshake (see :probe) so the retired 3.x npm CLI,
rem   whose bin is also named impeccable, is never exec'd. IMPECCABLE_BIN,
rem   the sibling binary, and the version-pinned cache stay trusted.
rem - Downloads are verified against the .sha256 sidecar via certutil and
rem   fail closed: a missing sidecar or hash tool refuses the download. On
rem   ARM64 the arm64 asset is tried first and the x64 asset is the
rem   fallback (Windows on ARM runs x64 binaries).
if not defined IMPECCABLE_SKILL_DIR set "IMPECCABLE_SKILL_DIR=%~dp0.."
if not defined IMPECCABLE_SELF set "IMPECCABLE_SELF=%~f0"
set "arch=x64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "arch=arm64"

if not defined IMPECCABLE_BIN goto no_env_bin
if not exist "%IMPECCABLE_BIN%" goto no_env_bin
set "run=%IMPECCABLE_BIN%"
goto run
:no_env_bin

set "bin=%~dp0bin\windows-%arch%\impeccable.exe"
if not exist "%bin%" goto no_sibling
set "run=%bin%"
goto run
:no_sibling

set "home_bin=%USERPROFILE%\.impeccable\bin\impeccable.exe"
if not exist "%home_bin%" goto no_home_bin
if defined IMPECCABLE_LAUNCHER_PROBE goto no_home_bin
call :probe "%home_bin%"
if not "%probe_ok%"=="1" goto no_home_bin
set "run=%home_bin%"
goto run
:no_home_bin

set "version="
if exist "%~dp0VERSION" set /p version=<"%~dp0VERSION"
if not defined IMPECCABLE_HOME set "IMPECCABLE_HOME=%USERPROFILE%\.impeccable"
set "cached=%IMPECCABLE_HOME%\bin\%version%\impeccable.exe"
if not defined version goto no_cache
if not exist "%cached%" goto no_cache
set "run=%cached%"
goto run
:no_cache

if defined IMPECCABLE_LAUNCHER_PROBE goto download
where impeccable >nul 2>nul
if errorlevel 1 goto download
call :probe impeccable
if not "%probe_ok%"=="1" goto download
impeccable %*
exit /b

:download
rem Last resort: fetch this version's binary from the release channel into
rem the version-pinned user cache, verify it, then run it. Never inside
rem another launcher's probe: fail fast and quiet instead.
if defined IMPECCABLE_LAUNCHER_PROBE exit /b 127
if not defined version goto fail
where curl.exe >nul 2>nul
if errorlevel 1 goto fail
if not defined IMPECCABLE_DOWNLOAD_BASE set "IMPECCABLE_DOWNLOAD_BASE=https://github.com/pbakaus/impeccable/releases/download"
if not exist "%IMPECCABLE_HOME%\bin\%version%" mkdir "%IMPECCABLE_HOME%\bin\%version%" >nul 2>nul
set "asset=impeccable-windows-%arch%.exe"
set "url=%IMPECCABLE_DOWNLOAD_BASE%/engine-v%version%/%asset%"
curl.exe -fsSL -o "%cached%.part" "%url%" >nul 2>nul
if not errorlevel 1 goto verify
if not "%arch%"=="arm64" goto fail
set "asset=impeccable-windows-x64.exe"
set "url=%IMPECCABLE_DOWNLOAD_BASE%/engine-v%version%/%asset%"
curl.exe -fsSL -o "%cached%.part" "%url%" >nul 2>nul
if errorlevel 1 goto fail

:verify
rem Mirrors the sh launcher and fails closed: a freshly downloaded binary
rem runs only after verifying against its .sha256 sidecar. A sidecar that
rem cannot be fetched, or an empty certutil result, refuses the download
rem instead of running an unverified binary.
curl.exe -fsSL -o "%cached%.sha256" "%url%.sha256" >nul 2>nul
if errorlevel 1 goto verify_refuse
set "expected="
set /p expected=<"%cached%.sha256"
for /f "tokens=1" %%h in ("%expected%") do set "expected=%%h"
set "actual="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%cached%.part" SHA256 2^>nul') do if not defined actual set "actual=%%h"
del "%cached%.sha256" >nul 2>nul
if not defined expected goto verify_refuse
if not defined actual goto verify_refuse
set "actual=%actual: =%"
if /I "%actual%"=="%expected%" goto place
del "%cached%.part" >nul 2>nul
echo impeccable: checksum mismatch downloading %url% 1>&2
exit /b 127

:verify_refuse
del "%cached%.part" >nul 2>nul
del "%cached%.sha256" >nul 2>nul
echo impeccable: cannot verify %url% against %url%.sha256; refusing the unverified download 1>&2
exit /b 127

:place
move /y "%cached%.part" "%cached%" >nul 2>nul
if not exist "%cached%" goto fail
set "run=%cached%"
goto run

:run
"%run%" %*
exit /b

:probe
rem Sets probe_ok=1 when %1 answers the engine handshake: prints
rem "impeccable-engine <version>" and exits 0. The 3.x npm CLI answers any
rem unknown verb with "Unknown command", exit 1, so it never passes.
set "probe_ok="
set "probe_tmp=%TEMP%\impeccable-probe-%RANDOM%%RANDOM%.txt"
set "IMPECCABLE_LAUNCHER_PROBE=1"
"%~1" engine-probe >"%probe_tmp%" 2>nul
set "probe_err=%ERRORLEVEL%"
set "IMPECCABLE_LAUNCHER_PROBE="
if not "%probe_err%"=="0" goto probe_done
findstr /b /c:"impeccable-engine" "%probe_tmp%" >nul 2>nul
if not errorlevel 1 set "probe_ok=1"
:probe_done
del "%probe_tmp%" >nul 2>nul
exit /b 0

:fail
del "%cached%.part" >nul 2>nul
echo impeccable: no engine binary found (looked in %bin%, %cached%, PATH). 1>&2
echo Download impeccable-windows-%arch%.exe from https://github.com/pbakaus/impeccable/releases (tag engine-v%version%) and save it as %cached%, or set IMPECCABLE_BIN to a preinstalled engine binary. Docs: https://impeccable.style 1>&2
exit /b 127
