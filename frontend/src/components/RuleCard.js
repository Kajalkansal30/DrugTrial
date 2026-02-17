import React from 'react';
import { Card, CardContent, Typography, Box, Chip, Tooltip } from '@mui/material';
import {
    Science,
    Event,
    Person,
    PregnantWoman,
    QuestionMark,
    Code,
    Gavel,
    Block,
    Medication,
    SportsGymnastics,
    LocalHospital,
    MonitorHeart,
    History,
    Verified,
    Male,
    Female
} from '@mui/icons-material';

const formatUnit = (unit) => {
    const unitMap = {
        'years': 'Years',
        'kg': 'kg',
        'mmHg': 'mmHg',
        'msec': 'msec',
        'ms': 'ms',
        'bpm': 'bpm',
        'L/min': 'L/min',
        'cm3': 'cm³',
        'cm³': 'cm³',
        '/mm3': '/mm³',
        'mg/dL': 'mg/dL',
        'g/dL': 'g/dL',
        'mmol/L': 'mmol/L',
        '× ULN': '× ULN',
        'x ULN': '× ULN',
        'ULN': '× ULN'
    };
    return unitMap[unit] || unit;
};

const RuleCard = ({ rule }) => {
    const sData = rule.structured_data || {};

    // Determine if this is an absence constraint
    const isAbsence = sData.operator === 'ABSENT' ||
        sData.rule_type === 'CONDITION_ABSENT' ||
        rule.category === 'CONDITION_ABSENT';

    // COLOR LOGIC FIX:
    // Only use Red theme if it is explicitly an EXCLUSION rule or a Withdrawal criteria
    // Inclusion criteria with "negation" (e.g. "Must NOT be pregnant") should still use GREEN theme,
    // but with a Red internal badge.
    const isStrictExclusion = rule.type === 'exclusion' || rule.type === 'withdrawal';

    // Color palette
    const accentColor = isStrictExclusion ? '#be123c' : '#047857'; // Red for Exclusion, Green for Inclusion
    const lightColor = isStrictExclusion ? '#fff1f2' : '#ecfdf5';
    const borderColor = isStrictExclusion ? '#fecdd3' : '#a7f3d0';

    const getIcon = (category, ruleType) => {
        const cat = (ruleType || category || '').toUpperCase();
        const iconStyle = { fontSize: 20, color: accentColor, opacity: 0.9 };

        if (cat === 'LAB_THRESHOLD') return <Science sx={iconStyle} />;
        if (cat === 'AGE' || cat === 'WEIGHT') return <Person sx={iconStyle} />;
        if (cat === 'TEMPORAL') return <Event sx={iconStyle} />;
        if (cat.includes('PREGNANCY') || cat === 'CONTRACEPTION') return <PregnantWoman sx={iconStyle} />;
        if (cat === 'CONDITION_ABSENT') return <Block sx={iconStyle} />;
        if (cat === 'MEDICATION_HISTORY' || cat === 'MEDICATION_CONTRAINDICATION') return <Medication sx={iconStyle} />;
        if (cat === 'LIFESTYLE') return <SportsGymnastics sx={iconStyle} />;
        if (cat === 'PROCEDURE_HISTORY' || cat === 'SURGERY') return <LocalHospital sx={iconStyle} />;
        if (cat === 'VITAL_SIGN' || cat === 'EKG') return <MonitorHeart sx={iconStyle} />;
        if (cat === 'REPRODUCTIVE_STATUS') return <Person sx={iconStyle} />;
        if (cat === 'MEDICAL_HISTORY') return <History sx={iconStyle} />;
        if (cat === 'CONSENT_REQUIREMENT') return <Verified sx={iconStyle} />;
        if (cat.includes('CONDITION')) return isAbsence ? <Block sx={iconStyle} /> : <Gavel sx={iconStyle} />;

        return <QuestionMark sx={iconStyle} />;
    };

    const safeLabel = (val) => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        let s = String(val).replace(/\n/g, ' ').trim();
        return s;
    };

    // Clean text for display: normalize newlines to spaces
    const cleanText = (text) => {
        if (!text) return '';
        return text.replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    };

    const renderLogic = () => {
        const data = rule.structured_data || {};
        const hasLogic = data && (data.field || data.value || data.temporal_window || isAbsence || data.applies_to || data.negated);

        if (!hasLogic) return null;

        const showValue = data.value && String(data.value).trim() !== '' && 
            String(data.value).toLowerCase() !== 'true' && 
            String(data.value).toLowerCase() !== 'null' &&
            String(data.value).toLowerCase() !== 'false';
        // Only show value2 if it's a short numeric/range value, not a long description
        const showValue2 = data.value2 && String(data.value2).trim() !== '' && String(data.value2).length < 50;

        return (
            <Box sx={{
                mt: 1.5, pt: 1.5,
                borderTop: '1px solid rgba(0,0,0,0.04)',
                display: 'flex',
                alignItems: 'center',
                gap: 1.2,
                flexWrap: 'wrap'
            }}>
                {/* Status Badge */}
                {data.negated ? (
                    <Chip
                        icon={<Block style={{ fontSize: 13, color: 'white' }} />}
                        label="MUST NOT"
                        size="small"
                        sx={{
                            height: 20, fontSize: '0.65rem', fontWeight: 800,
                            bgcolor: '#e11d48', color: 'white',
                            '& .MuiChip-icon': { color: 'white' }
                        }}
                    />
                ) : isAbsence ? (
                    <Chip
                        icon={<Block style={{ fontSize: 13, color: 'white' }} />}
                        label="MUST BE ABSENT"
                        size="small"
                        sx={{
                            height: 20, fontSize: '0.65rem', fontWeight: 800,
                            bgcolor: '#e11d48', color: 'white',
                            '& .MuiChip-icon': { color: 'white' }
                        }}
                    />
                ) : (
                    <Chip
                        icon={<Gavel style={{ fontSize: 13 }} />}
                        label={data.operator === 'PRESENT' ? 'MUST BE PRESENT' : 'REQUIRED'}
                        size="small"
                        sx={{
                            height: 20, fontSize: '0.65rem', fontWeight: 800,
                            bgcolor: '#d1fae5', color: '#065f46',
                            '& .MuiChip-icon': { color: '#065f46' }
                        }}
                    />
                )}

                {/* Population Scope - Enhanced with icons */}
                {data.applies_to && data.applies_to !== 'ALL' && (
                    <Chip
                        icon={
                            data.applies_to === 'MALE' ? <Male style={{ fontSize: 13 }} /> :
                                data.applies_to === 'FEMALE' ? <Female style={{ fontSize: 13 }} /> : null
                        }
                        label={`${data.applies_to} ONLY`}
                        size="small"
                        variant="outlined"
                        sx={{
                            height: 20,
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            borderColor: data.applies_to === 'FEMALE' ? '#ec4899' : '#3b82f6',
                            color: data.applies_to === 'FEMALE' ? '#ec4899' : '#3b82f6',
                            '& .MuiChip-icon': {
                                color: data.applies_to === 'FEMALE' ? '#ec4899' : '#3b82f6'
                            }
                        }}
                    />
                )}

                {/* Field Name */}
                {data.field && data.field.length > 2 && (
                    <Tooltip title={safeLabel(data.field)} placement="top">
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 700, fontSize: '0.65rem' }}>FIELD:</Typography>
                            <Chip
                                label={safeLabel(data.field).length > 30 ? safeLabel(data.field).slice(0, 28) + '...' : safeLabel(data.field)}
                                size="small"
                                variant="outlined"
                                sx={{
                                    height: 20,
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    borderColor: borderColor,
                                    color: accentColor,
                                    bgcolor: 'white',
                                    maxWidth: 220,
                                    '& .MuiChip-label': {
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    }
                                }}
                            />
                        </Box>
                    </Tooltip>
                )}

                {/* Operator */}
                {data.operator && data.operator.trim() !== '' && data.operator !== 'PRESENT' && data.operator !== 'ABSENT' && data.operator !== 'AND' && (
                    <Typography variant="caption" sx={{ fontWeight: 800, color: accentColor, fontSize: '0.75rem', px: 0.5 }}>
                        {data.operator}
                    </Typography>
                )}

                {/* Value and Value2 for ranges - Enhanced */}
                {(showValue || showValue2) && (
                    <Box sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        bgcolor: lightColor,
                        border: `1px solid ${borderColor}`,
                        borderRadius: 1,
                        px: 1,
                        py: 0.3
                    }}>
                        <Typography variant="caption" sx={{
                            fontSize: '0.7rem',
                            fontWeight: 600,
                            color: accentColor
                        }}>
                            {showValue && safeLabel(data.value)}
                            {showValue2 && ` - ${safeLabel(data.value2)}`}
                            {data.unit && ` ${formatUnit(data.unit)}`}
                        </Typography>
                    </Box>
                )}

                {/* Temporal constraints */}
                {data.temporal_window && (
                    <Typography variant="caption" sx={{ color: '#475569', ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: '#f1f5f9', px: 0.8, borderRadius: 1 }}>
                        <Event sx={{ fontSize: 12 }} />
                        {data.operator?.includes('WITHIN') ? 'Within' : 'Last'} {data.temporal_window} {data.temporal_unit || 'days'}
                    </Typography>
                )}

                {/* UMLS Concept indicator */}
                {data.umls_cui && (
                    <Tooltip title={`UMLS: ${data.umls_cui}`}>
                        <Chip
                            icon={<Verified style={{ fontSize: 12 }} />}
                            label="UMLS"
                            size="small"
                            sx={{
                                height: 18,
                                fontSize: '0.6rem',
                                fontWeight: 700,
                                bgcolor: '#dbeafe',
                                color: '#1d4ed8',
                                '& .MuiChip-icon': { color: '#1d4ed8' }
                            }}
                        />
                    </Tooltip>
                )}
            </Box>
        );
    };

    return (
        <Card sx={{
            mb: 2,
            borderLeft: `4px solid ${accentColor}`,
            bgcolor: 'white',
            borderRadius: 1.5,
            transition: 'all 0.2s ease-in-out',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }
        }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {getIcon(rule.category, rule.structured_data?.rule_type)}
                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {rule.structured_data?.rule_type?.replace(/_/g, ' ') || rule.category || 'Clinical Rule'}
                        </Typography>
                    </Box>
                    <Tooltip title="Extracted from source document - no hallucination">
                        <Code sx={{ fontSize: 14, color: 'text.disabled', opacity: 0.5 }} />
                    </Tooltip>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <Typography sx={{
                        fontWeight: 500,
                        color: '#334155',
                        fontSize: '0.875rem',
                        lineHeight: 1.6,
                        flex: 1,
                        wordBreak: 'break-word'
                    }}>
                        {cleanText(rule.text)}
                    </Typography>
                    {rule.source_text && (
                        <Tooltip
                            title={
                                <Box sx={{ maxWidth: 400 }}>
                                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>
                                        Original Source:
                                    </Typography>
                                    <Typography variant="caption">
                                        {rule.source_text}
                                    </Typography>
                                </Box>
                            }
                        >
                            <Chip
                                icon={<Code style={{ fontSize: 11 }} />}
                                label="SOURCE"
                                size="small"
                                sx={{
                                    height: 18,
                                    fontSize: '0.55rem',
                                    cursor: 'pointer',
                                    bgcolor: '#f1f5f9',
                                    '&:hover': { bgcolor: '#e2e8f0' }
                                }}
                            />
                        </Tooltip>
                    )}
                </Box>

                {renderLogic()}
            </CardContent>
        </Card>
    );
};

export default RuleCard;
