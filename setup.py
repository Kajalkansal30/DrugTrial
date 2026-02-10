"""
Setup Script - Initialize the Drug Trial System
Run this first to set up everything
"""

import subprocess
import sys
import os

def print_step(step_num, message):
    print(f"\n{'='*60}")
    print(f"Step {step_num}: {message}")
    print('='*60)

def run_command(command, description):
    """Run a shell command and handle errors"""
    print(f"\n🔄 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print(f"✅ {description} completed")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Error: {e}")
        print(f"Output: {e.output}")
        return False

def main():
    print("\n🧬 Drug Trial Automation System - Setup\n")
    
    # Step 1: Check Python version
    print_step(1, "Checking Python version")
    python_version = sys.version_info
    print(f"Python {python_version.major}.{python_version.minor}.{python_version.micro}")
    
    if python_version.major < 3 or (python_version.major == 3 and python_version.minor < 8):
        print("❌ Python 3.8+ required")
        return
    
    # Step 2: Install dependencies
    print_step(2, "Installing Python dependencies")
    if not run_command("pip install -r requirements.txt", "Installing packages"):
        print("⚠️  Some packages may have failed. Continuing...")
    
    # Step 3: Download spaCy model
    print_step(3, "Downloading spaCy language model")
    run_command("python -m spacy download en_core_web_sm", "Downloading spaCy model")
    
    # Step 4: Initialize database
    print_step(4, "Initializing Database")
    print("Creating database schema...")
    
    # Assuming get_database is available (backend.db_models most likely)
    try:
        from backend.db_models import get_database
        engine, _ = get_database()
        print(f"✅ Database initialized")
    except ImportError:
        print("⚠️  Could not import backend.db_models to initialize database.")
        print("   Please ensure you are in the project root and dependencies are installed.")
    
    # Step 5: Import patient data
    print_step(5, "Importing patient data from CSV")
    
    if os.path.exists('data/sample_patients/patients.csv'):
        from import_data import import_all_data
        import_all_data()
    else:
        print("⚠️  Sample Patient CSV files not found in data/sample_patients/")
        print("   You can import data later using: python import_data.py")
    
    # Step 6: Test FDA form extraction
    print_step(6, "Testing FDA form extraction")
    
    if os.path.exists('data/drug/2.pdf'):
        from agents.fda_form_extractor import FDAFormExtractor
        extractor = FDAFormExtractor()
        result = extractor.extract_from_pdf('data/drug/2.pdf')
        
        print("\n📄 Extracted FDA Form Data:")
        print(f"  Drug Name: {result['fda_1571'].get('drug_name', 'Not found')}")
        print(f"  Phase: {result['fda_1571'].get('study_phase', 'Not found')}")
        print(f"  Indication: {result['fda_1571'].get('indication', 'Not found')}")
    else:
        print("⚠️  Drug PDF not found at data/drug/2.pdf")
    
    # Final summary
    print("\n" + "="*60)
    print("✨ Setup Complete!")
    print("="*60)
    print("\n📋 Next Steps:\n")
    print("1. Start the API server:")
    print("   uvicorn app:app --reload\n")
    print("2. Access the API:")
    print("   http://localhost:8201\n")
    print("3. View API documentation:")
    print("   http://localhost:8201/docs\n")
    print("4. Test endpoints:")
    print("   curl http://localhost:8201/patients")
    print("   curl http://localhost:8201/stats\n")
    
    print("💡 Tip: Check README.md for more details\n")

if __name__ == "__main__":
    main()
