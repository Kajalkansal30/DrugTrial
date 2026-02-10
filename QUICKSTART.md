# 🚀 Quick Start - Standalone Python Version

## Prerequisites

- ✅ Python 3.8+ installed
- ✅ pip (Python package manager)

## Setup (One-Time)

### 1. Install Dependencies

```bash
cd /home/veersa/Projects/Hackathon/DrugTrial

# Install all required packages
pip install -r requirements.txt

# Download spaCy model
python -m spacy download en_core_web_sm
```

### 2. Initialize Database & Import Data

```bash
# Run the setup script (does everything automatically)
python setup.py
```

This will:
- Create SQLite database (`drug_trial.db`)
- Import your patient CSV data
- Test FDA form extraction
- Verify everything is working

**OR** do it manually:

```bash
# Import your patient data
python import_data.py

# Test FDA extraction
python agents/fda_form_extractor.py
```

---

## Running the System

### Start the API Server

```bash
uvicorn app:app --reload
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

### Access the Application

- **API**: http://localhost:8200
- **Interactive Docs**: http://localhost:8200/docs
- **Health Check**: http://localhost:8200/health

---

## Test the API

### Get All Patients

```bash
curl http://localhost:8200/patients
```

### Get Patient Details

```bash
curl http://localhost:8200/patients/P001
```

### Get System Stats

```bash
curl http://localhost:8200/stats
```

### Extract FDA Forms from PDF

```bash
curl -X POST "http://localhost:8200/fda/extract?pdf_filename=2.pdf"
```

### Create a Trial

```bash
curl -X POST http://localhost:8200/trials \
  -H "Content-Type: application/json" \
  -d '{
    "trial_id": "TRIAL001",
    "protocol_title": "Phase 2 Study of ABC-123 in Type 2 Diabetes",
    "phase": "Phase 2",
    "indication": "Type 2 Diabetes",
    "drug_name": "ABC-123"
  }'
```

### Check Patient Eligibility

```bash
curl -X POST http://localhost:8200/eligibility/check \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "P001",
    "trial_id": 1
  }'
```

---

## Project Structure

```
DrugTrial/
├── app.py                      # Main FastAPI application
├── database.py                 # SQLite database models
├── import_data.py              # CSV import utility
├── setup.py                    # One-time setup script
├── requirements.txt            # Python dependencies
├── agents/
│   ├── eligibility_matcher.py  # Patient matching agent
│   └── fda_form_extractor.py   # FDA form extraction
├── data/
│   ├── patients/               # Your CSV files
│   └── drug/                   # Drug PDFs
└── drug_trial.db               # SQLite database (created after setup)
```

---

## What's Working

✅ **Patient Management**
- Import from CSV
- Query patient data
- View conditions, medications, observations

✅ **Trial Management**
- Create clinical trials
- Define eligibility criteria
- Track trial status

✅ **Eligibility Matching**
- Rule-based patient screening
- Age, diagnosis, lab criteria
- Confidence scoring

✅ **FDA Form Extraction**
- Extract from PDF documentation
- Auto-fill Form 1571 (sponsor data)
- Auto-fill Form 1572 (investigator data)
- Validation checks

---

## Development

### View Database

```bash
# Install SQLite browser (optional)
sudo apt install sqlitebrowser

# Open database
sqlitebrowser drug_trial.db
```

Or use Python:

```python
from database import get_session
session = get_session()

# Query patients
patients = session.query(Patient).all()
for p in patients:
    print(f"{p.id}: {p.first_name} {p.last_name}")
```

### Add More Data

```bash
# Generate synthetic patients
cd backend
python data_generator.py
```

### Stop the Server

Press `Ctrl+C` in the terminal running uvicorn

---

## Troubleshooting

### Import Error: No module named 'X'

```bash
pip install -r requirements.txt
```

### Database Error

```bash
# Delete and recreate database
rm drug_trial.db
python setup.py
```

### PDF Extraction Not Working

```bash
# Install PDF dependencies
pip install pdfplumber pypdf2
```

---

## Next Steps

1. ✅ **Test all endpoints** using http://localhost:8000/docs
2. 🔄 **Add eligibility criteria** to trials
3. 🔄 **Test patient matching** with real criteria
4. 🔄 **Customize FDA extraction** for your PDF format
5. 🔄 **Add more AI agents** (protocol designer, safety monitoring)

---

## Cost

**$0** - Everything runs locally, no cloud services needed!
