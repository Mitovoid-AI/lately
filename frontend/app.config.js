// Wraps app.json. A production build (APP_VARIANT / EAS_BUILD_PROFILE / NODE_ENV =
// "production") fails here, at config time, unless it is pointed at the live backend over
// https with Supabase configured: release builds must never ship demo mode or localhost.
const { assertReleaseEnv } = require("./release-env");

module.exports = ({ config }) => {
  assertReleaseEnv(process.env);
  return { ...config };
};
