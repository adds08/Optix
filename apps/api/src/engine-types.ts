// Shared types matching the Python engine's /parse request/response.
// The engine is stateless and returns labels/raw text spans only — no DB IDs.
// The API's entity-resolve layer maps these to DB IDs.

export type EngineIntent =
  | "transfer"
  | "assign"
  | "return"
  | "lost"
  | "repair"
  | "request_purchase"
  | "report"
  | "none";

export type EngineEntityAsset = { label: string; raw: string };
export type EngineEntityDestination = { kind: "employee" | "location" | "project"; raw: string };
export type EngineEntityCustodian = { raw: string };
export type EngineEntityProject = { raw: string };

export type EngineEntities = {
  assets: EngineEntityAsset[];
  destination: EngineEntityDestination | null;
  custodian: EngineEntityCustodian | null;
  project: EngineEntityProject | null;
};

export type EngineParseRequest = {
  message: string;
  context: {
    foremanName: string;
    foremanRole: string;
    currentAssignments: { tag: string; model: string; project: string; location: string }[];
    primaryProject: string;
    currentLocation: string;
    recentMessages: string[];
  };
};

export type EngineParseResponse = {
  intent: EngineIntent;
  confidence: number;
  entities: EngineEntities;
  actionPayload: Record<string, unknown>;
  needsConfirmation: boolean;
  replyText: string;
};
