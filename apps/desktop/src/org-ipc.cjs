const BACKUP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{13}-[a-f0-9]{6}$/;

const CHANGE_MANIFEST_SCHEMA_VERSION = "change-manifest.v1";
const POSITION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_POSITION_ID_LENGTH = 64;

function isPositionId(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_POSITION_ID_LENGTH &&
    POSITION_ID_PATTERN.test(value)
  );
}

function validateRestoreRequest(backupId) {
  if (typeof backupId !== "string" || backupId.length > 128 || !BACKUP_ID.test(backupId)) {
    return {
      ok: false,
      response: {
        status: 400,
        body: { code: "restore_invalid", message: "backupId is invalid", retryable: false },
      },
    };
  }
  return { ok: true, request: { backupId } };
}

// Defense-in-depth mirror of the server-side manifest validation
// (apps/server/src/org/apply.ts `validateManifest`). The renderer is
// untrusted; rejecting a malformed manifest here keeps it from ever reaching
// the loopback control plane and gives the user a synchronous 400 instead of
// a server round-trip failure. The server remains the source of truth for the
// organization state.
function validateOrgApply(manifest) {
  const reject = (message) => ({
    ok: false,
    response: { status: 400, body: { code: "manifest_invalid", message, retryable: false } },
  });

  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return reject("manifest must be a plain object");
  }
  if (manifest.schemaVersion !== CHANGE_MANIFEST_SCHEMA_VERSION) {
    return reject(`manifest schemaVersion must be ${CHANGE_MANIFEST_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(manifest.changes) || manifest.changes.length === 0) {
    return reject("manifest changes must be a non-empty array");
  }

  for (const [index, change] of manifest.changes.entries()) {
    if (typeof change !== "object" || change === null || Array.isArray(change)) {
      return reject(`changes[${index}] must be a plain object`);
    }
    switch (change.op) {
      case "move":
        if (!isPositionId(change.id)) {
          return reject(`changes[${index}]: move.id is invalid`);
        }
        if (change.reportTo !== null && !isPositionId(change.reportTo)) {
          return reject(`changes[${index}]: move.reportTo must be a position id | null`);
        }
        break;
      case "delete":
        if (!isPositionId(change.id)) {
          return reject(`changes[${index}]: delete.id is invalid`);
        }
        break;
      case "reorder":
        if (change.parentId !== null && !isPositionId(change.parentId)) {
          return reject(`changes[${index}]: reorder.parentId must be a position id | null`);
        }
        if (!Array.isArray(change.order) || change.order.length === 0) {
          return reject(`changes[${index}]: reorder.order must be a non-empty array`);
        }
        const seen = new Set();
        for (const id of change.order) {
          if (!isPositionId(id)) return reject(`changes[${index}]: order entries must be position ids`);
          if (seen.has(id)) return reject(`changes[${index}]: order contains a duplicate id: ${id}`);
          seen.add(id);
        }
        break;
      default:
        return reject(`changes[${index}].op must be move | delete | reorder`);
    }
  }

  return { ok: true, request: manifest };
}

module.exports = { validateRestoreRequest, validateOrgApply };
