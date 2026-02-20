import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

let emitSpawnError = true;

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: () => {
      const child = new EventEmitter() as {
        stdout?: Readable;
        stderr?: Readable;
      } & EventEmitter;
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      queueMicrotask(() => {
        if (emitSpawnError) {
          child.emit("error", new Error("spawn docker ENOENT"));
          return;
        }
        child.emit("close", 0);
      });
      return child;
    },
  };
});

describe("execDocker spawn error handling", () => {
  beforeEach(() => {
    emitSpawnError = true;
  });

  it("rejects when docker spawn fails and allowFailure is false", async () => {
    const { execDocker } = await import("./sandbox/docker.js");
    await expect(execDocker(["version"])).rejects.toThrow("spawn docker ENOENT");
  });

  it("returns a non-zero result when docker spawn fails and allowFailure is true", async () => {
    const { execDocker } = await import("./sandbox/docker.js");
    const result = await execDocker(["version"], { allowFailure: true });
    expect(result.code).toBe(127);
    expect(result.stderr).toContain("spawn docker ENOENT");
  });
});
