/**
 * Propagate expo-build-properties android.kotlinVersion to rootProject.ext so
 * react-native-google-mobile-ads and other libraries use the same Kotlin compiler
 * (RN 0.79 defaults to 2.0.21; play-services-ads 25.x needs 2.1+).
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

const MARKER = 'GYW_KOTLIN_VERSION_EXT';

function withAndroidKotlinVersion(config) {
  return withProjectBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) {
      return cfg;
    }
    const injection = `
// ${MARKER} — align Kotlin across RN autolinked modules (see plugins/withAndroidKotlinVersion.js)
def gywKotlinVersion = findProperty('android.kotlinVersion') ?: '2.1.20'
rootProject.ext.kotlinVersion = gywKotlinVersion

subprojects { subproject ->
  subproject.afterEvaluate {
    if (subproject.name == 'react-native-google-mobile-ads') {
      subproject.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
        compilerOptions {
          freeCompilerArgs.add('-Xskip-metadata-version-check')
        }
      }
    }
  }
}
`;
    if (contents.includes('apply plugin: "expo-root-project"')) {
      contents = contents.replace(
        /apply plugin: "expo-root-project"/,
        `${injection.trim()}\n\napply plugin: "expo-root-project"`,
      );
    } else if (contents.includes('apply plugin: "com.facebook.react.rootproject"')) {
      contents = contents.replace(
        /apply plugin: "com.facebook.react.rootproject"\s*/,
        `${injection.trim()}\n\napply plugin: "com.facebook.react.rootproject"\n`,
      );
    } else {
      contents += `\n${injection}\n`;
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = withAndroidKotlinVersion;
