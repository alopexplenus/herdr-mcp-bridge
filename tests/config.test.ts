import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

const completeEnvironment = {
  HOME: "/home/bridge",
  HERDR_ALLOWED_PEER_ADDRESS: "100.64.1.3",
  HERDR_PROJECTS_ROOT: "/home/bridge/projects",
  HERDR_LISTEN_HOST: "0.0.0.0",
  HERDR_LISTEN_PORT: "9000",
  HERDR_MAX_READ_BYTES: "1024",
  HERDR_COMMAND: "herdr-dev",
};

describe("loadConfig", () => {
  test("rejects missing peer configuration", () => {
    expect(() => loadConfig({ HOME: "/home/bridge" })).toThrow(/HERDR_ALLOWED_PEER_ADDRESS/);
  });

  test("rejects a projects root outside the configured home directory", () => {
    expect(() =>
      loadConfig({
        HOME: "/home/bridge",
        HERDR_ALLOWED_PEER_ADDRESS: "100.64.1.3",
        HERDR_PROJECTS_ROOT: "/tmp/projects",
      }),
    ).toThrow(/HERDR_PROJECTS_ROOT/);
  });

  test("rejects a port outside the valid range", () => {
    expect(() =>
      loadConfig({
        HOME: "/home/bridge",
        HERDR_ALLOWED_PEER_ADDRESS: "100.64.1.3",
        HERDR_LISTEN_PORT: "65536",
      }),
    ).toThrow(/port/i);
  });

  test("applies the bounded-read default", () => {
    expect(loadConfig({ ...completeEnvironment, HERDR_MAX_READ_BYTES: undefined })).toMatchObject({
      maxReadBytes: 65536,
      maxResponseBytes: 131072,
    });
  });

  test.each(["", "not-a-number", "Infinity", "0", "-1", "1.5"])(
    "rejects an invalid max read byte value: %s",
    (maxReadBytes) => {
      expect(() =>
        loadConfig({
          ...completeEnvironment,
          HERDR_MAX_READ_BYTES: maxReadBytes,
        }),
      ).toThrow(/HERDR_MAX_READ_BYTES/);
    },
  );

  test("accepts a complete environment", () => {
    expect(loadConfig(completeEnvironment)).toEqual({
      projectsRoot: "/home/bridge/projects",
      listenHost: "0.0.0.0",
      listenPort: 9000,
      allowedPeerAddress: "100.64.1.3",
      maxReadBytes: 1024,
      maxResponseBytes: 66560,
      herdrCommand: "herdr-dev",
    });
  });
});
