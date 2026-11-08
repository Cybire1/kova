#!/usr/bin/env bash
# On EAS, Android only, after prebuild: fetch Gradle before the build needs it. The wrapper
# downloads it from GitHub with a 10-second timeout and no retry, and GitHub sometimes times out or
# answers 504 to EAS's builders. Here it gets two minutes a try and six tries; whatever happens, the
# build itself runs next and reports.
[ "$EAS_BUILD_PLATFORM" = "android" ] || exit 0
props=android/gradle/wrapper/gradle-wrapper.properties
[ -f "$props" ] || exit 0
if grep -q '^networkTimeout=' "$props"; then
  sed -i 's/^networkTimeout=.*/networkTimeout=120000/' "$props"
else
  echo 'networkTimeout=120000' >> "$props"
fi
for try in 1 2 3 4 5 6; do
  if (cd android && ./gradlew --version > /dev/null); then
    echo "Gradle is ready (try $try)."
    exit 0
  fi
  echo "Gradle didn't download (try $try). Waiting before the next try."
  sleep $((try * 15))
done
exit 0
