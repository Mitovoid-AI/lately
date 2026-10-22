// Expo config plugin: signs the release build with the upload key during `expo prebuild`.
// What changes and why: see plugins/release-signing-gradle.js.
const { withAppBuildGradle } = require("expo/config-plugins");
const { applyReleaseSigning } = require("./release-signing-gradle");

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      throw new Error("Release signing expects a Groovy android/app/build.gradle (the Expo SDK 57 template).");
    }
    mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
    return mod;
  });
};
