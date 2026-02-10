-- Clinical Trials Database Schema

-- Patients Table
CREATE TABLE IF NOT EXISTS patients (
    id VARCHAR(10) PRIMARY KEY,
    birthdate DATE NOT NULL,
    deathdate DATE,
    ssn VARCHAR(15),
    drivers VARCHAR(20),
    passport VARCHAR(20),
    prefix VARCHAR(10),
    first_name VARCHAR(100),
    middle_name VARCHAR(100),
    last_name VARCHAR(100),
    suffix VARCHAR(10),
    maiden VARCHAR(100),
    marital_status CHAR(1),
    race VARCHAR(50),
    ethnicity VARCHAR(50),
    gender CHAR(1),
    birthplace VARCHAR(200),
    address VARCHAR(200),
    city VARCHAR(100),
    state VARCHAR(50),
    county VARCHAR(100),
    fips VARCHAR(10),
    zip VARCHAR(10),
    lat DECIMAL(10, 6),
    lon DECIMAL(10, 6),
    healthcare_expenses DECIMAL(12, 2),
    healthcare_coverage DECIMAL(12, 2),
    income DECIMAL(12, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Conditions Table
CREATE TABLE IF NOT EXISTS conditions (
    id SERIAL PRIMARY KEY,
    start_date DATE NOT NULL,
    stop_date DATE,
    patient_id VARCHAR(10) REFERENCES patients(id),
    encounter_id VARCHAR(10),
    system VARCHAR(100),
    code VARCHAR(20),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conditions_patient ON conditions(patient_id);
CREATE INDEX idx_conditions_code ON conditions(code);

-- Medications Table
CREATE TABLE IF NOT EXISTS medications (
    id SERIAL PRIMARY KEY,
    start_date DATE NOT NULL,
    stop_date DATE,
    patient_id VARCHAR(10) REFERENCES patients(id),
    payer_id VARCHAR(10),
    encounter_id VARCHAR(10),
    code VARCHAR(20),
    description TEXT,
    base_cost DECIMAL(10, 2),
    payer_coverage DECIMAL(10, 2),
    dispenses INTEGER,
    total_cost DECIMAL(10, 2),
    reason_code VARCHAR(20),
    reason_description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_medications_patient ON medications(patient_id);
CREATE INDEX idx_medications_code ON medications(code);

-- Observations Table
CREATE TABLE IF NOT EXISTS observations (
    id SERIAL PRIMARY KEY,
    observation_date DATE NOT NULL,
    patient_id VARCHAR(10) REFERENCES patients(id),
    encounter_id VARCHAR(10),
    category VARCHAR(50),
    code VARCHAR(20),
    description TEXT,
    value VARCHAR(50),
    units VARCHAR(20),
    type VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_observations_patient ON observations(patient_id);
CREATE INDEX idx_observations_code ON observations(code);
CREATE INDEX idx_observations_date ON observations(observation_date);


-- Allergies Table
CREATE TABLE IF NOT EXISTS allergies (
    id SERIAL PRIMARY KEY,
    start_date DATE,
    stop_date DATE,
    patient_id VARCHAR(10) REFERENCES patients(id),
    encounter_id VARCHAR(10),
    code VARCHAR(20),
    description TEXT,
    type VARCHAR(50),
    category VARCHAR(50),
    reaction1 VARCHAR(100),
    severity1 VARCHAR(20),
    reaction2 VARCHAR(100),
    severity2 VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_allergies_patient ON allergies(patient_id);

-- Immunizations Table
CREATE TABLE IF NOT EXISTS immunizations (
    id SERIAL PRIMARY KEY,
    immunization_date DATE NOT NULL,
    patient_id VARCHAR(10) REFERENCES patients(id),
    encounter_id VARCHAR(10),
    code VARCHAR(20),
    description TEXT,
    base_cost DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_immunizations_patient ON immunizations(patient_id);

-- Clinical Trials Table
CREATE TABLE IF NOT EXISTS clinical_trials (
    id SERIAL PRIMARY KEY,
    trial_id VARCHAR(50) UNIQUE NOT NULL,
    protocol_number VARCHAR(100),
    protocol_title TEXT,
    phase VARCHAR(20),
    indication TEXT,
    drug_name VARCHAR(200),
    sponsor_name VARCHAR(200),
    status VARCHAR(50),
    fda_1571 JSON,
    fda_1572 JSON,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Eligibility Criteria Table
CREATE TABLE IF NOT EXISTS eligibility_criteria (
    id SERIAL PRIMARY KEY,
    trial_id INTEGER REFERENCES clinical_trials(id),
    criterion_id VARCHAR(20),
    criterion_type VARCHAR(20), -- 'inclusion' or 'exclusion'
    text TEXT,
    category VARCHAR(50),
    operator VARCHAR(20),
    value VARCHAR(100),
    unit VARCHAR(20),
    timeframe VARCHAR(100),
    needs_human_review BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_eligibility_trial ON eligibility_criteria(trial_id);

-- Patient Eligibility Results Table
CREATE TABLE IF NOT EXISTS patient_eligibility (
    id SERIAL PRIMARY KEY,
    patient_id VARCHAR(10) REFERENCES patients(id),
    trial_id INTEGER REFERENCES clinical_trials(id),
    eligibility_status VARCHAR(20), -- 'eligible', 'not_eligible', 'unknown'
    confidence_score DECIMAL(5, 4),
    evaluation_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reasons JSONB,
    UNIQUE(patient_id, trial_id)
);

CREATE INDEX idx_patient_eligibility_patient ON patient_eligibility(patient_id);
CREATE INDEX idx_patient_eligibility_trial ON patient_eligibility(trial_id);


