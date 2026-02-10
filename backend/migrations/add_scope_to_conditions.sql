-- Phase 3: Add scope column to conditions table for family vs personal history

ALTER TABLE conditions
ADD COLUMN IF NOT EXISTS scope VARCHAR(20) DEFAULT 'personal';

CREATE INDEX IF NOT EXISTS ix_conditions_scope ON conditions(scope);

-- Verify column was added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'conditions' 
  AND column_name = 'scope';
