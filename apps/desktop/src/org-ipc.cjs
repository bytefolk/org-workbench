const BACKUP_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d{13}-[a-f0-9]{6}$/;

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

module.exports = { validateRestoreRequest };
