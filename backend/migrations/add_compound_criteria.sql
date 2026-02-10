-- Phase 2: Add compound criteria support to eligibility_criteria table

ALTER TABLE eligibility_criteria
ADD COLUMN IF NOT EXISTS group_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS group_logic VARCHAR(10),
ADD COLUMN IF NOT EXISTS temporal_window_months INTEGER,
ADD COLUMN IF NOT EXISTS scope VARCHAR(20) DEFAULT 'personal',
ADD COLUMN IF NOT EXISTS value_list JSON;

CREATE INDEX IF NOT EXISTS ix_eligibility_criteria_group_id ON eligibility_criteria(group_id);
CREATE INDEX IF NOT EXISTS ix_eligibility_criteria_scope ON eligibility_criteria(scope);

-- Verify columns were added
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'eligibility_criteria' 
  AND column_name IN ('group_id', 'group_logic', 'temporal_window_months', 'scope', 'value_list');
