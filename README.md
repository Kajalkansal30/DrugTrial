# 🧬 Drug Trial Automation System

**End-to-end automated clinical trial platform** - From patient data to FDA submissions, powered by AI agents.

## 🎯 What This System Does

- ✅ **Automates patient eligibility screening** using AI and rule-based matching
- ✅ **Generates FDA forms (1571/1572)** automatically from drug documentation
- ✅ **Manages clinical trial data** with SNOMED/LOINC standardized codes
- ✅ **Provides AI-powered agents** for protocol design, safety monitoring, and regulatory submissions
- ✅ **Runs 100% locally** - No cloud costs, complete data privacy

## 💰 Cost

**$0** - Everything runs on your local machine using Docker

## 🚀 Quick Start

### 1. Install Docker

See [`docker_installation_guide.md`](/.gemini/antigravity/brain/1073fd70-6d19-40ce-9557-68573bc7bd65/docker_installation_guide.md) for installation instructions.

### 2. Start the System

```bash
cd /home/veersa/Projects/Hackathon/DrugTrial
docker compose up -d
```

### 3. Access the Application

- **Frontend Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:8201
- **API Documentation**: http://localhost:8201/docs

### 4. Import Patient Data

```bash
curl -X POST http://localhost:8201/api/data/import
```

## 📁 Project Structure

```
DrugTrial/
├── docker-compose.yml          # Orchestrates all services
├── backend/
│   ├── main.py                 # FastAPI application
│   ├── data_generator.py       # Synthetic data generator
│   ├── database/
│   │   └── init.sql            # Database schema
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.js              # React dashboard
│   │   └── index.js
│   ├── Dockerfile
│   └── package.json
├── nginx/
│   └── nginx.conf              # Reverse proxy config
└── data/
    ├── patients/               # Your CSV data
    │   ├── patients.csv
    │   ├── conditions.csv
    │   ├── medications.csv
    │   └── observations.csv
    └── drug/
        └── 2.pdf               # Drug documentation
```

## 🛠️ Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Database** | PostgreSQL 15 | Clinical trial data |
| **Document Store** | MongoDB 7 | Protocols, FDA forms |
| **Backend** | Python + FastAPI | REST API & AI agents |
| **Frontend** | React + Material-UI | Dashboard |
| **LLM** | Ollama (local) | AI agents (free) |
| **Vector DB** | ChromaDB | Document embeddings |
| **Reverse Proxy** | Nginx | Routing |
| **NLP** | spaCy + SciSpacy | Medical text extraction |

## 📊 Your Data Format

Your existing patient data uses industry-standard codes:

- **SNOMED CT**: Condition codes (e.g., `44054006` = Type 2 Diabetes)
- **LOINC**: Lab test codes (e.g., `4548-4` = HbA1c)
- **RxNorm**: Medication codes (e.g., `860975` = Metformin)

This matches **FHIR/HL7** healthcare standards used by hospitals and EHRs.

## 🤖 AI Agents (Planned)

1. **Drug Documentation Intake Agent** - Extracts structured data from PDFs
2. **Protocol Designer Agent** - Generates trial protocols
3. **Eligibility Matching Agent** - Screens patients automatically
4. **FDA Form Generator** - Auto-fills 1571/1572 forms
5. **Safety Monitoring Agent** - Detects adverse events
6. **Regulatory Submission Agent** - Prepares eCTD packages

## 📖 Documentation

- **[Implementation Plan](/.gemini/antigravity/brain/1073fd70-6d19-40ce-9557-68573bc7bd65/implementation_plan.md)** - Complete system architecture
- **[Quick Start Guide](/.gemini/antigravity/brain/1073fd70-6d19-40ce-9557-68573bc7bd65/quick_start_guide.md)** - Step-by-step setup
- **[Docker Installation](/.gemini/antigravity/brain/1073fd70-6d19-40ce-9557-68573bc7bd65/docker_installation_guide.md)** - Docker setup for Linux

## 🧪 Generate Synthetic Data

To create additional test patients:

```bash
cd backend
pip install faker
python data_generator.py
```

This generates 20 patients with:
- Demographics
- Medical conditions (SNOMED codes)
- Medications (RxNorm codes)
- Lab observations (LOINC codes)

## 🔧 Development

### View Logs

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Restart Services

```bash
docker compose restart backend
docker compose restart frontend
```

### Stop Everything

```bash
docker compose down
```

### Rebuild After Changes

```bash
docker compose build
docker compose up -d
```

## 🧬 API Examples

### Get All Patients

```bash
curl http://localhost:8201/api/patients
```

### Get Patient Details

```bash
curl http://localhost:8201/api/patients/P001
```

### Check Eligibility

```bash
curl -X POST http://localhost:8201/api/eligibility/check \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "P001", "trial_id": 1}'
```

## 🎓 Next Steps

1. ✅ **Install Docker** (see guide)
2. ✅ **Start the system** (`docker compose up -d`)
3. ✅ **Import your data** (POST to `/api/data/import`)
4. 🔄 **Add trial data** (create clinical trials)
5. 🔄 **Test eligibility matching** (run patient screening)
6. 🔄 **Customize AI agents** (add LLM-powered features)

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Check what's using the port
sudo lsof -i :5432  # PostgreSQL
sudo lsof -i :8000  # Backend
sudo lsof -i :3000  # Frontend
```

### Database Connection Error

```bash
docker compose restart postgres
docker compose logs postgres
```

### Frontend Not Loading

```bash
docker compose logs frontend
docker compose build frontend
docker compose up -d frontend
```

## 📄 License

This is a hackathon/research project. Use at your own discretion.

## 🙏 Acknowledgments

Built using:
- FastAPI
- React
- PostgreSQL
- MongoDB
- Ollama
- spaCy/SciSpacy
- Docker

---

**Made with ❤️ for automated clinical trials**
