#!/usr/bin/env node

/**
 * macOS signing preflight (#135).
 *
 * Validates that every secret required for Developer ID signing and
 * notarization is present before any build step runs. Fails naming exactly
 * which are missing, without echoing any secret value.
 *
 * Required secrets (all must be set for signing to proceed):
 *   MACOS_CERTIFICATE          - Base64-encoded .p12 certificate bundle
 *   MACOS_CERTIFICATE_PASSWORD - Password for the .p12 bundle
 *   MACOS_TEAM_ID              - Apple Developer Team ID
 *   MACOS_APPLE_ID             - Apple ID for notarytool
 *   MACOS_APP_SPECIFIC_PASSWORD - App-specific password for notarytool
 *
 * Exit codes:
 *   0 - all secrets present, signing can proceed
 *   1 - one or more secrets missing
 */

const REQUIRED_SECRETS = [
  { name: "MACOS_CERTIFICATE", description: "Base64-encoded Developer ID .p12 certificate" },
  { name: "MACOS_CERTIFICATE_PASSWORD", description: "Password for the .p12 certificate bundle" },
  { name: "MACOS_TEAM_ID", description: "Apple Developer Team ID" },
  { name: "MACOS_APPLE_ID", description: "Apple ID for notarytool submission" },
  { name: "MACOS_APP_SPECIFIC_PASSWORD", description: "App-specific password for notarytool" },
];

function main() {
  const missing = [];
  const present = [];

  for (const secret of REQUIRED_SECRETS) {
    const value = process.env[secret.name];
    if (value && value.trim().length > 0) {
      present.push(secret.name);
    } else {
      missing.push(secret);
    }
  }

  if (missing.length > 0) {
    console.error("::error::macOS signing preflight failed: the following required secrets are missing:");
    for (const secret of missing) {
      console.error(`  - ${secret.name}: ${secret.description}`);
    }
    console.error("");
    console.error("To enable macOS signing, configure these secrets in the repository settings.");
    console.error("See https://github.com/bytefolk/org-workbench/issues/135 for details.");
    process.exit(1);
  }

  console.log(`macOS signing preflight passed: all ${present.length} required secrets are present.`);
  console.log(`  Present: ${present.join(", ")}`);
  process.exit(0);
}

main();
