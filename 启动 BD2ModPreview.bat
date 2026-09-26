@echo off
chcp 65001 >nul
setlocal
title BD2ModPreview

cd /d "%~dp0"
if errorlevel 1 goto failed_directory

for /f "delims=" %%i in ('where node.exe 2^>nul') do if not defined NODE_DIR set "NODE_DIR=%%~dpi"
for /f "delims=" %%i in ('where npm.cmd 2^>nul') do if not defined NPM_DIR set "NPM_DIR=%%~dpi"
for /f "delims=" %%i in ('where cargo.exe 2^>nul') do if not defined CARGO_DIR set "CARGO_DIR=%%~dpi"
if not defined NODE_DIR goto missing_node
if not defined NPM_DIR goto missing_npm
if not defined CARGO_DIR goto missing_rust

rem Keep the toolchain paths needed by the project and drop oversized inherited PATH entries.
set "PATH=%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\Wbem;%SystemRoot%\System32\WindowsPowerShell\v1.0;%NODE_DIR%;%NPM_DIR%;%CARGO_DIR%"

if not exist "node_modules\@tauri-apps\cli" goto missing_dependencies

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto missing_vswhere
set "VSINSTALLDIR="
for /f "usebackq tokens=*" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSINSTALLDIR=%%i"
if not defined VSINSTALLDIR goto missing_cpp_tools
set "VSINSTALLDIR=%VSINSTALLDIR%\"
if not exist "%VSINSTALLDIR%Common7\Tools\VsDevCmd.bat" goto missing_vsdevcmd

call "%VSINSTALLDIR%Common7\Tools\VsDevCmd.bat" -no_logo -arch=x64 -host_arch=x64 >nul
if errorlevel 1 goto failed_vsdevcmd
where cl.exe >nul 2>&1
if errorlevel 1 goto missing_cpp_compiler

netstat -ano -p tcp | findstr /R /C:":1420 .*LISTENING" >nul
if not errorlevel 1 goto vite_port_in_use

echo Starting BD2ModPreview in development mode...
if not "%~1"=="" goto launch_with_mod
call npm.cmd run tauri -- dev
goto launch_finished

:launch_with_mod
call npm.cmd run tauri -- dev -- -- %*

:launch_finished
set "BD2_EXIT_CODE=%ERRORLEVEL%"
if not "%BD2_EXIT_CODE%"=="0" echo BD2ModPreview exited with code %BD2_EXIT_CODE%.
pause
exit /b %BD2_EXIT_CODE%

:failed_directory
echo Could not open the BD2ModPreview project folder.
goto failed

:missing_node
echo Node.js is not available in PATH.
goto failed

:missing_npm
echo npm.cmd is not available in PATH.
goto failed

:missing_rust
echo Rust is not available in PATH. Open a new terminal after installing Rust.
goto failed

:missing_dependencies
echo Project dependencies are missing. Run npm ci from this folder first.
goto failed

:missing_vswhere
echo Visual Studio Installer's vswhere.exe was not found.
goto failed

:missing_cpp_tools
echo Visual Studio C++ Build Tools were not found.
goto failed

:missing_vsdevcmd
echo VsDevCmd.bat was not found in the Visual Studio installation.
goto failed

:failed_vsdevcmd
echo Could not initialize the Visual Studio C++ build environment.
goto failed

:missing_cpp_compiler
echo cl.exe is unavailable after initializing Visual Studio Build Tools.
goto failed

:vite_port_in_use
echo Vite port 1420 is already in use.
echo Close the previous BD2ModPreview development window or console, then run this launcher again.
goto failed

:failed
pause
exit /b 1
