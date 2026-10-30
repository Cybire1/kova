// Sign the Android app with every APK signature scheme (v1 JAR, v2 and v3), not only v2.
// Android 7+ needs only v2, so the build tools drop v1 when the app's minSdk is 24; some phones'
// installers (seen on a Tecno Spark 40) still reject an APK without it as "invalid".
// Applies to every signing config, including the release one EAS adds at build time.
const { withAppBuildGradle } = require('expo/config-plugins')

const MARK = '// kova: every signature scheme'

module.exports = function withAllSignatureSchemes(config) {
  return withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(MARK))
      c.modResults.contents += `
${MARK}
android.signingConfigs.configureEach {
    enableV1Signing = true
    enableV2Signing = true
    enableV3Signing = true
}
`
    return c
  })
}
