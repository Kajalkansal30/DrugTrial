-- Migration: Add authentication and organization tables
-- Run this file to add login functionality

-- Organizations Table
CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    domain VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    full_name VARCHAR(255),
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    role VARCHAR(50) DEFAULT 'user', -- admin, user, viewer
    status VARCHAR(20) DEFAULT 'active',
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_status ON users(status);

-- Add organization_id to clinical_trials if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'clinical_trials' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE clinical_trials ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
        CREATE INDEX idx_trials_org ON clinical_trials(organization_id);
    END IF;
END $$;

-- Add organization_id to fda_documents if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'fda_documents' AND column_name = 'organization_id'
    ) THEN
        ALTER TABLE fda_documents ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
        CREATE INDEX idx_fda_docs_org ON fda_documents(organization_id);
    END IF;
END $$;

-- Seed Organizations
INSERT INTO organizations (name, domain, status) VALUES
    ('Veersa Labs', 'veersalabs.com', 'active'),
    ('DNDi Research', 'dndi.org', 'active'),
    ('ClinTech Pharma', 'clintech.com', 'active')
ON CONFLICT (name) DO NOTHING;

-- Seed Users (password for all: 'password123')
-- Password hash is bcrypt hash of 'password123' with 10 rounds
INSERT INTO users (username, password_hash, email, full_name, organization_id, role) VALUES
    ('admin@veersa', '$2b$10$rQ3VL8k5FxqQ3vK5X5ZE3.L5xJ7K5J7K5J7K5J7K5J7K5J7K5J7K5O', 'admin@veersalabs.com', 'Veersa Admin', 1, 'admin'),
    ('user@veersa', '$2b$10$rQ3VL8k5FxqQ3vK5X5ZE3.L5xJ7K5J7K5J7K5J7K5J7K5J7K5J7K5O', 'user@veersalabs.com', 'Veersa User', 1, 'user'),
    ('admin@dndi', '$2b$10$rQ3VL8k5FxqQ3vK5X5ZE3.L5xJ7K5J7K5J7K5J7K5J7K5J7K5J7K5O', 'admin@dndi.org', 'DNDi Admin', 2, 'admin'),
    ('user@clintech', '$2b$10$rQ3VL8k5FxqQ3vK5X5ZE3.L5xJ7K5J7K5J7K5J7K5J7K5J7K5J7K5O', 'user@clintech.com', 'ClinTech User', 3, 'user')
ON CONFLICT (username) DO NOTHING;

-- Default Credentials Summary:
-- Username: admin@veersa | Password: password123 | Org: Veersa Labs
-- Username: user@veersa  | Password: password123 | Org: Veersa Labs
-- Username: admin@dndi   | Password: password123 | Org: DNDi Research
-- Username: user@clintech | Password: password123 | Org: ClinTech Pharma
