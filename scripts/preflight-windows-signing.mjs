#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function checkCredential(name, value, required = true) {
  if (!value || value.trim() === "") {
    if (required) {
      console.error(`❌ Missing required credential: ${name}`);
      return false;
    }
    console.warn(`⚠️  Optional credential not set: ${name}`);
    return true;
  }
  console.log(`✓ ${name} is set`);
  return true;
}

function checkFile(name, filePath, required = true) {
  if (!filePath || filePath.trim() === "") {
    if (required) {
      console.error(`❌ Missing required file path: ${name}`);
      return false;
    }
    return true;
  }

  if (!fs.existsSync(filePath)) {
    if (required) {
      console.error(`❌ Required file not found: ${name} (${filePath})`);
      return false;
    }
    console.warn(`⚠️  Optional file not found: ${name} (${filePath})`);
    return true;
  }
  console.log(`✓ ${name} exists at ${filePath}`);
  return true;
}

function preflightCheck() {
  console.log("🔍 Windows Signing Preflight Check\n");

  const signingEnabled = process.env.WINDOWS_SIGNING_ENABLED === "true";
  const signingScript = process.env.WINDOWS_SIGNING_SCRIPT;
  const publisherName = process.env.WINDOWS_PUBLISHER_NAME;

  let allChecksPassed = true;

  if (!signingEnabled) {
    console.log("ℹ️  Windows signing is not enabled (WINDOWS_SIGNING_ENABLED != 'true')");
    console.log("   Build will proceed without code signing.\n");
    return true;
  }

  console.log("✓ Windows signing is enabled\n");
  console.log("Validating signing credentials...\n");

  allChecksPassed &= checkCredential("WINDOWS_PUBLISHER_NAME", publisherName);

  if (signingScript) {
    console.log("\n📝 Cloud signing mode detected");
    allChecksPassed &= checkFile("WINDOWS_SIGNING_SCRIPT", signingScript);
  } else {
    console.log("\n📝 Certificate-based signing mode detected");

    const certLink = process.env.WIN_CSC_LINK;
    const certPassword = process.env.CSC_KEY_PASSWORD;

    if (certLink && (certLink.startsWith("-----BEGIN") || fs.existsSync(certLink))) {
      console.log("✓ WIN_CSC_LINK contains certificate data or file path");
    } else {
      console.error("❌ WIN_CSC_LINK must be a certificate file path or PEM/PFX content");
      allChecksPassed = false;
    }

    allChecksPassed &= checkCredential("CSC_KEY_PASSWORD", certPassword);
  }

  console.log("");

  if (allChecksPassed) {
    console.log("✅ All signing credentials validated successfully");
    return true;
  } else {
    console.error("❌ Signing credential validation failed");
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const success = preflightCheck();
  process.exit(success ? 0 : 1);
}

export { preflightCheck };
