"""Add compound criteria support to eligibility_criteria

Revision ID: add_compound_criteria
Revises: 
Create Date: 2026-02-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = 'add_compound_criteria'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    """Add columns for compound criteria, temporal constraints, and scope tracking."""
    
    # Add group_id for compound criteria grouping
    op.add_column('eligibility_criteria', 
                  sa.Column('group_id', sa.String(50), nullable=True))
    
    # Add group_logic for AND/OR compound logic
    op.add_column('eligibility_criteria', 
                  sa.Column('group_logic', sa.String(10), nullable=True))
    
    # Add temporal_window_months for recency constraints
    op.add_column('eligibility_criteria', 
                  sa.Column('temporal_window_months', sa.Integer, nullable=True))
    
    # Add scope for family vs personal history
    op.add_column('eligibility_criteria', 
                  sa.Column('scope', sa.String(20), server_default='personal', nullable=True))
    
    # Add value_list for multi-drug/multi-value rules (stored as JSON)
    op.add_column('eligibility_criteria', 
                  sa.Column('value_list', postgresql.JSON, nullable=True))
    
    # Create index on group_id for faster compound criteria lookups
    op.create_index('ix_eligibility_criteria_group_id', 'eligibility_criteria', ['group_id'])
    
    # Create index on scope for filtering
    op.create_index('ix_eligibility_criteria_scope', 'eligibility_criteria', ['scope'])


def downgrade():
    """Remove compound criteria support columns."""
    
    op.drop_index('ix_eligibility_criteria_scope', table_name='eligibility_criteria')
    op.drop_index('ix_eligibility_criteria_group_id', table_name='eligibility_criteria')
    
    op.drop_column('eligibility_criteria', 'value_list')
    op.drop_column('eligibility_criteria', 'scope')
    op.drop_column('eligibility_criteria', 'temporal_window_months')
    op.drop_column('eligibility_criteria', 'group_logic')
    op.drop_column('eligibility_criteria', 'group_id')
