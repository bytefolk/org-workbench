# Windows Authenticode Signing

This document describes the Windows code signing setup for Org Workbench.

## Overview

Windows executables and installers are Authenticode-signed to:
- Prevent SmartScreen warnings during installation
- Enable signature verification in the auto-update channel
- Establish publisher identity for trust building

The signing process is **conditional**: builds proceed unsigned when credentials are unavailable (PR builds, local development) and signed when credentials are present (release builds).

## Required Credentials

### For Certificate-Based Signing

```bash
export WINDOWS_SIGNING_ENABLED=true
export WINDOWS_PUBLISHER_NAME="Your Organization Name"
export WIN_CSC_LINK="/path/to/certificate.pfx"
export CSC_KEY_PASSWORD="certificate-password"
```

### For Cloud Signing Services

```bash
export WINDOWS_SIGNING_ENABLED=true
export WINDOWS_PUBLISHER_NAME="Your Organization Name"
export WINDOWS_SIGNING_SCRIPT="/path/to/signing-script.sh"
```

## Signing Provider Options

### Option 1: SignPath.io (Recommended for OSS)

**Pros:**
- Certificate stays out of repository entirely
- Separate test signing policy for draft releases
- Good for open-source projects (free tier available)

**Cons:**
- External dependency on SignPath service
- Onboarding requires project approval

### Option 2: Azure Trusted Signing

**Pros:**
- Integrated with Azure ecosystem
- Managed certificate lifecycle

**Cons:**
- Requires Azure subscription

### Option 3: DigiCert KeyLocker

**Pros:**
- Enterprise-grade HSM-backed keys

**Cons:**
- Commercial product (paid)

## Build Commands

```bash
# Preflight check
npm run preflight:win:signing

# Build signed
npm run package:win:signed

# Build unsigned (default)
npm run package:win:unsigned
```

## Verification

The verifier checks Authenticode signatures conditionally:

```bash
# Verify unsigned build
npm run verify:package:win

# Verify signed build
WINDOWS_SIGNING_ENABLED=true npm run verify:package:win
```
