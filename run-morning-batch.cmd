@echo off
REM Unattended morning demo-batch runner (scheduled via Task Scheduler).
REM Produces a fresh batch of demo sites and auto-syncs them to the CRM New tab.
set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "DUKE_DIR=C:\Users\dukot\projects\Duke"
cd /d "C:\Users\dukot\projects\Websites"
echo ===== morning batch run %DATE% %TIME% ===== >> data\morning-batch.log
node scripts\morning-batch.mjs --n 10 >> data\morning-batch.log 2>&1
echo ===== done %DATE% %TIME% ===== >> data\morning-batch.log
