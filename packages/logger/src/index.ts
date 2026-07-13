import pino from "pino";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogMethod = (msg: string, meta?: Record<string, unknown>) => void;

export interface Logger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  child: (bindings: Record<string, unknown>) => Logger;
}

const isDev = process.env.NODE_ENV !== "production";

export function createLogger(scope: string): Logger {
  const instance = pino({
    name: scope,
    level: process.env.LOG_LEVEL ?? "info",
    ...(isDev && {
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l" } },
    }),
  });
  const call = (level: LogLevel, msg: string, meta?: Record<string, unknown>) =>
    (instance[level] as (m: object, msg: string) => void)(meta ?? {}, msg);
  return {
    debug: (msg, meta) => call("debug", msg, meta),
    info: (msg, meta) => call("info", msg, meta),
    warn: (msg, meta) => call("warn", msg, meta),
    error: (msg, meta) => call("error", msg, meta),
    child: (bindings) => {
      const child = instance.child(bindings);
      const c = (level: LogLevel, m: string, mt?: Record<string, unknown>) =>
        (child[level] as (m: object, msg: string) => void)(mt ?? {}, m);
      return {
        debug: (m, mt) => c("debug", m, mt),
        info: (m, mt) => c("info", m, mt),
        warn: (m, mt) => c("warn", m, mt),
        error: (m, mt) => c("error", m, mt),
        child: (b) => createLogger(`${scope}:${JSON.stringify(b)}`),
      };
    },
  };
}
