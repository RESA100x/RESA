import java.io.File
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction

/// Builds the Rust library with `cargo` directly.
///
/// The stock task shells out to `tauri android android-studio-script`, which is
/// a dev-server helper and fails outside `tauri android dev`. It also makes the
/// Tauri CLI symlink the `.so` into `jniLibs`, and Windows refuses to create
/// symlinks without Developer Mode. Building with cargo and copying the library
/// avoids both problems and needs no extra privileges.
open class BuildTask : DefaultTask() {
    @Input
    var rootDirRel: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val rootDir = File(project.projectDir, rootDirRel)

        val triple = when (target) {
            "aarch64" -> "aarch64-linux-android"
            "armv7" -> "armv7-linux-androideabi"
            "i686" -> "i686-linux-android"
            "x86_64" -> "x86_64-linux-android"
            else -> throw GradleException("unsupported Rust target: $target")
        }
        val abi = when (target) {
            "aarch64" -> "arm64-v8a"
            "armv7" -> "armeabi-v7a"
            "i686" -> "x86"
            "x86_64" -> "x86_64"
            else -> throw GradleException("unsupported Rust target: $target")
        }
        val profile = if (release) "release" else "debug"

        project.exec {
            workingDir(rootDir)
            executable("cargo")
            args("build", "--target", triple, "--features", "tauri/custom-protocol")
            if (release) {
                args("--release")
            }
        }.assertNormalExitValue()

        val libraryName = "libnowly_lib.so"
        val built = File(rootDir, "target/$triple/$profile/$libraryName")
        if (!built.exists()) {
            throw GradleException("cargo did not produce $built")
        }
        val destinationDir = File(project.projectDir, "src/main/jniLibs/$abi")
        destinationDir.mkdirs()
        built.copyTo(File(destinationDir, libraryName), overwrite = true)
    }
}
