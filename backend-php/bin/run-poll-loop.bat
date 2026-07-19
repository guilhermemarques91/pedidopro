@echo off
cd /d D:\pedidos\backend-php

:loop
echo [%date% %time%] iniciando poll.php --loop >> poll-local.log
"C:\php83\php.exe" bin\poll.php --loop >> poll-local.log 2>&1
echo [%date% %time%] poll.php --loop caiu, reiniciando em 5s... >> poll-local.log
timeout /t 5 /nobreak >nul
goto loop
