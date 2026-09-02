/**
 * In-app update, gated by what each platform can actually deliver.
 *
 * The platforms are not symmetric. Squirrel.Mac refuses an update whose
 * signature does not match the installed app, and Gatekeeper blocks an unsigned
 * first launch, so macOS in-app update requires a Developer ID build (#135).
 * Windows has no such precondition: electron-updater verifies the downloaded
 * installer against the SHA512 in `latest.yml` fetched over HTTPS, and publisher
 * pinning is an additional check rather than a prerequisite.
 *
 * So Windows gets a working update path now and macOS gets an honest refusal,
 * rather than a control that cannot succeed.
 */

const UNAVAILABLE_REASONS = Object.freeze({
  darwin:
    "In-app update needs a Developer ID signed build. Squirrel.Mac refuses an update whose signature does not match the installed app. Tracked in #135.",
  linux:
    "This build has no Linux release channel. Install and update through the source tree.",
});

/**
 * Whether in-app update can work on this platform, and if not, what to tell the
 * person looking at it. A reason is always a sentence a user can act on, never a
 * bare capability flag.
 */
function updateChannelAvailability(platform = process.platform) {
  if (platform === "win32") return { available: true };
  const reason = UNAVAILABLE_REASONS[platform]
    ?? "In-app update is not available for this platform.";
  return { available: false, reason };
}

/** Terminal and progress states the service reports. */
const UPDATE_STATES = Object.freeze([
  "idle",
  "unavailable",
  "checking",
  "current",
  "available",
  "downloading",
  "downloaded",
  "error",
]);

function normalizedError(error) {
  if (error === null || error === undefined) return "update failed for an unstated reason";
  const message = typeof error === "string" ? error : error.message;
  return String(message ?? error).slice(0, 512);
}

/**
 * Wraps an electron-updater instance. The updater is injected rather than
 * imported so the state machine is testable without Electron, and so the
 * unavailable platforms never construct one.
 */
function createUpdaterService({
  updater,
  platform = process.platform,
  onState = () => {},
  logger = null,
} = {}) {
  const availability = updateChannelAvailability(platform);
  let state = availability.available ? "idle" : "unavailable";

  const publish = (next, detail = {}) => {
    state = next;
    onState({ state: next, ...detail });
  };

  if (!availability.available) {
    return {
      get state() { return state; },
      availability,
      async check() {
        publish("unavailable", { reason: availability.reason });
        return { state: "unavailable", reason: availability.reason };
      },
      async install() {
        return { state: "unavailable", reason: availability.reason };
      },
    };
  }

  if (updater === null || updater === undefined) {
    throw new Error("an available update channel requires an updater instance");
  }

  // Nothing is downloaded or installed without an explicit request. An update
  // that installs itself while someone is mid-turn is a data-loss risk, not a
  // convenience.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  if (logger !== null) updater.logger = logger;

  updater.on?.("update-available", (info) => publish("available", { version: info?.version ?? null }));
  updater.on?.("update-not-available", () => publish("current"));
  updater.on?.("download-progress", (progress) => publish("downloading", {
    percent: typeof progress?.percent === "number" ? Math.round(progress.percent) : null,
  }));
  updater.on?.("update-downloaded", (info) => publish("downloaded", { version: info?.version ?? null }));
  updater.on?.("error", (error) => publish("error", { reason: normalizedError(error) }));

  return {
    get state() { return state; },
    availability,

    async check() {
      publish("checking");
      try {
        const result = await updater.checkForUpdates();
        // The event handlers above have already moved the state; the return
        // value is the caller's receipt, not a second source of truth.
        return { state, version: result?.updateInfo?.version ?? null };
      } catch (error) {
        publish("error", { reason: normalizedError(error) });
        return { state: "error", reason: normalizedError(error) };
      }
    },

    async download() {
      if (state !== "available") {
        return { state, reason: "no update is available to download" };
      }
      try {
        await updater.downloadUpdate();
        return { state };
      } catch (error) {
        publish("error", { reason: normalizedError(error) });
        return { state: "error", reason: normalizedError(error) };
      }
    },

    async install() {
      if (state !== "downloaded") {
        return { state, reason: "no downloaded update is ready to install" };
      }
      updater.quitAndInstall();
      return { state: "downloaded", installing: true };
    },
  };
}

module.exports = {
  UPDATE_STATES,
  createUpdaterService,
  updateChannelAvailability,
};
