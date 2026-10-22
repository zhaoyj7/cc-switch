@echo off
rem Run cargo on the MSVC toolchain; RUSTUP_TOOLCHAIN overrides the GNU one picked by rust-toolchain.toml
call "C:\Program Files\Microsoft Visual Studio\18\VC\Auxiliary\Build\vcvars64.bat" >nul
set PATH=C:\Users\admin\.cargo\bin;%PATH%
set RUSTUP_TOOLCHAIN=1.95-x86_64-pc-windows-msvc
cd /d D:\projects\ccs\src-tauri
cargo %*
