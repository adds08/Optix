// Schema barrel. Import order matters only for the self-referencing tables which use
// lazy references (category, location) — those are fine here.
export * from "./identity";
export * from "./catalog";
export * from "./project";
export * from "./department";
export * from "./location";
export * from "./employee";
export * from "./asset";
export * from "./event";
export * from "./audit";
export * from "./messaging";
export * from "./task";
export * from "./rental";
