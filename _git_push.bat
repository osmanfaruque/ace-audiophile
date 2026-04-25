@echo off
cd /d c:\Osman-personal\coding\Audiophile_Ace
git add -A
git commit -m "feat: A7.3.4-7, C1.2 ABX blind test engine wiring and analysis output + fix fake hi-res"
git push origin main
del "%~f0"
