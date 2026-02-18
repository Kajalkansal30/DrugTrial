"""
Database Models and Setup
Using PostgreSQL via SQLAlchemy
"""
 
from sqlalchemy import create_engine, Column, Integer, String, Date, Float, Boolean, Text, DateTime, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
 
Base = declarative_base()
 
# Models
class Patient(Base):
    __tablename__ = 'patients'
   
    id = Column(String(50), primary_key=True)
    birthdate = Column(Date, nullable=False)
    ssn = Column(String(15))
    first_name = Column(String(100))
    last_name = Column(String(100))
    gender = Column(String(1))
    race = Column(String(50))
    ethnicity = Column(String(50))
    city = Column(String(100))
    state = Column(String(50))
   
    # De-identification metadata
    is_deidentified = Column(Boolean, default=False)
    age_group = Column(String(20)) # e.g. "30-40"
    original_id_hash = Column(String(64), index=True) # For idempotent imports
   
    # Relationships
    conditions = relationship("Condition", back_populates="patient")
    medications = relationship("Medication", back_populates="patient")
    observations = relationship("Observation", back_populates="patient")
    allergies = relationship("Allergy", back_populates="patient")
    immunizations = relationship("Immunization", back_populates="patient")
 
class Condition(Base):
    __tablename__ = 'conditions'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    start_date = Column(Date, nullable=False)
    patient_id = Column(String(50), ForeignKey('patients.id'))
    code = Column(String(20))
    description = Column(Text)
    scope = Column(String(20), default='personal')  # 'personal' or 'family'
   
    patient = relationship("Patient", back_populates="conditions")
 
class Medication(Base):
    __tablename__ = 'medications'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    start_date = Column(Date, nullable=False)
    patient_id = Column(String(50), ForeignKey('patients.id'))
    code = Column(String(20))
    description = Column(Text)
   
    patient = relationship("Patient", back_populates="medications")
 
class Observation(Base):
    __tablename__ = 'observations'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    observation_date = Column(Date, nullable=False)
    patient_id = Column(String(50), ForeignKey('patients.id'))
    code = Column(String(20))
    description = Column(Text)
    value = Column(String(50))
    units = Column(String(20))
   
    patient = relationship("Patient", back_populates="observations")
 
class Allergy(Base):
    __tablename__ = 'allergies'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    start_date = Column(Date)
    patient_id = Column(String(50), ForeignKey('patients.id'))
    code = Column(String(20))
    description = Column(Text)
    allergy_type = Column("type", String(50))  # allergy, adverse reaction
    category = Column(String(50))  # medication, food, environment
    reaction1 = Column(String(100))
    severity1 = Column(String(20))
    reaction2 = Column(String(100))
    severity2 = Column(String(20))
   
    patient = relationship("Patient", back_populates="allergies")
 
class Immunization(Base):
    __tablename__ = 'immunizations'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    immunization_date = Column(Date, nullable=False)
    patient_id = Column(String(50), ForeignKey('patients.id'))
    code = Column(String(20))
    description = Column(Text)
    base_cost = Column(Float)
   
    patient = relationship("Patient", back_populates="immunizations")
 
class ClinicalTrial(Base):
    __tablename__ = 'clinical_trials'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_id = Column(String(50), unique=True, nullable=False)
    protocol_title = Column(Text)
    phase = Column(String(100))
    indication = Column(Text)
    drug_name = Column(String(200))
    status = Column(String(50))
    document_id = Column(Integer, ForeignKey('fda_documents.id'), nullable=True)
    fda_1571 = Column(JSON)
    fda_1572 = Column(JSON)
    matching_config = Column(JSON)  # Stores weights, thresholds, etc.
    analysis_results = Column(JSON, nullable=True)  # {"ltaa": {...}, "insilico": {...}}
    analysis_status = Column(String(20), default="pending")  # pending, running, completed, failed
    created_at = Column(DateTime, default=datetime.utcnow)
 
class EligibilityCriteria(Base):
    __tablename__ = 'eligibility_criteria'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_id = Column(Integer, ForeignKey('clinical_trials.id'))
    criterion_id = Column(String(20))
    criterion_type = Column(String(20))  # 'inclusion' or 'exclusion'
    text = Column(Text)
    category = Column(String(50))
    operator = Column(String(20))
    value = Column(String(100))
    unit = Column(String(20))
    negated = Column(Boolean, default=False)
    structured_data = Column(JSON)
   
    # Phase 2: Compound criteria support
    group_id = Column(String(50), nullable=True, index=True)
    group_logic = Column(String(10), nullable=True)  # 'AND' or 'OR'
    temporal_window_months = Column(Integer, nullable=True)
    scope = Column(String(20), default='personal', nullable=True, index=True)  # 'personal' or 'family'
    value_list = Column(JSON, nullable=True)  # For multi-drug/multi-value rules
 
class PatientEligibility(Base):
    __tablename__ = 'patient_eligibility'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(String(50), ForeignKey('patients.id'))
    trial_id = Column(Integer, ForeignKey('clinical_trials.id'))
    organization_id = Column(Integer, nullable=True) # Link to Node.js organizations table
    eligibility_status = Column(String(20))
    confidence_score = Column(Float)
    evaluation_date = Column(DateTime, default=datetime.utcnow)
 
class EligibilityAudit(Base):
    __tablename__ = 'eligibility_audits'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    trial_id = Column(Integer, ForeignKey('clinical_trials.id'))
    patient_id = Column(String(50), ForeignKey('patients.id'))
    organization_id = Column(Integer, nullable=True) # Link to Node.js organizations table
    matched_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50))  # ELIGIBLE, INELIGIBLE, UNCERTAIN
    confidence = Column(Float)
    criteria_met = Column(Integer)
    criteria_total = Column(Integer)
    details = Column(JSON)  # Stores breakdown of mismatched criteria
   
class PatientVault(Base):
    __tablename__ = 'patient_vault'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    patient_id = Column(String(50), ForeignKey('patients.id'), unique=True)
    encrypted_pii = Column(JSON) # Stores original SSN, Name, Address securely
    created_at = Column(DateTime, default=datetime.utcnow)
   
    patient = relationship("Patient")
 
# FDA Form Processing Models
class FDADocument(Base):
    __tablename__ = 'fda_documents'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    filename = Column(String(255), nullable=False)
    file_hash = Column(String(64), nullable=False)
    upload_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50), default='extracted')  # extracted, reviewed, signed
    processed_at = Column(DateTime)
    reviewed_at = Column(DateTime)
    reviewed_by = Column(String(255))
    signed_at = Column(DateTime)
    signed_by = Column(String(255))
    signature_data = Column(Text)
   
    # Relationships
    form_1571 = relationship("FDAForm1571", back_populates="document", uselist=False)
    form_1572 = relationship("FDAForm1572", back_populates="document", uselist=False)
 
class FDAForm1571(Base):
    __tablename__ = 'fda_form_1571'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey('fda_documents.id'))
   
    # IND Information
    ind_number = Column(String(50))
    submission_type = Column(String(100))
   
    # Drug Information
    drug_name = Column(String(255))
    dosage_form = Column(String(100))
    route_of_administration = Column(String(100))
    indication = Column(Text)
   
    # Study Information
    study_phase = Column(String(50))
    protocol_title = Column(Text)
    protocol_number = Column(String(100))
   
    # Sponsor Information
    sponsor_name = Column(String(255))
    sponsor_address = Column(Text)
    contact_person = Column(String(255))
    contact_phone = Column(String(50))
    contact_email = Column(String(255))
   
    # Regulatory Information
    fda_review_division = Column(String(255))
    cross_reference_inds = Column(JSON)
   
    # Certification
    signed_by = Column(String(255))
    date_signed = Column(Date)
   
    # Metadata
    extraction_metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
   
    # Relationship
    document = relationship("FDADocument", back_populates="form_1571")
 
class FDAForm1572(Base):
    __tablename__ = 'fda_form_1572'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(Integer, ForeignKey('fda_documents.id'))
   
    # Protocol Identification
    protocol_title = Column(Text)
    protocol_number = Column(String(100))
   
    # Investigator Information
    investigator_name = Column(String(255))
    investigator_address = Column(Text)
    investigator_phone = Column(String(50))
    investigator_email = Column(String(255))
   
    # Study Sites (JSON array)
    study_sites = Column(JSON)
   
    # IRB Information
    irb_name = Column(String(255))
    irb_address = Column(Text)
   
    # Sub-Investigators (JSON array)
    sub_investigators = Column(JSON)
   
    # Clinical Laboratories (JSON array)
    clinical_laboratories = Column(JSON)
   
    # Investigator Commitment
    agreement_signed = Column(Boolean, default=False)
    date_signed = Column(Date)
   
    # Metadata
    extraction_metadata = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
   
    # Relationship
    document = relationship("FDADocument", back_populates="form_1572")
 
class AuditLog(Base):
    __tablename__ = 'audit_trail'
   
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    action = Column(String(255), nullable=False)
    target_type = Column(String(100)) # e.g., 'trial', 'patient', 'document'
    target_id = Column(String(100))
    agent = Column(String(255), nullable=False) # e.g., 'SafetyReportingAgent v2.1'
    status = Column(String(50), nullable=False) # Success, Failure
    details = Column(JSON)
    document_hash = Column(String(64)) # SHA-256 hash of related data/file
    previous_hash = Column(String(64)) # Hash of the previous log entry for chaining
    entry_hash = Column(String(64))    # Hash of this entry (calculated by Auditor)
 
# Database setup
# Use singleton pattern for engine and sessionmaker to avoid "Too many connections"
_engine = None
_SessionLocal = None
 
def get_database():
    """Create and return database engine and session factory"""
    global _engine, _SessionLocal
   
    if _engine is None:
        import os
       
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable is not set. Please configure it to point to your PostgreSQL database.")
           
        # Create engine
        _engine = create_engine(db_url, echo=False)
       
        # Create tables if they don't exist (safe with PostgreSQL)
        Base.metadata.create_all(_engine)
        
        # Auto-migrate: add new columns to existing tables
        from sqlalchemy import text as sa_text
        with _engine.connect() as conn:
            try:
                conn.execute(sa_text("ALTER TABLE clinical_trials ADD COLUMN IF NOT EXISTS analysis_results JSON"))
                conn.execute(sa_text("ALTER TABLE clinical_trials ADD COLUMN IF NOT EXISTS analysis_status VARCHAR(20) DEFAULT 'pending'"))
                conn.execute(sa_text("ALTER TABLE clinical_trials ADD COLUMN IF NOT EXISTS document_id INTEGER"))
                conn.execute(sa_text("ALTER TABLE clinical_trials ADD COLUMN IF NOT EXISTS fda_1571 JSON"))
                conn.execute(sa_text("ALTER TABLE clinical_trials ADD COLUMN IF NOT EXISTS fda_1572 JSON"))
                conn.execute(sa_text("ALTER TABLE clinical_trials ADD COLUMN IF NOT EXISTS matching_config JSON"))
                conn.execute(sa_text("ALTER TABLE patient_eligibility ADD COLUMN IF NOT EXISTS organization_id INTEGER"))
                conn.commit()
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Auto-migration warning: {e}")
        
        _SessionLocal = sessionmaker(bind=_engine)
       
    return _engine, _SessionLocal
 
def get_session():
    """Get database session"""
    _, SessionLocal = get_database()
    return SessionLocal()