// Release signing for the Android app: a pure text change to android/app/build.gradle,
// applied during `expo prebuild` by plugins/with-release-signing.js.
//
// Expo's prebuild template signs the release build type with the public debug key
// (signingConfigs.debug). This adds an "upload" signing config that reads the upload key
// from Gradle properties: the same android.injected.signing.* names the release workflow
// passes with -P. The properties are read here directly. The AGP source reads them through
// its injected-signing path only for dynamic-feature modules, so it cannot be relied on to
// replace the base app's release signing.
//
// A release bundle or APK also fails when the properties are missing, so a release can
// never be signed with the debug key. Google Play does not accept debug-signed apps.

const STORE_FILE = "android.injected.signing.store.file";
const MARKER = "lately-release-signing";

const UPLOAD_CONFIG = `        upload {
            // ${MARKER}: the upload key comes from Gradle properties (docs/release-android.md).
            if (project.hasProperty('${STORE_FILE}')) {
                storeFile file(project.property('${STORE_FILE}'))
                storePassword project.property('android.injected.signing.store.password')
                keyAlias project.property('android.injected.signing.key.alias')
                keyPassword project.property('android.injected.signing.key.password')
            }
        }
`;

const RELEASE_GUARD = `// ${MARKER}: refuse to build a release bundle or APK without the upload key.
gradle.taskGraph.whenReady { graph ->
    def wantsRelease = graph.allTasks.any { it.name in ['bundleRelease', 'assembleRelease'] }
    if (wantsRelease && !project.hasProperty('${STORE_FILE}')) {
        throw new GradleException('Release builds need the upload key: set the android.injected.signing.* Gradle properties (see docs/release-android.md).')
    }
}
`;

/**
 * Returns android/app/build.gradle with release signed by the upload key.
 * Idempotent. Throws if the template no longer has the lines this expects, so a changed
 * Expo template fails the prebuild instead of silently keeping the debug key.
 */
function applyReleaseSigning(contents) {
  if (contents.includes(MARKER)) return contents;

  const signingConfigsOpen = /^ *signingConfigs \{\n/m;
  const releaseDebugKey = /(buildTypes \{[\s\S]*?\n\s*release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!signingConfigsOpen.test(contents) || !releaseDebugKey.test(contents)) {
    throw new Error(
      "The Expo Android template changed: the release signing lines in android/app/build.gradle were not found, " +
        "so the release build was not switched to the upload key.",
    );
  }

  let out = contents.replace(signingConfigsOpen, (line) => line + UPLOAD_CONFIG);
  out = out.replace(releaseDebugKey, "$1signingConfig signingConfigs.upload");
  return `${out.trimEnd()}\n\n${RELEASE_GUARD}`;
}

module.exports = { applyReleaseSigning, STORE_FILE, MARKER };
