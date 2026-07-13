# STInventory — Diagrams

All diagrams are Mermaid (render in GitHub, VS Code with a Mermaid extension, or any
Mermaid live editor). Grouped by concern: domain, lifecycle, custody flows, procurement,
architecture, and SaaS multi-tenancy.

---

## 1. Entity relationship (core)

```mermaid
erDiagram
    CATEGORIES ||--o{ MODELS : classifies
    MANUFACTURERS ||--o{ MODELS : makes
    MODELS ||--o{ ASSETS : "spec for"
    ASSETS ||--o{ TRANSACTIONS : "logs"
    ASSETS ||--o{ ASSIGNMENTS : "held via"
    ASSETS ||--o{ MAINTENANCE_RECORDS : "serviced by"
    ASSETS ||--o{ INSPECTIONS : "checked by"
    EMPLOYEES ||--o{ ASSIGNMENTS : "custodian of"
    PROJECTS ||--o{ ASSIGNMENTS : "site of"
    PROJECTS ||--o{ PROJECT_PHASES : "has"
    PROJECTS ||--o{ ASSETS : "owns (financial)"
    LOCATIONS ||--o{ ASSIGNMENTS : "located at"
    WAREHOUSES ||--o{ LOCATIONS : "contains"
    VENDORS ||--o{ PURCHASE_ORDERS : "fulfills"
    VENDORS ||--o{ MAINTENANCE_RECORDS : "repairs"
    PURCHASE_REQUESTS ||--o{ PURCHASE_ORDERS : "becomes"
    PURCHASE_REQUESTS ||--o{ PURCHASE_REQUEST_LINES : "has"
    ASSETS ||--o{ TRANSFERS : "moved by"

    ASSETS {
        uuid id PK
        string tag
        uuid model_id FK
        uuid owning_project_id FK
        string current_status
        uuid current_custodian_id FK
        uuid current_project_id FK
        uuid current_location_id FK
    }
    TRANSACTIONS {
        bigint id PK
        uuid asset_id FK
        string event_type
        jsonb from_state
        jsonb to_state
        timestamp occurred_at
    }
    ASSIGNMENTS {
        uuid id PK
        uuid asset_id FK
        uuid custodian_id FK
        uuid project_id FK
        string type
        string status
        date expected_end_date
    }
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

## 8. Deployment architecture (prototype → production)

```mermaid
flowchart TB
    subgraph Client
        WEB[Web app<br/>UR-style dashboard]
        MOB[Mobile<br/>QR scan / offline]
    end
    subgraph API[API layer]
        HONO[REST/RPC API<br/>Hono/Node]
        AUTH[Auth + RBAC]
    end
    subgraph Data
        PG[(Postgres<br/>transactions = source of truth)]
        PROJ[Projections / views]
    end
    subgraph Integrations
        FS[FoundationSoft<br/>cost/charge-back]
        HR[BambooHR<br/>employee + termination]
        HCSS[HCSS<br/>equipment/telemetry]
    end
    WEB --> HONO
    MOB --> HONO
    HONO --> AUTH
    HONO --> PG
    PG --> PROJ
    HONO <--> FS
    HR --> HONO
    HONO <--> HCSS
```

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

## 10. How current-state is derived (event fold)

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
