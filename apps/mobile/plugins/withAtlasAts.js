const { withInfoPlist } = require("@expo/config-plugins");

/**
 * iOS 17+ blocks HTTP to raw IP addresses in native apps (Safari still works).
 * NSAllowsArbitraryLoads alone is not enough — we need NSExceptionDomains for
 * each IP and the Tailscale MagicDNS hostname.
 */
function withAtlasAts(config, props = {}) {
  const tsIp = props.tsIp ?? "100.127.118.18";
  const lanIp = props.lanIp ?? "10.0.0.84";
  const tailnet = props.tailnet ?? "tail5f7dec.ts.net";
  const tsHost = props.tsHost ?? "macbook-air-de-camron.tail5f7dec.ts.net";

  return withInfoPlist(config, (mod) => {
    mod.modResults.NSLocalNetworkUsageDescription =
      "Atlas connects to your Mac on your home network for voice and project context.";

    const exceptionDomains = {
      [tsIp]: { NSExceptionAllowsInsecureHTTPLoads: true },
      [lanIp]: { NSExceptionAllowsInsecureHTTPLoads: true },
      [tsHost]: { NSExceptionAllowsInsecureHTTPLoads: true },
      [tailnet]: {
        NSIncludesSubdomains: true,
        NSExceptionAllowsInsecureHTTPLoads: true,
      },
    };

    mod.modResults.NSAppTransportSecurity = {
      NSAllowsArbitraryLoads: true,
      NSAllowsLocalNetworking: true,
      NSExceptionDomains: exceptionDomains,
    };

    return mod;
  });
}

module.exports = withAtlasAts;
