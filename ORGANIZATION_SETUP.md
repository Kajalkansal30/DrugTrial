# Organization Login & Dashboard System

## Overview

The DrugTrial Automation system now includes a complete multi-organization authentication system. Organizations can log in, upload documents, manage trials, and view patient eligibility results—all stored in the database with proper organization isolation.

## Features

### 1. **Organization-Based Authentication**
- Secure JWT-based authentication
- Users belong to specific organizations
- Organization data is automatically filtered based on logged-in user

### 2. **Document Management**
- Upload FDA forms (1571, 1572)
- Upload trial protocol documents
- All documents are automatically linked to the user's organization

### 3. **Trial Management**
- Create and manage clinical trials
- Extract eligibility criteria from protocols
- Link trials to FDA documents
- Trials are organization-scoped

### 4. **Patient Screening & Results**
- Run eligibility analysis on patient cohorts
- Store detailed patient screening results
- View eligibility breakdown (eligible, ineligible, uncertain)
- Track criteria matches and confidence scores

### 5. **Organization Dashboard**
- Comprehensive view of all organization trials
- Statistics: total trials, active trials, patient counts
- Expandable trial details showing:
  - Eligibility rules/criteria
  - Patient screening results
  - Analysis status
  - Document information

## Default Organizations & Credentials

The system comes pre-configured with three organizations and sample users:

### Veersa Labs
- **Admin Username**: `admin@veersa`
- **User Username**: `user@veersa`
- **Password**: `password123`

### DNDi Research
- **Admin Username**: `admin@dndi`
- **Password**: `password123`

### ClinTech Pharma
- **User Username**: `user@clintech`
- **Password**: `password123`

## Setup Instructions

### 1. Database Setup

Make sure PostgreSQL is running and properly configured. The connection string should be in your environment:

```bash
# Set in .env or environment variables
DATABASE_URL=postgresql://user:password@localhost:5432/drugtrial
JWT_SECRET=your-secret-key-change-in-production
```

### 2. Install Dependencies

#### Node.js Backend
```bash
cd node-backend
npm install
```

#### Python Backend
```bash
pip install -r requirements.txt
cd backend
pip install -r requirements.txt
```

#### Frontend
```bash
cd frontend
npm install
```

### 3. Initialize Database

Run Prisma migrations and seed:

```bash
cd node-backend
npx prisma migrate dev
npx prisma db seed
```

This will:
- Create the organizations and users tables
- Add the three default organizations
- Create sample user accounts with hashed passwords

### 4. Start Services

You'll need **three terminal windows**:

#### Terminal 1 - Python Backend (Port 8201)
```bash
# From project root
python app.py
```

#### Terminal 2 - Node.js Backend (Port 4000)
```bash
cd node-backend
npm start
```

#### Terminal 3 - Frontend (Port 3000)
```bash
cd frontend
npm start
```

## Using the System

### Step 1: Login

1. Navigate to `http://localhost:3000/drugtrial/login`
2. Enter credentials (e.g., `admin@veersa` / `password123`)
3. You'll be redirected to the home page

### Step 2: Upload FDA Forms

1. From the home page, upload an FDA form PDF (Form 1571/1572)
2. The system will extract form data in the background
3. Poll status to see when extraction is complete
4. Review and approve the extracted forms

### Step 3: Create a Trial

After FDA forms are processed:
1. Create a clinical trial from the FDA document
2. The trial is automatically linked to your organization
3. System extracts eligibility criteria from the protocol

### Step 4: Run Patient Screening

1. Navigate to the Screening page for your trial
2. System automatically runs eligibility matching
3. Results are stored in the database with detailed analysis

### Step 5: View Organization Dashboard

1. Click "Dashboard" in the navigation bar
2. See all trials belonging to your organization
3. Expand any trial to see:
   - Eligibility criteria
   - Patient results breakdown
   - Confidence scores
   - Evaluation dates

## Database Schema

### Key Tables

#### `organizations`
- id, name, domain, status
- Stores organization information

#### `users`
- id, username, passwordHash, email, fullName
- organizationId (foreign key)
- Links users to organizations

#### `fda_documents`
- id, filename, fileHash, uploadDate, status
- organizationId (foreign key)
- Tracks uploaded FDA forms

#### `clinical_trials`
- id, trialId, protocolTitle, phase, indication, drugName
- organizationId (foreign key)
- documentId (links to fda_documents)
- Stores trial information

#### `patient_eligibility`
- id, patientId, trialId, eligibilityStatus, confidenceScore
- organizationId (implicit through trial)
- Stores screening results

#### `eligibility_audits`
- Detailed audit trail of eligibility evaluations
- Stores criteria matches, confidence, details

## API Endpoints

All endpoints require authentication (except `/api/auth/login`). Include JWT token in header:
```
Authorization: Bearer <token>
```

### Authentication
- `POST /api/auth/login` - User login
- `GET /api/auth/me` - Get current user info
- `POST /api/auth/logout` - Logout

### Trials
- `GET /api/trials` - List organization trials
- `POST /api/trials` - Create new trial
- `POST /api/trials/upload` - Upload protocol document
- `GET /api/trials/:trialId/rules` - Get eligibility criteria
- `GET /api/trials/:trialId/criteria-status` - Check extraction status
- `POST /api/trials/:trialId/run-analysis` - Run LTAA/InSilico analysis

### FDA Documents
- `POST /api/fda/upload` - Upload FDA form
- `GET /api/fda/documents` - List organization documents
- `GET /api/fda/forms/:documentId` - Get form details
- `POST /api/fda/forms/:documentId/review` - Review form
- `POST /api/fda/forms/:documentId/sign` - E-sign form

### Eligibility
- `POST /api/eligibility/check` - Check single patient
- `POST /api/eligibility/batch-check` - Batch patient screening
- `GET /api/eligibility/results/:trialId` - Get trial results

### Stats & Audit
- `GET /api/stats` - System statistics
- `GET /api/audit/logs` - Audit trail logs
- `GET /api/privacy/deid-audit` - De-identification audit

## Security Features

1. **JWT Authentication**: Secure token-based auth with 7-day expiry
2. **Password Hashing**: Bcrypt with salt rounds
3. **Organization Isolation**: Data automatically filtered by organization
4. **Audit Trail**: All actions logged with timestamps
5. **File Hash Verification**: SHA-256 hashing of uploaded documents

## Navigation

The navigation bar includes:
- **Dashboard**: Organization dashboard (new!)
- **Home**: Upload documents and manage trials
- **Audit Trail**: View system audit logs
- **Privacy Audit**: De-identification tracking
- **User Menu**: Shows organization name, logout option

## Troubleshooting

### Can't login?
- Check database connection
- Verify user exists: `SELECT * FROM users WHERE username = 'admin@veersa';`
- Ensure Prisma seed ran successfully

### Documents not showing?
- Check organizationId is set on documents
- Verify JWT token includes organizationId
- Check browser console for errors

### Patient results not appearing?
- Confirm patients exist in database
- Verify trial extraction completed
- Check patient_eligibility table: `SELECT * FROM patient_eligibility WHERE trial_id = X;`

### Database connection errors?
- Verify PostgreSQL is running
- Check DATABASE_URL environment variable
- Ensure database exists: `createdb drugtrial`

## Adding New Organizations

To add a new organization:

```javascript
// In node-backend/prisma/seed.js, add:
const newOrg = await prisma.organization.upsert({
    where: { name: 'New Pharma Co' },
    update: {},
    create: {
        name: 'New Pharma Co',
        domain: 'newpharma.com',
        status: 'active'
    }
});

// Add a user for that org:
await prisma.user.upsert({
    where: { username: 'admin@newpharma' },
    update: {},
    create: {
        username: 'admin@newpharma',
        passwordHash: await bcrypt.hash('password123', 10),
        email: 'admin@newpharma.com',
        fullName: 'New Pharma Admin',
        organizationId: newOrg.id,
        role: 'admin',
        status: 'active'
    }
});
```

Then run:
```bash
cd node-backend
node prisma/seed.js
```

## Architecture

```
┌─────────────┐
│   Browser   │
│  (React)    │
└──────┬──────┘
       │ HTTP + JWT
       ▼
┌─────────────┐
│  Node.js    │ ←─── Auth Middleware
│  Backend    │      (validates JWT, extracts orgId)
│  (Port 4000)│
└──────┬──────┘
       │
       ├─→ Prisma → PostgreSQL (org filtering)
       │
       └─→ Python Backend (Port 8201)
             │
             └─→ SQLAlchemy → PostgreSQL
```

## Next Steps

- **Multi-role permissions**: Implement role-based access control (admin vs user)
- **Trial sharing**: Allow trials to be shared between organizations
- **Export functionality**: Export patient results to CSV/Excel
- **Email notifications**: Notify when analysis completes
- **API rate limiting**: Add per-organization rate limits
- **Advanced filtering**: Filter trials by status, phase, indication

## Support

For issues or questions, refer to the main README.md or check the application logs in the backend terminals.
