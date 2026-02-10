
import os
import sys
from sqlalchemy import create_engine, text
import json

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://druguser:drugpass@postgres:5432/drugtrial")
engine = create_engine(DATABASE_URL)

def list_tables():
    with engine.connect() as conn:
        # Get all table names in the public schema
        res = conn.execute(text("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        """))
        tables = [row[0] for row in res]
        
        print(json.dumps(tables, indent=2))

if __name__ == "__main__":
    list_tables()
