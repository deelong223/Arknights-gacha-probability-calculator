# Rebuild gacha.cpp -> gacha.wasm
#
# Why two steps?
#   The sandbox blocks directories created by python's tempfile.mkdtemp(), so emcc's
#   internal "compile to temp" step fails. We compile to .o with clang ourselves and let
#   emcc do only the link step (which does not need a temp dir).
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File tools\build.ps1
#     or: tools\build.cmd
#
# Emitted module: gacha.wasm (standalone, no imports, exports calculate/setTarget/...)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$emsdk = $env:EMSDK_ROOT
if (-not $emsdk) { $emsdk = 'C:\emsdk' }
$clang = Join-Path $emsdk 'upstream\bin\clang.exe'
$emcc  = Join-Path $emsdk 'upstream\emscripten\emcc.bat'

if (-not (Test-Path $clang)) { throw "clang not found: $clang (set EMSDK_ROOT)" }
if (-not (Test-Path $emcc))  { throw "emcc not found: $emcc (set EMSDK_ROOT)" }

New-Item -ItemType Directory -Force .build | Out-Null

$env:EM_CACHE  = Join-Path $root '.emcache'
$env:EM_CONFIG = Join-Path $emsdk '.emscripten'
$env:TMP       = Join-Path $root '.build\tmp'
$env:TEMP      = $env:TMP
New-Item -ItemType Directory -Force $env:TMP | Out-Null

$sysroot = Join-Path $env:EM_CACHE 'sysroot'
$exports = '_gachaInit,_setTarget,_setCount,_setThreshold,_calculate,_calculateSingle,_bannerMean,_bannerQuantile,_statGet,_statReset'

Write-Host '[1/2] clang -c gacha.cpp -o .build/gacha.o'
& $clang -target wasm32-unknown-emscripten "--sysroot=$sysroot" `
    -Xclang -iwithsysroot/include/compat -Xclang -iwithsysroot/include/fakesdl `
    -O3 -msimd128 -fignore-exceptions -c gacha.cpp -o .build\gacha.o
if ($LASTEXITCODE -ne 0) { throw "clang failed (exit $LASTEXITCODE)" }

Write-Host '[2/2] emcc link -> gacha.wasm'
$linkArgs = @(
    '.build\gacha.o',
    '-O3', '-msimd128',
    '--no-entry',
    "-sEXPORTED_FUNCTIONS=$exports",
    '-sINITIAL_MEMORY=64MB',
    '-sALLOW_MEMORY_GROWTH=0',
    '-sFILESYSTEM=0',
    '-sASSERTIONS=0',
    '-o', 'gacha.wasm'
)
& $emcc @linkArgs
if ($LASTEXITCODE -ne 0) { throw "emcc failed (exit $LASTEXITCODE)" }

$size = (Get-Item gacha.wasm).Length
Write-Host "OK: gacha.wasm ($size bytes)"

# Inline copy so index.html also works when opened via file:// (no fetch/CORS)
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'gacha.wasm')))
$out = "window.GACHA_WASM_B64='$b64';" + "`n"
[IO.File]::WriteAllText((Join-Path $root 'gacha-wasm-b64.js'), $out, [Text.Encoding]::ASCII)
Write-Host "OK: gacha-wasm-b64.js ($([IO.File]::ReadAllBytes((Join-Path $root 'gacha-wasm-b64.js')).Length) bytes)"



