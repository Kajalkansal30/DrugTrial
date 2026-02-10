# FDA Form Processing - Quick Start Guide

## 🚀 Quick Setup (5 minutes)

### 1. Run Setup Script
```bash
cd /home/veersa/Projects/Hackathon/DrugTrial
./setup_fda_processing.sh
```

### 2. Start Backend
```bash
python app.py
```

### 3. Start Frontend (new terminal)
```bash
cd frontend
npm start
```

### 4. Access FDA Processing
Open: http://localhost:3000/fda-processing

---

## 📋 Usage (3 steps)

### Step 1: Upload PDF
- Click "Choose PDF file..."
- Select clinical trial protocol PDF
- Click "Upload & Process"

### Step 2: Review & Edit
- Click "View/Edit" on processed document
- Review FDA 1571 and 1572 tabs
- Edit any null/incorrect fields
- Click "Save Changes"

### Step 3: Review & Sign
- Click "Mark as Reviewed"
- Click "Sign Form"
- Enter name and role
- Check certification box
- Click "Sign Document"

---

## 🎯 Key Features

✅ **Auto-extraction** from protocol PDFs
✅ **No hallucination** - missing fields show as null
✅ **Edit before review** - fix any extraction errors
✅ **E-signature** - lock forms after signing
✅ **Audit trail** - track who reviewed/signed

---

## 📁 What Gets Extracted

### FDA Form 1571 (IND)
- Drug name, dosage form, route
- Study phase, protocol title/number
- Sponsor name, address, contact info
- Indication

### FDA Form 1572 (Investigator)
- Investigator name, address, contact
- IRB name and address
- Study sites
- Sub-investigators
- Clinical laboratories

---

## 🔧 Troubleshooting

### Ollama not installed?
```bash
curl https://ollama.ai/install.sh | sh
ollama pull llama3.1
```

### SciSpacy model missing?
```bash
pip install https://s3-us-west-2.amazonaws.com/ai2-s2-scispacy/releases/v0.5.3/en_core_sci_lg-0.5.3.tar.gz
```

### Dependencies not installed?
```bash
pip install -r backend/requirements.txt
```

---

## 📊 Workflow States

```
Extracted (🟡)
    ↓
  Edit & Save
    ↓
Reviewed (🔵)
    ↓
  E-Sign
    ↓
Signed (🟢)
  [Locked]
```

---

## 🧪 Test with Sample Data

Use the existing sample PDF:
```bash
data/drug/2.pdf
```

Or upload your own clinical trial protocol PDF.

---

## 📖 Full Documentation

See [walkthrough.md](file:///home/veersa/.gemini/antigravity/brain/e3ae68dd-3dbb-4be3-a842-99cc02c15a93/walkthrough.md) for complete details.
