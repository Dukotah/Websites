@echo off
REM Unattended morning demo-batch runner (scheduled via Task Scheduler).
REM Builds a fresh batch, GATES it (only website leads; only QA-passing sites),
REM pushes the passing sites live, then lands ONLY those in the CRM New tab.
REM Weak/failed sites are quarantined to data\quarantine and queued in
REM data\research-queue.txt for a finishing pass — never shipped, never burned.
set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "DUKE_DIR=C:\Users\dukot\projects\Duke"
cd /d "C:\Users\dukot\projects\Websites"
echo ===== morning batch run %DATE% %TIME% ===== >> data\morning-batch.log
node scripts\morning-batch.mjs --n 10 --publish >> data\morning-batch.log 2>&1
echo ===== done %DATE% %TIME% ===== >> data\morning-batch.log
