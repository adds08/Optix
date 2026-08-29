// Schema barrel. Import order matters only for the self-referencing tables which use
// lazy references (category, location) — those are fine here.
export * from "./identity";
export * from "./catalog";
export * from "./project";
export * from "./department";
/* Reference data (units of measure, company roles). Before ./employee, which
   references companyRole. */
export * from "./reference";
export * from "./location";
export * from "./employee";
export * from "./asset";
export * from "./event";
export * from "./audit";
export * from "./messaging";
export * from "./task";
export * from "./projectGroup";
export * from "./feature";
