<#
.SYNOPSIS
    Builds the RESA Android APK without the Tauri CLI's symlink step.

.DESCRIPTION
    `tauri android build` creates a symbolic link from the compiled `.so` into
    `gen/android/app/src/main/jniLibs`, and Windows refuses to create symlinks
    unless Developer Mode is enabled. This script drives Gradle directly, and
    the Gradle `rust` task in `gen/android/buildSrc` was changed to build with
    cargo and copy the library instead.

    Google's Maven host is unreachable from this network, so the Aliyun mirrors
    are injected through `scripts/gradle-mirror.init.gradle`.

.PARAMETER Abi
    arm64 (default, real phones), x86_64 (emulator), armv7 or x86.

.PARAMETER Release
    Build a release APK (needs a signing config) instead of a debug APK.
#>
param(
    [ValidateSet('arm64', 'x86_64', 'armv7', 'x86')]
    [string]$Abi = 'arm64',
    [switch]$Release
)

$ErrorActionPreference = 'Stop'

# The local machine keeps the SDK in D:\Android; CI points these at its own
# install through the standard environment variables.
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'D:\Android\Sdk' }
$ndk = if ($env:ANDROID_NDK_HOME) { $env:ANDROID_NDK_HOME } else { "$sdk\ndk\27.0.12077973" }
$jdk = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'D:\Android\jdk21' }
$toolchain = "$ndk\toolchains\llvm\prebuilt\windows-x86_64\bin"
$repo = Split-Path -Parent $PSScriptRoot

$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:NDK_HOME = $ndk
$env:JAVA_HOME = $jdk
$env:PATH = "$toolchain;$jdk\bin;$env:USERPROFILE\.cargo\bin;$env:PATH"

# rustc needs the full path: Windows' CreateProcess does not resolve `.cmd`
# wrappers from PATH the way a shell does.
$targets = @{
    arm64  = @{ Triple = 'aarch64-linux-android';       Clang = 'aarch64-linux-android24' }
    armv7  = @{ Triple = 'armv7-linux-androideabi';     Clang = 'armv7a-linux-androideabi24' }
    x86_64 = @{ Triple = 'x86_64-linux-android';        Clang = 'x86_64-linux-android24' }
    x86    = @{ Triple = 'i686-linux-android';          Clang = 'i686-linux-android24' }
}

foreach ($entry in $targets.GetEnumerator()) {
    $triple = $entry.Value.Triple
    $clang = $entry.Value.Clang
    $envVar = ($triple -replace '-', '_')
    Set-Item -Path "env:CC_$envVar" -Value "$toolchain\$clang-clang.cmd"
    Set-Item -Path "env:CXX_$envVar" -Value "$toolchain\$clang-clang++.cmd"
    Set-Item -Path "env:AR_$envVar" -Value "$toolchain\llvm-ar.exe"
    Set-Item -Path "env:CARGO_TARGET_$($envVar.ToUpper())_LINKER" -Value "$toolchain\$clang-clang.cmd"
}

# Gradle product flavors come from `archList` in gen/android/buildSrc, where
# 32-bit ARM is called "arm" and 64-bit x86 keeps its underscore.
$variant = @{ arm64 = 'Arm64'; armv7 = 'Arm'; x86_64 = 'X86_64'; x86 = 'X86' }[$Abi]
$task = if ($Release) { "assemble${variant}Release" } else { "assemble${variant}Debug" }

# `tauri android build` normally runs this through `beforeBuildCommand`; the
# frontend bundle is embedded into the Rust binary by `generate_context!`.
Push-Location $repo
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE" }
    # The Tauri CLI writes these two files when it drives the build; this script
    # calls Gradle directly, so refresh them from Cargo.toml here.
    & node (Join-Path $repo 'scripts\android-gen-gradle.mjs')
    if ($LASTEXITCODE -ne 0) { throw "Gradle project generation failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

Push-Location (Join-Path $repo 'src-tauri\gen\android')
try {
    & .\gradlew.bat --stop | Out-Null
    # The Aliyun mirrors exist for this network, where Google's Maven host is
    # unreachable. A CI runner reaches Google directly, so it opts out.
    $mirror = Join-Path $repo 'scripts\gradle-mirror.init.gradle'
    $gradleArgs = @($task, '--console=plain', '--no-daemon')
    if ($env:RESA_GRADLE_MIRROR -ne '0' -and (Test-Path $mirror)) {
        $gradleArgs += @('--init-script', $mirror)
    }
    & .\gradlew.bat @gradleArgs
    if ($LASTEXITCODE -ne 0) { throw "Gradle failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
