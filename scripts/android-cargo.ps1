param(
    [ValidateSet('arm64', 'x86_64', 'armv7', 'x86')]
    [string]$Abi = 'x86_64'
)

$ErrorActionPreference = 'Stop'

$sdk = 'D:\Android\Sdk'
$ndk = "$sdk\ndk\27.0.12077973"
$jdk = 'D:\Android\jdk21'
$toolchain = "$ndk\toolchains\llvm\prebuilt\windows-x86_64\bin"
$repo = Split-Path -Parent $PSScriptRoot

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:NDK_HOME = $ndk
$env:JAVA_HOME = $jdk
$env:PATH = "$toolchain;$jdk\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"

$targets = @{
    arm64  = @{ Triple = 'aarch64-linux-android';   Clang = 'aarch64-linux-android24' }
    armv7  = @{ Triple = 'armv7-linux-androideabi'; Clang = 'armv7a-linux-androideabi24' }
    x86_64 = @{ Triple = 'x86_64-linux-android';    Clang = 'x86_64-linux-android24' }
    x86    = @{ Triple = 'i686-linux-android';      Clang = 'i686-linux-android24' }
}

$entry = $targets[$Abi]
$triple = $entry.Triple
$clang = $entry.Clang
$envVar = ($triple -replace '-', '_')
Set-Item -Path "env:CC_$envVar" -Value "$toolchain\$clang-clang.cmd"
Set-Item -Path "env:CXX_$envVar" -Value "$toolchain\$clang-clang++.cmd"
Set-Item -Path "env:AR_$envVar" -Value "$toolchain\llvm-ar.exe"
Set-Item -Path "env:CARGO_TARGET_$($envVar.ToUpper())_LINKER" -Value "$toolchain\$clang-clang.cmd"

Push-Location (Join-Path $repo 'src-tauri')
try {
    & cargo build --target $triple --features tauri/custom-protocol
    if ($LASTEXITCODE -ne 0) { throw "cargo failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
