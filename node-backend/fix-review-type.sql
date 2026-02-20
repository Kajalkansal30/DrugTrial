-- Ensure ReviewType enum exists
DO $$ BEGIN
    CREATE TYPE "ReviewType" AS ENUM (
        'PATIENT_APPROVAL',
        'PATIENT_REJECTION',
        'DOCUMENT_APPROVAL',
        'GENERAL_COMMENT',
        'REQUEST_INFO'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Verify the enum was created
SELECT 
    t.typname as enum_name,
    e.enumlabel as enum_value
FROM 
    pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid  
WHERE 
    t.typname = 'ReviewType'
ORDER BY 
    e.enumsortorder;
