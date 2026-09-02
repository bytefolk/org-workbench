/**
 * In-app update, gated by what each platform can actually deliver and by the
 * requirement-decision on #110.
 *
 * The platforms are not symmetric. Squirrel.Mac refuses an update whose
 * signature does not match the installed app, and Gatekeeper blocks an unsigned
 * first launch, so macOS in-app update requires a Developer ID build (#135).
 * Windows has no such precondition.
 *
 * The #110 R3 decision reads, verbatim: "An unsigned platform may check and
 * notify about an update, but it must not silently download, apply, or restart
 * into that update." Every step here is therefore explicitly requested --
 * `download` and `install` refuse without a caller-supplied confirmation, and
 * electron-updater's own automatic paths are turned off. Enforcement lives in
 * this service rather than in a UI, because the UI (#134) does not exist yet and
 * a later one must not be able to skip the confirmation by forgetting to ask.
 *
 * What unsigned costs, measured from electron-updater 6.8.9: `NsisUpdater`
 * skips signature verification entirely when `publisherName` is absent from
 * `app-update.yml`, which it is for an unsigned build -- `verifySignature`
 * returns null and the caller treats null as a pass. So the only integrity
 * guarantee on an unsigned update is the SHA512 in `latest.yml` fetched over
 * HTTPS; there is no publisher pinning. The release lane keeps unsigned builds
 * on draft or prerelease channels, so the set of people who can receive such an
 * update is the set who could tamper with the release in the first place. Once
 * #136 signs Windows, `publisherName` appears and NsisUpdater enforces the
 * pinning itself.
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
  // `requiresConfirmation` is not advice to the caller, it is a statement about
  // what this service will refuse. It exists so a UI can render the prompt
  // rather than discover the refusal.
  if (platform === "win32") return { available: true, requiresConfirmation: true };
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
      async download() {
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

    async download({ confirmedByUser = false } = {}) {
      // #110 R3: nothing may happen without an explicit request.
      if (confirmedByUser !== true) {
        return { state, reason: "downloading an update requires explicit confirmation" };
      }
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

    async install({ confirmedByUser = false } = {}) {
      // Installing restarts the app, so this is the step most likely to lose
      // someone's work if it happens without being asked for.
      if (confirmedByUser !== true) {
        return { state, reason: "installing an update requires explicit confirmation" };
      }
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
