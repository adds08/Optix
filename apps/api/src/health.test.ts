import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/*
  /health must not be able to lie.

  It returned `{ok:true}` unconditionally until 2026-09-14 — no database check,
  no worker check. Two consequences, and the second is the expensive one:

    An uptime monitor pointed at it would report a healthy service while the
    connection pool was dead and the product served nothing.

    `docker/deploy.sh` waits for exactly this endpoint before declaring a
    deploy successful, and rolls back if it never comes up. So a deploy that
    broke the database connection would pass its own health gate.

  These are source assertions rather than a live HTTP test because the live
  behaviour needs a running stack AND a way to break the database from inside
  the test, and the thing worth protecting is the SHAPE of the contract: that a
  database failure produces a non-200, and that the workers are reported at all.
  Both were verified by hand against the running stack on 2026-09-14 — stopping
  Postgres produced `503 {"ok":false,"db":"down"}` and starting it recovered to
  200 within three seconds.
*/
const SRC = new URL("./index.ts", import.meta.url).pathname;

describe("the health endpoint", () => {
  const src = readFileSync(SRC, "utf8");
  const handler = src.slice(src.indexOf('app.get("/health"'), src.indexOf('app.get("/health"') + 3000);

  it("checks the database rather than asserting ok", () => {
    /* The whole defect in one line: it used to be
       `app.get("/health", (c) => c.json({ ok: true, ... }))`. */
    expect(handler).toMatch(/select 1/);
    expect(handler, "the handler must be async to await the database").toMatch(/async \(c\)/);
  });

  it("returns a non-200 when the database is down", () => {
    /* An uptime monitor keys on the status code, not the body. A 200 carrying
       `{"db":"down"}` is worse than useless — it is a monitor that never
       fires. */
    expect(handler).toMatch(/503/);
  });

  it("reports the workers, which fail silently by design", () => {
    /* All five loops catch their own errors and log, so one bad tick cannot
       kill the process. The cost is that a worker throwing on EVERY tick is
       invisible: if the messaging worker stops, foremen's chat requests queue
       forever with no signal. */
    expect(handler).toMatch(/workers/);
    expect(handler).toMatch(/stale/);
  });

  it("has a heartbeat stamped by every worker it reports", () => {
    /* A reported worker with nothing stamping it reads "not yet run" forever,
       which is indistinguishable from a worker that died at boot. */
    const intervals = src.slice(
      src.indexOf("const WORKER_INTERVALS_MS"),
      src.indexOf("}", src.indexOf("const WORKER_INTERVALS_MS")),
    );
    const reported = [...intervals.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]!);
    expect(reported.length, "no workers are declared").toBeGreaterThan(0);

    const unstamped = reported.filter((w) => !src.includes(`workerHeartbeat.${w} = Date.now()`));
    expect(
      unstamped,
      `these workers are reported by /health but nothing stamps them: ${unstamped.join(", ")}. ` +
        "They would read 'not yet run' forever, which looks identical to a worker that died.",
    ).toEqual([]);
  });
});
