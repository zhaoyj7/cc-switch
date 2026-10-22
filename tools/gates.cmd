@echo off
rem Three gates: desktop lib, headless lib+bin, Linux-target dependency resolution (metadata only)
call D:\projects\ccs\tools\rust.cmd check --lib > D:\projects\ccs\.e2e-gate1.log 2>&1
echo gate1=%ERRORLEVEL%
call D:\projects\ccs\tools\rust.cmd check --no-default-features --features headless --lib --bin cc-switch-server > D:\projects\ccs\.e2e-gate2.log 2>&1
echo gate2=%ERRORLEVEL%
call D:\projects\ccs\tools\rust.cmd metadata --format-version 1 --filter-platform x86_64-unknown-linux-gnu --no-default-features --features headless > D:\projects\ccs\.e2e-gate3.json 2>&1
echo gate3=%ERRORLEVEL%
