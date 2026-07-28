// Shared types matching the Python engine's /parse request/response.
// The engine is stateless and returns labels/raw text spans only — no DB IDs.
// The API's entity-resolve layer maps these to DB IDs.

export type EngineIntent =
  | "transfer"
  | "assign"
  | "return"
  | "lost"
  | "repair"
  | "intake"
  | "request_purchase"
  | "report"
  | "task"
  | "none";

/* Fields for a tool that is not in the register yet. Every one is optional —
   the model is instructed to leave a field null rather than invent a tag or a
   serial, so a partial draft is the expected case, not a failure. */
export type EngineAssetDraft = {
  tag: string | null;
  modelName: string | null;
  serialNumber: string | null;
  categoryName: string | null;
  acquisitionCost: string | null;
};

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

export type EngineLlmConfig = {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
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
  /* Per-request model configuration, read from tenant_settings. Omitted when
     the tenant has not configured one, in which case the engine falls back to
     its own environment. */
  llm?: EngineLlmConfig;
};

export type EngineParseResponse = {
  intent: EngineIntent;
  confidence: number;
  entities: EngineEntities;
  /* Populated for `intake` only; null for every other intent. */
  draft: EngineAssetDraft | null;
  actionPayload: Record<string, unknown>;
  needsConfirmation: boolean;
  replyText: string;
};
