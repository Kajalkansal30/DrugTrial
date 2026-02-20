# Clinical Trial Automation Platform

**AI-powered end-to-end clinical trial automation — from protocol upload to patient recruitment — with built-in drug safety modeling, running on local LLMs for complete data privacy.**

---

## Overview

The Clinical Trial Automation Platform transforms clinical trial protocol PDFs into actionable intelligence within minutes. Upload a protocol and the system will extract FDA regulatory forms, assess drug safety through computational modeling, discover biological targets from scientific literature, parse eligibility criteria using NLP, and screen patients against those criteria — all on-premise with zero data leaving your infrastructure.

The platform orchestrates **13 specialized AI agents** across four intelligence subsystems, coordinated by an autonomous event-driven orchestrator. Every action is logged in a cryptographic, hash-chained audit trail aligned with 21 CFR Part 11 principles.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **FDA Form Extraction** | Automatically extracts and populates IND Form 1571 and Investigator Form 1572 from protocol PDFs using LLM + SciSpaCy |
| **InSilico Drug Safety** | Resolves molecular structures via PubChem, runs Lipinski's Rule of 5 toxicity analysis with RDKit, checks drug-drug interactions, and simulates PK/PD concentration curves |
| **Research Intelligence (LTAA)** | Mines PubMed literature, extracts biological targets with UMLS entity linking, validates against HGNC/UniProt, and builds a Neo4j knowledge graph with weighted evidence scoring |
| **Eligibility Criteria Extraction** | NLP + LLM pipeline extracts 30–50 structured criteria per protocol with type, category, operator, value, unit, and negation detection |
| **Patient Screening** | 15+ category-specific rule engines screen entire cohorts with confidence scores and per-criterion reasoning |
| **HIPAA De-identification** | Pseudonymized patient IDs (SHA-256), age generalization, city redaction, PII vault separation via DeIDAgent |
| **Cryptographic Audit Trail** | SHA-256 hash-chained, tamper-evident logging of every agent action with document integrity verification |
| **Local LLM** | Llama 3.1 via Ollama — no API costs, no data exfiltration, air-gap capable |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (React + Material UI)                │
│  UploadPage → FDAProcessingPage → CriteriaPage → ScreeningPage │
│              AuditTrailPage │ PrivacyAuditPage                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS
                     ┌──────┴──────┐
                     │    Nginx    │
                     └──────┬──────┘
                            │
┌───────────────────────────┴─────────────────────────────────────┐
│                    Backend (FastAPI + Python)                     │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │  FDA Router  │  │ Trials Router │  │ InSilico / LTAA Router │ │
│  │  Audit Router│  │ Chat Router   │  │ Privacy Router         │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬──────────────┘ │
│         │                │                      │                 │
│  ┌──────┴────────────────┴──────────────────────┴──────────────┐ │
│  │                    13 AI Agents                              │ │
│  │                                                              │ │
│  │  Document Intelligence    Research Intelligence              │ │
│  │  ├─ FDAProcessor          └─ LTAAAgent                      │ │
│  │  └─ ProtocolRuleAgent        (PubMed, HGNC, UniProt, Neo4j)│ │
│  │                                                              │ │
│  │  InSilico Modeling        Patient Intelligence               │ │
│  │  ├─ DrugExtractionAgent   ├─ EligibilityMatcher             │ │
│  │  ├─ ChemicalResolver     ├─ DeIDAgent                       │ │
│  │  ├─ ToxicityAgent        └─ MedicalNLPAgent                 │ │
│  │  ├─ DDIAgent                                                 │ │
│  │  ├─ MolecularTargetAgent  Orchestration                     │ │
│  │  └─ PKPDSimulator         ├─ TrialOrchestrator              │ │
│  │                           ├─ EventBus                        │ │
│  │                           └─ ChatAgent                       │ │
│  └──────────────────────────────────────────────────────────────┘ │
└──────────┬──────────────┬──────────────┬────────────────────────┘
           │              │              │
    ┌──────┴──────┐ ┌────┴─────┐ ┌─────┴──────┐
    │ PostgreSQL  │ │  Neo4j   │ │   Ollama   │
    │  (Neon DB)  │ │ KG Graph │ │ Llama 3.1  │
    └─────────────┘ └──────────┘ └────────────┘
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18, Material UI 5, Recharts | Dashboard, wizard interface, data visualization |
| **Reverse Proxy** | Nginx | Routing, SSL termination |
| **Backend** | FastAPI, Python 3.10 | REST API, background tasks, agent coordination |
| **LLM** | Ollama + Llama 3.1 (8B) | Protocol analysis, form extraction, criteria normalization |
| **Medical NLP** | SciSpaCy, UMLS Linker, NegEx | Biomedical entity recognition (3M+ concepts) |
| **Cheminformatics** | RDKit | Molecular descriptors, Lipinski analysis, SMILES parsing |
| **Chemical Database** | PubChem (via pubchempy) | Drug name to molecular structure resolution |
| **Literature** | Biopython, NCBI Entrez | PubMed abstract fetching and parsing |
| **Bio Validation** | HGNC REST, UniProt REST | Gene/protein validation against authoritative databases |
| **Knowledge Graph** | Neo4j 5.12 | Disease-target evidence graph with weighted scoring |
| **Primary Database** | PostgreSQL (Neon) | Trials, patients, criteria, forms, audit logs |
| **Containerization** | Docker Compose | Full-stack orchestration with NVIDIA GPU passthrough |
| **GPU** | NVIDIA CUDA 12.4 | LLM inference acceleration |

---

## Product Workflow

The platform guides users through a **4-step wizard**:

### Step 1 — Upload Protocol
Upload a clinical trial protocol PDF. The system saves the file, computes a SHA-256 document hash, and begins FDA form extraction in the background. LTAA and InSilico analyses start immediately using the extracted indication and drug name.

### Step 2 — Review FDA Forms
View auto-populated FDA Form 1571 (IND) and Form 1572 (Investigator). Switch between tabs to see Research Intelligence (biological targets from PubMed) and InSilico Modeling (drug safety profile, PK/PD curves, DDI warnings). Edit fields, mark as reviewed, and e-sign.

### Step 3 — Analyze Criteria
NLP + LLM extract structured eligibility criteria from the protocol. Each criterion includes type (inclusion/exclusion), category, operator, value, unit, negation flag, and UMLS concept links.

### Step 4 — Patient Screening
The entire patient cohort is screened against all criteria. Each patient receives an eligibility status, confidence score, and per-criterion breakdown explaining why each criterion was met or not.

---

## Project Structure

```
DrugTrial/
├── app.py                          # FastAPI main entry point
├── load_patients.py                # CSV patient loader with de-identification
├── docker-compose.yml              # Service orchestration
├── requirements.txt                # Python dependencies
│
├── backend/
│   ├── Dockerfile                  # CUDA + Ollama + Python image
│   ├── start.sh                    # Ollama + FastAPI startup script
│   ├── main.py                     # Backend initialization
│   ├── db_models.py                # SQLAlchemy models
│   ├── events.py                   # Event bus (pub/sub)
│   ├── nlp_utils.py                # NLP utilities
│   │
│   ├── agents/
│   │   ├── orchestrator.py         # Trial Orchestrator (plans & dispatches)
│   │   ├── fda_processor.py        # FDA form extraction agent
│   │   ├── protocol_rule_agent.py  # Eligibility criteria extraction
│   │   ├── ltaa_agent.py           # Literature & Target Analysis Agent
│   │   ├── eligibility_matcher.py  # Patient screening engine
│   │   ├── deid_agent.py           # HIPAA de-identification agent
│   │   ├── medical_nlp_agent.py    # Medical NLP processing
│   │   ├── chat_agent.py           # Conversational trial Q&A
│   │   └── insilico/
│   │       ├── drug_extraction_agent.py  # Drug/dosage identification
│   │       ├── chemical_resolver.py      # PubChem molecular resolution
│   │       ├── toxicity_agent.py         # RDKit Lipinski toxicity
│   │       ├── ddi_agent.py              # Drug-drug interactions
│   │       ├── molecular_target_agent.py # Protein/gene targets
│   │       └── pkpd_simulator.py         # PK/PD concentration modeling
│   │
│   ├── routers/
│   │   ├── fda_router.py           # /api/fda/* endpoints
│   │   ├── trials.py               # /api/trials/* endpoints
│   │   ├── insilico_router.py      # /api/insilico/* endpoints
│   │   ├── ltaa_router.py          # /api/ltaa/* endpoints
│   │   ├── audit_router.py         # /api/audit/* endpoints
│   │   ├── privacy_router.py       # /api/privacy/* endpoints
│   │   └── chat_router.py          # /api/chat/* endpoints
│   │
│   ├── utils/
│   │   ├── auditor.py              # SHA-256 hash-chained audit logger
│   │   ├── bio_validator.py        # HGNC/UniProt validation
│   │   ├── bio_nlp.py              # SciSpaCy entity extraction
│   │   ├── bio_filters.py          # Entity filtering and deduplication
│   │   ├── pubmed_connector.py     # PubMed/NCBI Entrez integration
│   │   ├── graph_builder.py        # Neo4j knowledge graph builder
│   │   ├── ocr_processor.py        # OCR for scanned PDFs
│   │   └── pdf_ingest.py           # PDF text extraction
│   │
│   └── database/
│       └── init.sql                # PostgreSQL schema initialization
│
├── frontend/
│   ├── Dockerfile                  # Nginx-served React build
│   ├── nginx.conf                  # Frontend proxy configuration
│   ├── package.json
│   └── src/
│       ├── App.js                  # React router and layout
│       ├── pages/
│       │   ├── UploadPage.js       # Step 1: Protocol upload
│       │   ├── FDAProcessingPage.js# Step 2: FDA form review
│       │   ├── CriteriaPage.js     # Step 3: Criteria extraction
│       │   ├── ScreeningPage.js    # Step 4: Patient screening
│       │   ├── AuditTrailPage.js   # Audit trail viewer
│       │   └── PrivacyAuditPage.js # Privacy compliance dashboard
│       └── components/
│           ├── InSilicoDashboard.js
│           └── ...
│
└── data/
    └── sample_patients/            # Source CSV files (50 patients)
        ├── patients.csv
        ├── conditions.csv
        ├── medications.csv
        ├── observations.csv
        ├── allergies.csv
        └── immunizations.csv
```

---

## Getting Started

### Prerequisites

- **Docker** with Docker Compose v2
- **NVIDIA GPU** with CUDA 12.4+ drivers (for LLM inference)
- **NVIDIA Container Toolkit** (`nvidia-docker2`)
- At least **16 GB GPU VRAM** for Llama 3.1 8B

### 1. Clone and Start

```bash
git clone <repository-url>
cd DrugTrial
docker compose up -d --build
```

The first build takes 10–15 minutes as it downloads the CUDA base image, installs SciSpaCy models, and pulls the UMLS knowledge base.

### 2. Wait for Services

```bash
# Check backend health (Ollama + model pull happens on first boot)
docker compose logs -f backend

# Verify all services are running
docker compose ps
```

| Service | Port | Health Check |
|---------|------|-------------|
| Backend (FastAPI + Ollama) | 8201 | `GET /health` |
| Frontend (React via Nginx) | 3000 | HTTP 200 |
| PostgreSQL | 5435 | `pg_isready` |
| Neo4j | 7474 (HTTP), 7687 (Bolt) | Browser at `:7474` |

### 3. Load Patient Data

Patient data is loaded from CSVs with automatic HIPAA-compliant de-identification:

```bash
python load_patients.py
```

This reads `data/sample_patients/*.csv`, runs each patient through the DeIDAgent (pseudonymization, age generalization, PII vault separation), and inserts de-identified records into the database. Original PII is stored separately in the `patient_vault` table.

### 4. Access the Application

| Interface | URL |
|-----------|-----|
| **Web Dashboard** | http://localhost:3000 |
| **API Documentation** | http://localhost:8201/docs |
| **Neo4j Browser** | http://localhost:7474 |

---

## API Reference

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/fda/upload` | Upload a protocol PDF and start extraction |
| `GET` | `/api/fda/documents` | List all uploaded documents |
| `GET` | `/api/fda/documents/{id}/status` | Poll extraction progress |
| `GET` | `/api/fda/forms/{id}` | Get extracted FDA forms for a document |
| `POST` | `/api/fda/documents/{id}/create-trial` | Create a clinical trial from a document |
| `POST` | `/api/trials/{trial_id}/extract-criteria` | Extract eligibility criteria |
| `GET` | `/api/trials/{trial_id}/criteria-status` | Poll criteria extraction progress |
| `GET` | `/api/trials/{trial_id}/rules` | Get extracted criteria |
| `POST` | `/api/trials/{trial_id}/batch-check` | Screen all patients against criteria |
| `GET` | `/api/ltaa/{trial_id}` | Get LTAA research intelligence results |
| `GET` | `/api/insilico/{trial_id}` | Get InSilico drug safety results |
| `GET` | `/api/patients` | List all de-identified patients |
| `GET` | `/api/audit/trail` | View cryptographic audit trail |
| `GET` | `/api/audit/verify-chain` | Verify audit chain integrity |
| `GET` | `/api/privacy/audit` | Privacy compliance dashboard |
| `GET` | `/health` | System health check |

---

## AI Agent Details

### Document Intelligence

**FDAProcessor** — Extracts IND Form 1571 and Investigator Form 1572 fields from protocol PDFs. Uses pdfplumber for text/table extraction, SciSpaCy for medical entity recognition, regex patterns for structured fields, and Llama 3.1 for unstructured content interpretation.

**ProtocolRuleAgent** — Extracts structured eligibility criteria from protocol text. Each criterion is normalized into: type (inclusion/exclusion), category (AGE, LAB_THRESHOLD, CONDITION, MEDICATION, etc.), operator, value, unit, and negation flag. Uses SciSpaCy NER + LLM with anti-hallucination validation against source text.

### Research Intelligence

**LTAAAgent** — Literature and Target Analysis Agent. Queries PubMed via NCBI Entrez with expanded disease synonyms, extracts biological entities using SciSpaCy + UMLS linker, validates each entity against HGNC (genes) and UniProt (proteins), and stores validated targets in a Neo4j knowledge graph with weighted evidence edges.

### InSilico Modeling

**DrugExtractionAgent** — Identifies drug names, dosages, routes, frequencies, and prohibited medications from protocol text using LLM-guided chunking.

**ChemicalResolver** — Resolves drug names to molecular structures (SMILES notation) via PubChem, returning CID, molecular formula, and molecular weight.

**ToxicityAgent** — Assesses drug-likeness using RDKit and Lipinski's Rule of 5 (molecular weight, LogP, H-bond donors/acceptors, TPSA). Risk levels: 0 violations = Low, 1–2 = Moderate, 3+ = High.

**DDIAgent** — Cross-references trial drugs against prohibited medications using an interaction database, reporting risk level, mechanism, and clinical recommendation.

**MolecularTargetAgent** — Extracts proteins, genes, and pathways from protocol text using SciSpaCy with UMLS semantic type classification.

**PKPDSimulator** — Simulates drug concentration over time using a one-compartment oral absorption model. Outputs Cmax, half-life, steady-state trough, and full concentration-time curves.

### Patient Intelligence

**EligibilityMatcher** — Screens patients against extracted criteria using 15+ category-specific rule engines (age ranges, lab thresholds, condition presence, medication history, allergies, etc.). Produces confidence scores weighted by inclusion match (50%), exclusion safety (25%), data completeness (15%), and NLP certainty (10%).

**DeIDAgent** — HIPAA-compliant de-identification. Generates pseudonymized patient IDs via SHA-256, generalizes age into 10-year bands, redacts city names, and separates PII into a vault table. Supports both patient record de-identification and free-text PII scanning via spaCy NER.

**MedicalNLPAgent** — SciSpaCy + UMLS entity linking for clinical text understanding.

### Orchestration

**TrialOrchestrator** — Subscribes to TRIAL_CREATED events via the EventBus. Inspects trial metadata and autonomously plans which analyses to run (LTAA, InSilico, or both). Executes analysis pipelines in parallel via asyncio.

**EventBus** — Lightweight publish/subscribe system for decoupling trial lifecycle events from agent execution.

**ChatAgent** — Conversational Q&A agent that answers questions about trial data using LLM with trial context injection.

---

## Data Privacy

All patient data undergoes de-identification before entering the database:

| Protection | Implementation |
|-----------|---------------|
| **Pseudonymized IDs** | SHA-256 hash of original ID → `PAT_XXXXXX` |
| **Age Generalization** | Exact birthdate → 10-year age bands (e.g., "40-50") |
| **City Redaction** | City names replaced with "REDACTED" |
| **PII Vault Separation** | Original PII stored in separate `patient_vault` table |
| **On-Premise LLM** | All inference via local Ollama — no cloud API calls |
| **Document Integrity** | SHA-256 hash computed on upload, verified throughout lifecycle |
| **Audit Chain** | Every action logged with hash-chained entries for tamper evidence |

---

## Development

### View Logs

```bash
docker compose logs -f backend     # Backend + Ollama logs
docker compose logs -f frontend    # Frontend build/serve logs
docker compose logs -f neo4j       # Knowledge graph logs
```

### Rebuild After Code Changes

```bash
docker compose up -d --build backend    # Rebuild backend only
docker compose up -d --build frontend   # Rebuild frontend only
docker compose up -d --build            # Rebuild all
```

### Stop All Services

```bash
docker compose down                 # Stop containers
docker compose down -v              # Stop and remove volumes
```

### Run Patient Loader Manually

```bash
# Default: connects to Neon DB via DATABASE_URL in environment
python load_patients.py

# Override database URL
DATABASE_URL="postgresql://user:pass@host/db" python load_patients.py
```

### Access API Documentation

The interactive Swagger UI is available at `http://localhost:8201/docs` when the backend is running.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | Neon DB connection string | PostgreSQL connection URL |
| `NEO4J_URI` | `bolt://neo4j:7687` | Neo4j Bolt protocol URI |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `drugtrial_graph_pass` | Neo4j password |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `llama3.1` | LLM model to use |
| `PORT` | `8201` | Backend server port |

---

## Database Schema

Key tables in PostgreSQL:

| Table | Purpose |
|-------|---------|
| `patients` | De-identified patient demographics (PAT_xxx IDs, age_group, gender) |
| `patient_vault` | Separated PII storage (encrypted JSON) |
| `conditions` | Patient medical conditions (linked via PAT_xxx) |
| `medications` | Patient medication history |
| `observations` | Lab results and vital signs |
| `allergies` | Patient allergy records |
| `immunizations` | Vaccination history |
| `fda_documents` | Uploaded protocol PDFs with processing status |
| `fda_form_1571` | Extracted IND form data |
| `fda_form_1572` | Extracted investigator form data |
| `clinical_trials` | Trial records with analysis results |
| `eligibility_criteria` | Extracted structured criteria |
| `patient_eligibility` | Screening results per patient per trial |
| `audit_trail` | Hash-chained audit log entries |

---

## Troubleshooting

### Backend fails to start

```bash
# Check GPU availability
nvidia-smi

# Verify NVIDIA Container Toolkit
docker run --rm --gpus all nvidia/cuda:12.4.1-runtime-ubuntu22.04 nvidia-smi

# Check backend logs for specific errors
docker compose logs backend | tail -50
```

### Ollama model download stalls

The first boot pulls Llama 3.1 (4.9 GB). If it stalls, restart the backend:

```bash
docker compose restart backend
```

### Database connection errors

The backend connects to Neon DB (cloud PostgreSQL) by default. If you see SSL errors during long operations, the system automatically uses short-lived DB sessions to avoid timeouts.

```bash
# Verify Neon DB connectivity
docker compose exec backend python -c "from backend.db_models import get_session; s=get_session(); print('OK'); s.close()"
```

### Frontend shows 404 on API calls

Ensure the `REACT_APP_API_URL` build arg matches your deployment URL. For local development:

```bash
# In docker-compose.yml, set:
REACT_APP_API_URL=http://localhost:8201
```

### Port conflicts

```bash
sudo lsof -i :8201   # Backend
sudo lsof -i :3000   # Frontend
sudo lsof -i :5435   # PostgreSQL
sudo lsof -i :7474   # Neo4j HTTP
```

---

## License

This is a hackathon/research project. Use at your own discretion.

---

## Acknowledgments

Built with FastAPI, React, PostgreSQL, Neo4j, Ollama, SciSpaCy, RDKit, Biopython, PubChem, and Docker.
