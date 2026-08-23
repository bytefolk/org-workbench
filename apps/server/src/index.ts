/**
 * Control-plane entrypoint. Runs under the Electron shell (spawned child) or
 * standalone (D0 acceptance 3: shell-service separation proof).
 *
 * Ready protocol: one stdout line
 *   org-workbench-server ready {"port":N,"api":"v0","token":"..."}
 * The boot token travels only through the parent-child stdout pipe (or the
 * terminal in standalone mode); it is never written to files or logs.
 */
import { EventBus } from "./bus.js";
import { resolveServerConfig } from "./config.js";
import type { ControlPlaneContext } from "./context.js";
import { DigitalEmployeeCliDriver } from "./engine/driver-cli.js";
import { WorkspaceState } from "./workspace-state.js";
import { createControlPlane } from "./server.js";

const config = resolveServerConfig(process.env, process.argv.slice(2));
const ctx: ControlPlaneContext = {
  config,
  workspace: new WorkspaceState(),
  bus: new EventBus(),
  driver: new DigitalEmployeeCliDriver(config.cliCommand),
};
const server = createControlPlane(ctx);

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : config.port;
  process.stdout.write(
    `org-workbench-server ready ${JSON.stringify({ port, api: "v0", token: config.token })}\n`,
  );
});

server.on("clientError", (_err, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
