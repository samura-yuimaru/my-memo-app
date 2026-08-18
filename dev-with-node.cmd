@ECHO OFF
SET "PATH=C:\Program Files\nodejs;%PATH%"
CD /D "%~dp0"
CALL "C:\Program Files\nodejs\npm.cmd" run dev
