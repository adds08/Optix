# STInventory — Diagrams

All diagrams are Mermaid (render in GitHub, VS Code with a Mermaid extension, or any
Mermaid live editor). Grouped by concern: domain, lifecycle, custody flows, procurement,
architecture, and SaaS multi-tenancy.

---

## 1. Entity relationship — as built

Tables that exist in `packages/db/src/schema/`. Physical names are singular and snake_case.
The planned-but-unbuilt procurement and maintenance tables are in §1b.

```mermaid
erDiagram
    CATEGORY ||--o{ ASSET_MODEL : classifies
    MANUFACTURER ||--o{ ASSET_MODEL : makes
    ASSET_MODEL ||--o{ ASSET : "spec for"
    ASSET ||--o{ TRANSACTION : "logs"
    ASSET ||--o{ ASSIGNMENT : "held via"
    ASSET ||--o{ TRANSFER : "moved by"
    ASSET ||--o{ TASK : "referenced by"
    EMPLOYEE ||--o{ ASSIGNMENT : "custodian of"
    EMPLOYEE ||--o{ EMPLOYEE : "reports to"
    PROJECT ||--o{ ASSIGNMENT : "site of"
    PROJECT ||--o{ PROJECT_PHASE : "has"
    PROJECT ||--o{ ASSET : "owns (financial)"
    LOCATION ||--o{ ASSIGNMENT : "located at"
    LOCATION ||--|| VEHICLE : "is a moving"
    LOCATION ||--o{ LOCATION : "nests"
    WAREHOUSE ||--o{ LOCATION : "contains"
    CHANNEL ||--o{ MESSAGE : "holds"
    MESSAGE ||--o{ TRANSACTION : "produces on confirm"
    EMPLOYEE ||--o{ NOTIFICATION : "receives"

    ASSET {
        uuid id PK
        uuid tenant_id FK
        string tag
        uuid model_id FK
        string model_name "denormalized"
        uuid owning_project_id FK "who paid"
        string current_status "projection"
        uuid current_custodian_id FK "projection"
        uuid current_project_id FK "who uses"
        uuid current_location_id FK "projection"
    }
    TRANSACTION {
        bigint id PK
        uuid asset_id FK
        string event_type
        jsonb from_state
        jsonb to_state
        string ref_type
        timestamp occurred_at
    }
    ASSIGNMENT {
        uuid id PK
        uuid asset_id FK
        uuid custodian_id FK
        uuid project_id FK
        string type "permanent|temporary"
        string status "incl. pending_approval"
        date expected_end_date
    }
    MESSAGE {
        uuid id PK
        uuid channel_id FK
        string body
        string processing_status
        string intent_type
        jsonb proposed_action
        jsonb executed_transaction_ids
    }
    VEHICLE {
        uuid id PK
        uuid location_id FK
        string vehicle_type "truck|trailer"
        string unit
        string ownership_type
        numeric gps_lat
        numeric gps_lng
    }
```

Identity and RBAC sit alongside the domain, keyed by `tenant`:

```mermaid
erDiagram
    TENANT ||--o{ USER : "has"
    TENANT ||--o{ ROLE : "has (null = system role)"
    TENANT ||--|| TENANT_SETTINGS : "configured by"
    USER ||--o{ SESSION : "authenticates via"
    USER ||--o{ USER_ROLE : "granted"
    ROLE ||--o{ USER_ROLE : "granted to"
    ROLE ||--o{ ROLE_PERMISSION : "allows"
    PERMISSION ||--o{ ROLE_PERMISSION : "granted by"
    TENANT ||--o{ EVENT_LOG : "audits"
```

> `user.employee_id` is a plain uuid with **no FK**, to keep the schema import graph acyclic;
> the link is resolved in the API layer. `event_log` is generic access audit — the domain
> system of record is `TRANSACTION`.

## 1b. Entity relationship — planned, not built

No migration exists for any of these. See `03-data-model.md` Part B.

```mermaid
erDiagram
    VENDOR ||--o{ PURCHASE_ORDER : "fulfills"
    VENDOR ||--o{ MAINTENANCE_RECORD : "repairs"
    PURCHASE_REQUEST ||--o{ PURCHASE_ORDER : "becomes"
    PURCHASE_REQUEST ||--o{ PURCHASE_REQUEST_LINE : "has"
    PURCHASE_ORDER ||--o{ PURCHASE_ORDER_LINE : "has"
    ASSET_MODEL ||--o{ PURCHASE_REQUEST_LINE : "ordered as"
    ASSET ||--o{ MAINTENANCE_RECORD : "serviced by"
    ASSET ||--o{ INSPECTION : "checked by"
```

## 2. Asset lifecycle (state machine)

```mermaid
stateDiagram-v2
    [*] --> Requested
    Requested --> Approved : PR approved
    Approved --> OnOrder : PO issued
    OnOrder --> Received : delivered
    Received --> Available : inspect + tag
    Available --> Reserved : reserve for project
    Reserved --> Assigned : assign custodian
    Available --> Assigned : assign custodian
    Assigned --> InTransit : transfer
    InTransit --> Assigned : transfer complete
    Assigned --> Available : return to warehouse
    Assigned --> InMaintenance : damage/repair
    Available --> InMaintenance : preventive/calibration
    InMaintenance --> Available : repair complete
    Assigned --> Lost : marked missing
    Available --> Lost : marked missing
    Lost --> Available : found
    Available --> Disposed : end of life
    Lost --> Disposed : written off
    Disposed --> [*]
```

## 3. Custody model (who/what/where)

```mermaid
flowchart LR
    ED[Equipment Department<br/>owns all assets]
    ED -->|Assignment| F[Foreman<br/>custodian]
    F -->|deployed to| P[Current Project + Phase]
    F -->|physically at| L[Location<br/>warehouse/container/gangbox/vehicle]
    ED -.->|charged to<br/>financial owner| OP[Owning Project]
    note1[owning_project ≠ current_project:<br/>who paid vs who uses]
    OP -.- note1
    P -.- note1
```

## 4. Scenario — foreman on multiple projects

```mermaid
flowchart TD
    F[Foreman: Miguel Torres]
    F --> A1[Assignment 1<br/>Hilti TE 60 → Legacy West → active]
    F --> A2[Assignment 2<br/>Generator → Trinity Bridge → active]
    F --> PP[primary_project = Legacy West]
    A1 --> L1[Location: Gang Box A]
    A2 --> L2[Location: Truck 12]
    note[Tools do NOT all move when the<br/>foreman changes sites — each<br/>assignment tracks its own project + location]
    A1 -.- note
    A2 -.- note
```

## 5. Scenario — HR offboarding / foreman fired

```mermaid
sequenceDiagram
    participant HR as HR (BambooHR)
    participant SYS as STInventory
    participant EQ as Equipment Admin
    participant FM as Foreman
    HR->>SYS: employee.terminated event
    SYS->>SYS: build clearance queue<br/>(all assets held by foreman)
    SYS->>EQ: notification: clearance_required
    EQ->>FM: schedule return / inspect
    loop each outstanding asset
        EQ->>SYS: inspect asset
        alt returned
            EQ->>SYS: return → Available (transaction: return)
        else transfer to new foreman
            EQ->>SYS: transfer → new custodian (transaction: transfer)
        else unaccounted
            EQ->>SYS: mark Lost (transaction: lost) + investigation
        end
    end
    SYS->>HR: clearance complete (or blocked list)
    Note over SYS,HR: offboarding sign-off blocked<br/>until queue is empty
```

## 6. Scenario — project complete / phase change

```mermaid
flowchart TD
    PC[Project Complete or Phase Ends]
    PC --> REV[Review all assets on project/phase]
    REV --> Q{Per asset decision}
    Q -->|foreman continues| MOVE[Move with foreman<br/>transfer project_change]
    Q -->|no longer needed| RET[Return to warehouse<br/>→ Available]
    Q -->|needed elsewhere| XFER[Transfer to other<br/>project/foreman]
    Q -->|damaged| REP[Send to maintenance]
    MOVE --> DONE[History retained]
    RET --> DONE
    XFER --> DONE
    REP --> DONE
```

## 7. Procurement workflow (BPMN-style)

```mermaid
flowchart LR
    S([Project Awarded]) --> D[Estimate Tool Demand<br/>from templates + phase]
    D --> C{Inventory<br/>available?}
    C -->|Yes| R[Reserve existing]
    C -->|Partial/No| PR[Purchase Request]
    PR --> AP{Approved?}
    AP -->|No| REJ([Rejected])
    AP -->|Yes| PO[Purchase Order → Vendor]
    PO --> RC[Receive]
    RC --> IN[Inspect]
    IN --> TG[Tag / QR]
    TG --> AS[Assign custodian]
    R --> AS
    AS --> E([In service])
```

## 8. Deployment architecture (as built)

Dashed edges are planned and have no code behind them.

```mermaid
flowchart TB
    subgraph Client
        WEB["Web — Next.js 15<br/>:3100"]
        MOB["Mobile — Expo Router<br/>shell only; scan flows planned"]
    end
    subgraph API["API — Hono :4100"]
        TRPC[tRPC routers]
        AUTH[Auth + RBAC<br/>Lucia-style sessions]
        NOTIF[Notification scheduler]
        WORK[Messaging worker<br/>4s poll]
    end
    subgraph ENG["Intent engine — FastAPI :4600"]
        PARSE["POST /parse"]
        LLM[OpenAI-compatible<br/>LLM endpoint]
    end
    subgraph Data
        PG[("Postgres 16 :5433<br/>transaction = source of truth")]
        PROJ["Projections: asset.current_*"]
    end
    subgraph Integrations
        FS[FoundationSoft<br/>cost/charge-back]
        HR[BambooHR<br/>employee + termination]
        HCSS[HCSS<br/>equipment/telemetry]
    end
    WEB -->|tRPC| TRPC
    MOB -->|"tRPC (ADR-2)"| TRPC
    TRPC --> AUTH
    TRPC --> PG
    WORK --> PG
    NOTIF --> PG
    WORK -->|HTTP| PARSE
    PARSE --> LLM
    PG --> PROJ
    TRPC <-.-> FS
    HR -.-> TRPC
    TRPC <-.-> HCSS
```

> The engine is **not** in `docker-compose.yml` (postgres, api, web only). In a containerized
> run the worker cannot reach it and every message falls to `pending_manual`.

## 9. SaaS multi-tenancy

```mermaid
flowchart TB
    subgraph Tenants
        T1[Urban Infraconstruction<br/>customer-zero]
        T2[Pilot Co. B]
        T3[Pilot Co. C]
    end
    T1 & T2 & T3 --> GW[Shared API gateway<br/>tenant resolver]
    GW --> APP[STInventory app<br/>tenant_id scoped]
    APP --> DB[(Postgres<br/>row-level tenant_id + RLS)]
    APP --> S3[(Object store<br/>photos/docs per tenant)]
    Note[Each row carries tenant_id.<br/>RLS enforces isolation.<br/>Same schema as Mark 85 multi-tenant model.]
    DB -.- Note
```

## 10. Chat message → custody transaction

The core loop of the conversational layer (`07-conversational-layer.md`). Note that the LLM
returns **raw text spans only** — resolution to database IDs happens in the API, tenant-scoped,
which is why a hallucinated identifier cannot address a real row.

```mermaid
sequenceDiagram
    participant FM as Foreman
    participant API as API (tRPC)
    participant DB as Postgres
    participant W as Messaging worker
    participant E as Intent engine
    participant ADM as Admin

    FM->>API: messaging.send("gave UIC-1012 to Dwayne for Trinity Bridge")
    API->>DB: insert message (processing_status = queued)
    W->>DB: claim batch of 5 → processing
    W->>DB: build context (employee, active assignments, recent messages)
    W->>E: POST /parse { message, context }
    E-->>W: { intent, confidence, entities (raw spans), needsConfirmation }

    alt intent = task
        W->>DB: insert task → action_executed
    else confidence < 0.6 or no asset resolves
        W->>DB: processing_status = pending_manual
        ADM->>API: messaging.manualEntry(resolved entities)
        API->>DB: write domain rows → action_executed
    else resolved
        W->>DB: resolve spans → IDs (tenant-scoped)
        W->>DB: proposed_action + action_proposed
        FM->>API: messaging.confirmAction(messageId)
        API->>DB: insert assignment / transfer
        API->>DB: append transaction (from_state → to_state)
        API->>DB: update asset.current_* projection
        API->>DB: event_log (category = messaging)
        API-->>FM: confirmed + transactionIds
    end
```

> Gap to be aware of when reading this diagram: `confirmAction` implements only `assign`,
> `return`, and `transfer`. A confirmed `repair` or `lost` writes nothing yet still reports
> success — see `07-conversational-layer.md` §7.

## 11. How current-state is derived (event fold)

```mermaid
flowchart LR
    subgraph Log[transactions - append only]
        E1[purchase] --> E2[receive] --> E3[tag] --> E4[assign] --> E5[transfer] --> E6[return]
    end
    Log --> FOLD[fold / reducer]
    FOLD --> STATE[assets.current_status<br/>current_custodian<br/>current_project<br/>current_location]
    Log --> AUDIT[Audit trail = the log itself]
    Log --> REP[Reports: utilization,<br/>idle, lost, cost allocation]
```
