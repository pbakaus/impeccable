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
rem   whose bin is also named impeccable, is never exec'd. The sibling binary
rem   must also report the version in VERSION: it is not tracked, so a skill
rem   upgrade can leave an old engine in place. IMPECCABLE_BIN stays trusted.
rem - Downloads and the version-pinned cache are verified via certutil
rem   against engine-checksums.txt next to this file, and fail closed; a
rem   .verified stamp lets later runs skip hashing the cache while it holds
rem   the manifest digest and the binary's size and is not older than the
rem   binary. On ARM64 the arm64 asset is tried first and the x64 asset is the
rem   fallback (Windows on ARM runs x64 binaries), each only when the manifest
rem   has a line for it.
if not defined IMPECCABLE_SKILL_DIR set "IMPECCABLE_SKILL_DIR=%~dp0.."
if not defined IMPECCABLE_SELF set "IMPECCABLE_SELF=%~f0"
set "arch=x64"
if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "arch=arm64"

if not defined IMPECCABLE_BIN goto no_env_bin
if not exist "%IMPECCABLE_BIN%" goto no_env_bin
set "run=%IMPECCABLE_BIN%"
goto run
:no_env_bin

set "version="
if exist "%~dp0VERSION" set /p version=<"%~dp0VERSION"
set "bin=%~dp0bin\windows-%arch%\impeccable.exe"
if not exist "%bin%" goto no_sibling
if defined IMPECCABLE_LAUNCHER_PROBE goto sibling_ok
if not defined version goto sibling_ok
call :probe "%bin%"
if "%probe_version%"=="%version%" goto sibling_ok
if not defined probe_version set "probe_version=unknown"
echo impeccable: skipping "%bin%": it reports engine %probe_version% but this skill pins %version%; delete it to stop this warning 1>&2
goto no_sibling
:sibling_ok
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

if not defined IMPECCABLE_HOME set "IMPECCABLE_HOME=%USERPROFILE%\.impeccable"
set "cached=%IMPECCABLE_HOME%\bin\%version%\impeccable.exe"
set "asset=impeccable-windows-%arch%.exe"
set "manifest=%~dp0engine-checksums.txt"
if not defined version goto no_cache
if not exist "%cached%" goto no_cache
call :read_expected
for %%f in ("%cached%") do set "size=%%~zf"
set "stamp="
if exist "%cached%.verified" for /f "usebackq tokens=1,2" %%s in ("%cached%.verified") do set "stamp=%%s"& set "stamp_size=%%t"
if not defined stamp goto cache_hash
if not "%stamp_size%"=="%size%" goto cache_hash
if /I "%stamp%"=="%expected%" goto cache_stamp_matches
if /I "%stamp%"=="%expected_x64%" goto cache_stamp_matches
goto cache_hash
:cache_stamp_matches
rem Newest first: the stamp must be listed before the binary it vouches for.
set "newest="
for /f "delims=" %%f in ('dir /b /a:-d /o:-d "%cached%*" 2^>nul') do if not defined newest set "newest=%%f"
if /I "%newest%"=="impeccable.exe.verified" goto cache_trusted
:cache_hash
call :sha256 "%cached%" "%TEMP%\impeccable-hash-%RANDOM%%RANDOM%.txt"
if not defined actual goto cache_unverified
if /I "%actual%"=="%expected%" goto cache_verified
if /I "%actual%"=="%expected_x64%" goto cache_verified
:cache_unverified
echo impeccable: cannot verify the cached engine "%cached%" against "%manifest%"; not using it 1>&2
goto no_cache
:cache_verified
(>"%cached%.verified" echo %actual% %size%) 2>nul
:cache_trusted
set "run=%cached%"
goto run
:no_cache

if defined IMPECCABLE_LAUNCHER_PROBE goto download
where impeccable >nul 2>nul
if errorlevel 1 goto download
call :probe impeccable
if not "%probe_ok%"=="1" goto download
impeccable %*
exit /b %errorlevel%

:download
rem Last resort: fetch this version's binary from the release channel into
rem the version-pinned user cache, verify it, then run it. Never inside
rem another launcher's probe: fail fast and quiet instead.
if defined IMPECCABLE_LAUNCHER_PROBE exit /b 127
if not defined version goto fail
call :read_expected
if not defined expected if not defined expected_x64 goto no_checksum
where curl.exe >nul 2>nul
if errorlevel 1 goto curl_missing
if not defined IMPECCABLE_DOWNLOAD_BASE set "IMPECCABLE_DOWNLOAD_BASE=https://github.com/pbakaus/impeccable/releases/download"
if exist "%IMPECCABLE_HOME%\bin\%version%\" goto cache_ready
mkdir "%IMPECCABLE_HOME%\bin\%version%" >nul 2>nul
if errorlevel 1 goto cache_directory_failed
:cache_ready
rem Stage the download in a directory only this run owns, as the sh launcher
rem does with .impeccable.part.$$: concurrent first runs (parallel hooks, two
rem agents) must never write, hash or move each other's files. mkdir fails
rem when the name exists, so it claims the name atomically. RANDOM alone is
rem not enough because cmd seeds it from the clock in whole seconds; the
rem timestamp and the retry on collision keep same-second runs apart. A cache
rem directory that refuses every mkdir is reported as unwritable.
set "attempt=0"
:claim_staging
set /a attempt+=1
if %attempt% GTR 20 goto cache_write_failed
set "stamp=%TIME: =0%"
set "stamp=%stamp::=%"
set "stamp=%stamp:.=%"
set "stamp=%stamp:,=%"
set "staging=%IMPECCABLE_HOME%\bin\%version%\.impeccable.part.%stamp%-%RANDOM%%RANDOM%"
mkdir "%staging%" >nul 2>nul
if errorlevel 1 goto claim_staging
set "part=%staging%\impeccable.exe"
rem Redirection failures do not reliably update ERRORLEVEL in cmd.exe;
rem branch on the command's failure directly.
(type nul >"%part%") 2>nul || goto staging_write_failed
set "url=%IMPECCABLE_DOWNLOAD_BASE%/engine-v%version%/%asset%"
if not defined expected goto fetch_x64
curl.exe -fsSL -o "%part%" "%url%" >nul 2>nul
if not errorlevel 1 goto verify
:fetch_x64
if not defined expected_x64 goto download_failed
set "asset=impeccable-windows-x64.exe"
set "expected=%expected_x64%"
set "url=%IMPECCABLE_DOWNLOAD_BASE%/engine-v%version%/%asset%"
curl.exe -fsSL -o "%part%" "%url%" >nul 2>nul
if errorlevel 1 goto download_failed

:verify
call :check_download
if errorlevel 1 exit /b 127
rem Mirrors the sh launcher and fails closed: a freshly downloaded binary
rem runs only after its hash matches the digest read from engine-checksums.txt.
rem An empty certutil result refuses the download instead of running an
rem unverified binary.
call :sha256 "%part%" "%staging%\hash.txt"
call :check_download
if errorlevel 1 exit /b 127
if not defined actual goto verify_refuse
if /I "%actual%"=="%expected%" goto place
call :discard_staging
echo impeccable: checksum mismatch downloading %url% 1>&2
exit /b 127

:verify_refuse
call :check_download
if errorlevel 1 exit /b 127
call :discard_staging
echo impeccable: cannot verify %url% (certutil could not hash it); refusing the unverified download 1>&2
exit /b 127

:read_expected
rem Sets expected (and, on ARM64, expected_x64: Windows on ARM runs x64
rem binaries) from engine-checksums.txt.
call :manifest_digest "%asset%" expected
set "expected_x64="
if "%arch%"=="arm64" call :manifest_digest impeccable-windows-x64.exe expected_x64
exit /b 0

:manifest_digest
rem Sets the variable named %2 to the digest the first engine-checksums.txt
rem line for this version and asset %1 records, empty when there is none.
set "%~2="
if not exist "%manifest%" exit /b 0
for /f "usebackq tokens=1-3" %%a in ("%manifest%") do if "%%a"=="%version%" if /I "%%b"=="%~1" if not defined %~2 set "%~2=%%c"
exit /b 0

:sha256
rem Sets actual to the sha256 of %~1, empty when certutil fails. %~2 is the
rem scratch file for its output. Check certutil's status before parsing: its
rem error text on stdout is not a digest.
set "actual="
certutil -hashfile "%~1" SHA256 >"%~2" 2>nul
if errorlevel 1 goto sha256_done
for /f "usebackq skip=1 delims=" %%h in ("%~2") do if not defined actual set "actual=%%h"
if not defined actual goto sha256_done
set "actual=%actual: =%"
:sha256_done
del "%~2" >nul 2>nul
exit /b 0

:check_download
set "download_file=%~1"
if not defined download_file set "download_file=%part%"
if not exist "%download_file%" goto download_missing
for %%f in ("%download_file%") do if %%~zf==0 goto download_empty
exit /b 0

:download_missing
call :discard_staging
echo impeccable: download completed but the file was removed before execution: %url%; check your antivirus quarantine or logs. Refusing to continue; do not disable protection. 1>&2
exit /b 127

:download_empty
del "%download_file%" >nul 2>nul
call :discard_staging
echo impeccable: downloaded file is empty: %url%; refusing the unverified download 1>&2
exit /b 127

:discard_staging
rem Removes this run's staging directory and whatever is left in it. Never
rem touches another run's staging directory or the cached binary.
if defined staging rd /s /q "%staging%" >nul 2>nul
exit /b 0

:place
call :check_download
if errorlevel 1 exit /b 127
move /y "%part%" "%cached%" >nul 2>nul
if errorlevel 1 goto place_failed
call :discard_staging
call :check_download "%cached%"
if errorlevel 1 exit /b 127
for %%f in ("%cached%") do set "size=%%~zf"
(>"%cached%.verified" echo %actual% %size%) 2>nul
set "run=%cached%"
goto run

:place_failed
call :check_download
if errorlevel 1 exit /b 127
call :discard_staging
echo impeccable: could not cache the verified download: %url% 1>&2
exit /b 127

:run
"%run%" %*
exit /b %errorlevel%

:probe
rem Sets probe_ok=1 when %1 answers the engine handshake: prints
rem "impeccable-engine <version>" and exits 0, and probe_version to that
rem version. The 3.x npm CLI answers any unknown verb with "Unknown command",
rem exit 1, so it never passes.
set "probe_ok="
set "probe_version="
set "probe_tmp=%TEMP%\impeccable-probe-%RANDOM%%RANDOM%.txt"
set "IMPECCABLE_LAUNCHER_PROBE=1"
"%~1" engine-probe >"%probe_tmp%" 2>nul
set "probe_err=%ERRORLEVEL%"
set "IMPECCABLE_LAUNCHER_PROBE="
if not "%probe_err%"=="0" goto probe_done
findstr /b /c:"impeccable-engine" "%probe_tmp%" >nul 2>nul
if errorlevel 1 goto probe_done
set "probe_ok=1"
for /f "usebackq tokens=2" %%v in ("%probe_tmp%") do if not defined probe_version set "probe_version=%%v"
:probe_done
del "%probe_tmp%" >nul 2>nul
exit /b 0

:no_checksum
echo impeccable: no checksum for engine %version% (%asset%) in "%manifest%"; refusing the unverified download 1>&2
exit /b 127

:cache_directory_failed
echo impeccable: engine %version% is not installed; cannot create cache directory: "%IMPECCABLE_HOME%\bin\%version%" 1>&2
goto setup_failed

:staging_write_failed
call :discard_staging

:cache_write_failed
echo impeccable: engine %version% is not installed; cannot write to cache directory: "%IMPECCABLE_HOME%\bin\%version%" 1>&2
goto setup_failed

:curl_missing
echo impeccable: cannot download engine %version%; curl.exe is unavailable. 1>&2
goto setup_failed

:download_failed
call :discard_staging
echo impeccable: could not download engine %version% from %url%; check network access and the release URL. 1>&2

:setup_failed
echo Engine %version% setup needs network access and write permission to "%IMPECCABLE_HOME%\bin\%version%". 1>&2
echo Run this launcher ("%~f0") with engine-probe in a terminal that has those permissions, then retry the original command. 1>&2
echo Alternatively, set IMPECCABLE_HOME to a writable cache location, or IMPECCABLE_BIN to a preinstalled engine binary. 1>&2
exit /b 127

:fail
echo impeccable: no engine binary found (looked in %bin%, %cached%, PATH). 1>&2
echo Download impeccable-windows-%arch%.exe from https://github.com/pbakaus/impeccable/releases (tag engine-v%version%) and save it as %cached%, or set IMPECCABLE_BIN to a preinstalled engine binary. Docs: https://impeccable.style 1>&2
exit /b 127
