-- Simple migration: Add trial data tables
-- Run this to create the new tables only

-- FDA Form 1571 - Investigational New Drug Application
CREATE TABLE IF NOT EXISTS fda_form_1571 (
    id SERIAL PRIMARY KEY,
    document_id INTEGER UNIQUE NOT NULL REFERENCES fda_documents(id) ON DELETE CASCADE,
    ind_number VARCHAR(50),
    drug_name VARCHAR(500),
    indication TEXT,
    study_phase VARCHAR(50),
    protocol_title TEXT,
    sponsor_name VARCHAR(500),
    sponsor_address TEXT,
    contact_person VARCHAR(200),
    contact_phone VARCHAR(50),
    contact_email VARCHAR(200),
    cross_reference_inds JSONB DEFAULT '[]'::jsonb,
    extraction_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fda_form_1571_document_id ON fda_form_1571(document_id);

-- FDA Form 1572 - Statement of Investigator
CREATE TABLE IF NOT EXISTS fda_form_1572 (
    id SERIAL PRIMARY KEY,
    document_id INTEGER UNIQUE NOT NULL REFERENCES fda_documents(id) ON DELETE CASCADE,
    protocol_title TEXT,
    investigator_name VARCHAR(200),
    investigator_address TEXT,
    investigator_phone VARCHAR(50),
    investigator_email VARCHAR(200),
    study_sites JSONB DEFAULT '[]'::jsonb,
    sub_investigators JSONB DEFAULT '[]'::jsonb,
    clinical_laboratories JSONB DEFAULT '[]'::jsonb,
    extraction_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fda_form_1572_document_id ON fda_form_1572(document_id);

-- In-Silico Analysis Data
CREATE TABLE IF NOT EXISTS insilico_analyses (
    id SERIAL PRIMARY KEY,
    trial_id INTEGER UNIQUE NOT NULL REFERENCES clinical_trials(id) ON DELETE CASCADE,
    drug_name VARCHAR(500),
    drug_structure TEXT,
    molecular_targets JSONB,
    ddi_predictions JSONB,
    toxicity_prediction JSONB,
    pkpd_simulation JSONB,
    other_analyses JSONB,
    analysis_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_insilico_analyses_trial_id ON insilico_analyses(trial_id);

-- Research Intelligence / Literature Analysis
CREATE TABLE IF NOT EXISTS research_intelligence (
    id SERIAL PRIMARY KEY,
    trial_id INTEGER UNIQUE NOT NULL REFERENCES clinical_trials(id) ON DELETE CASCADE,
    disease VARCHAR(500),
    target_genes JSONB,
    biomarkers JSONB,
    pathways JSONB,
    publications JSONB,
    clinical_trials JSONB,
    drug_candidates JSONB,
    analysis_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_research_intelligence_trial_id ON research_intelligence(trial_id);
CREATE INDEX IF NOT EXISTS idx_research_intelligence_disease ON research_intelligence(disease);
