import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Drawer, Box, Typography, Divider, List, ListItem,
    ListItemIcon, ListItemText, Chip, Grid, Paper, IconButton,
    Button, CircularProgress, Tooltip, LinearProgress
} from '@mui/material';
import {
    CheckCircle, Cancel, Help, Person, Science,
    Close, ArrowForward, Shield, Warning, Info,
    AdminPanelSettings, DataObject, Gavel
} from '@mui/icons-material';

const TrialAnalysisSidebar = ({ open, onClose, patient, trial, analysis }) => {
    const [patientDetails, setPatientDetails] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);
    const API_URL = process.env.REACT_APP_API_URL || '';

    useEffect(() => {
        if (open && patient) {
            fetchPatientDetails();
        } else {
            setPatientDetails(null);
        }
    }, [open, patient]);

    const fetchPatientDetails = async () => {
        try {
            setLoadingDetails(true);
            const res = await axios.get(`${API_URL}/api/patients/${patient.id}`);
            setPatientDetails(res.data);
            setLoadingDetails(false);
        } catch (err) {
            console.error("Failed to fetch patient details", err);
            setLoadingDetails(false);
        }
    };

    if (!analysis || !patient) return null;

    const { eligibility_status, confidence_score, reasons } = analysis;

    const getAge = (birthdate) => {
        if (!birthdate) return 'Unknown';
        const today = new Date();
        const birthDate = new Date(birthdate);
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    };

    const getStatusStyles = (status) => {
        const s = (status || '').toUpperCase();
        if (s.includes('HIGHLY')) return { color: '#065f46', border: '#10b981', bg: '#ecfdf5' };
        if (s.includes('POTENTIALLY')) return { color: '#92400e', border: '#f59e0b', bg: '#fffbeb' };
        if (s.includes('UNCERTAIN')) return { color: '#475569', border: '#94a3b8', bg: '#f1f5f9' };
        if (s.includes('ERROR')) return { color: '#e65100', border: '#ff9800', bg: '#fff3e0' };
        return { color: '#be123c', border: '#e11d48', bg: '#fff1f2' };
    };

    const styles = getStatusStyles(eligibility_status);

    const inclusionMet = reasons?.inclusion_details?.filter(d => d.met).length || 0;
    const inclusionTotal = reasons?.inclusion_details?.length || 0;
    const exclusionTriggered = reasons?.exclusion_details?.filter(d => d.met).length || 0;
    const exclusionTotal = reasons?.exclusion_details?.length || 0;
    const hardExclusions = reasons?.hard_exclusions || 0;
    const softExclusions = reasons?.soft_exclusions || 0;
    const adminAutoPassed = reasons?.administrative_auto_passed || 0;
    const missingDataCount = reasons?.missing_data?.length || 0;

    const ScoreBar = ({ label, value, weight, color }) => (
        <Box sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: '#334155' }}>{label}</Typography>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color }}>{(value * 100).toFixed(0)}%</Typography>
                    {weight !== undefined && (
                        <Typography variant="caption" sx={{ color: '#94a3b8', fontSize: '0.65rem' }}>
                            w:{(weight * 100).toFixed(0)}%
                        </Typography>
                    )}
                </Box>
            </Box>
            <LinearProgress
                variant="determinate"
                value={Math.min(value * 100, 100)}
                sx={{
                    height: 6, borderRadius: 3,
                    bgcolor: '#f1f5f9',
                    '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 3 }
                }}
            />
        </Box>
    );

    return (
        <Drawer anchor="right" open={open} onClose={onClose}>
            <Box sx={{ width: 560, p: 4, overflowY: 'auto' }}>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#102a43' }}>Eligibility Analysis</Typography>
                    <IconButton onClick={onClose}><Close /></IconButton>
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* Patient Header */}
                <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', p: 3, bgcolor: '#f0f4f8', borderRadius: 2 }}>
                    <Person sx={{ fontSize: 48, mr: 2, color: '#1976d2' }} />
                    <Box>
                        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Patient ID: {patient.id}</Typography>
                        <Typography variant="body2" color="textSecondary">
                            {patient.gender === 'M' ? 'Male' : 'Female'} | {getAge(patient.birthdate)}Y
                        </Typography>
                    </Box>
                </Box>

                {/* Match Status Card */}
                <Paper
                    elevation={0}
                    sx={{
                        p: 3, mb: 3, textAlign: 'center', borderRadius: 3,
                        border: '2px solid', borderColor: styles.border, bgcolor: styles.bg
                    }}
                >
                    <Typography variant="overline" sx={{ fontWeight: 'bold', color: 'text.secondary', letterSpacing: 2 }}>
                        {eligibility_status === 'error' ? 'SCREENING ERROR' : 'MATCH STATUS'}
                    </Typography>
                    <Typography variant="h4" sx={{ fontWeight: 'bold', my: 1, color: styles.color }}>
                        {eligibility_status.toUpperCase()}
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                        {eligibility_status === 'error' ? 'API Connection Failed' : `AI Confidence Score: ${(confidence_score * 100).toFixed(1)}%`}
                    </Typography>
                </Paper>

                {eligibility_status === 'error' ? (
                    <Box sx={{ p: 2, bgcolor: '#fff3e0', borderRadius: 2 }}>
                        <Typography variant="h6" color="warning.main">Technical Connection Issue</Typography>
                        <Typography variant="body2">
                            The automated screening agent encountered a technical error while processing this patient.
                        </Typography>
                        <Button variant="outlined" color="warning" sx={{ mt: 2 }} onClick={() => window.location.reload()}>
                            Retry Screening
                        </Button>
                    </Box>
                ) : (
                    <>
                        {/* ── Scoring Breakdown ── */}
                        {reasons && reasons.scoring_weights && (
                            <Paper elevation={0} sx={{ p: 2.5, mb: 3, bgcolor: '#f8fafc', borderRadius: 2, border: '1px solid #e2e8f0' }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Gavel sx={{ fontSize: 18 }} /> Confidence Breakdown
                                </Typography>
                                <ScoreBar
                                    label="Inclusion Match"
                                    value={reasons.inclusion_score || 0}
                                    weight={reasons.scoring_weights.inclusion}
                                    color={reasons.inclusion_score >= 0.8 ? '#10b981' : reasons.inclusion_score >= 0.5 ? '#f59e0b' : '#ef4444'}
                                />
                                <ScoreBar
                                    label="Exclusion Clearance"
                                    value={reasons.exclusion_score || 0}
                                    weight={reasons.scoring_weights.exclusion}
                                    color={reasons.exclusion_score >= 0.9 ? '#10b981' : reasons.exclusion_score >= 0.5 ? '#f59e0b' : '#ef4444'}
                                />
                                <ScoreBar
                                    label="Data Completeness"
                                    value={reasons.data_completeness || 0}
                                    weight={reasons.scoring_weights.data}
                                    color={reasons.data_completeness >= 0.7 ? '#10b981' : '#f59e0b'}
                                />
                                <ScoreBar
                                    label="NLP Certainty"
                                    value={reasons.nlp_certainty || 0}
                                    weight={reasons.scoring_weights.nlp}
                                    color={reasons.nlp_certainty >= 0.7 ? '#10b981' : '#f59e0b'}
                                />
                            </Paper>
                        )}

                        {/* ── Summary Chips ── */}
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
                            <Tooltip title="Inclusion criteria met out of total">
                                <Chip
                                    icon={<CheckCircle sx={{ fontSize: 16 }} />}
                                    label={`${inclusionMet}/${inclusionTotal} Inclusions`}
                                    size="small"
                                    sx={{ bgcolor: '#ecfdf5', color: '#065f46', fontWeight: 600, border: '1px solid #a7f3d0' }}
                                />
                            </Tooltip>
                            {exclusionTriggered > 0 ? (
                                <Tooltip title={`${hardExclusions} hard, ${softExclusions} soft exclusions triggered`}>
                                    <Chip
                                        icon={<Warning sx={{ fontSize: 16 }} />}
                                        label={`${exclusionTriggered} Exclusion${exclusionTriggered > 1 ? 's' : ''} Triggered`}
                                        size="small"
                                        sx={{ bgcolor: '#fff1f2', color: '#be123c', fontWeight: 600, border: '1px solid #fecdd3' }}
                                    />
                                </Tooltip>
                            ) : (
                                <Chip
                                    icon={<Shield sx={{ fontSize: 16 }} />}
                                    label={`0/${exclusionTotal} Exclusions`}
                                    size="small"
                                    sx={{ bgcolor: '#ecfdf5', color: '#065f46', fontWeight: 600, border: '1px solid #a7f3d0' }}
                                />
                            )}
                            {adminAutoPassed > 0 && (
                                <Tooltip title="Administrative criteria (consent, contraception) auto-passed">
                                    <Chip
                                        icon={<AdminPanelSettings sx={{ fontSize: 16 }} />}
                                        label={`${adminAutoPassed} Admin Auto-Pass`}
                                        size="small"
                                        sx={{ bgcolor: '#eff6ff', color: '#1e40af', fontWeight: 600, border: '1px solid #bfdbfe' }}
                                    />
                                </Tooltip>
                            )}
                            {missingDataCount > 0 && (
                                <Tooltip title="Criteria where patient data was insufficient for evaluation">
                                    <Chip
                                        icon={<DataObject sx={{ fontSize: 16 }} />}
                                        label={`${missingDataCount} Missing Data`}
                                        size="small"
                                        sx={{ bgcolor: '#fffbeb', color: '#92400e', fontWeight: 600, border: '1px solid #fde68a' }}
                                    />
                                </Tooltip>
                            )}
                        </Box>

                        {/* ── Clinical Profile ── */}
                        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', fontWeight: 'bold' }}>
                            <Science sx={{ mr: 1, color: '#102a43' }} /> Clinical Highlights
                        </Typography>

                        {loadingDetails ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                                <CircularProgress size={24} />
                            </Box>
                        ) : (
                            <Box sx={{ mb: 3, pl: 1 }}>
                                <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Primary Conditions</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                                    {patientDetails?.conditions && patientDetails.conditions.length > 0 ? (
                                        patientDetails.conditions.slice(0, 8).map((c, i) => (
                                            <Chip key={i} label={c.description} size="small" variant="outlined" />
                                        ))
                                    ) : (
                                        <Typography variant="caption" color="textSecondary">No conditions recorded</Typography>
                                    )}
                                    {patientDetails?.conditions?.length > 8 && (
                                        <Chip label={`+${patientDetails.conditions.length - 8} more`} size="small" sx={{ bgcolor: '#f1f5f9' }} />
                                    )}
                                </Box>

                                <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Key Lab Values</Typography>
                                <Grid container spacing={1}>
                                    {patientDetails?.observations && patientDetails.observations.length > 0 ? (
                                        patientDetails.observations.slice(0, 8).map((obs, i) => (
                                            <Grid item xs={6} key={i}>
                                                <Paper variant="outlined" sx={{ p: 1, textAlign: 'center' }}>
                                                    <Typography variant="caption" display="block" noWrap sx={{ fontSize: '0.65rem' }}>
                                                        {(obs.description || '').split(':')[0]}
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                                        {obs.value} {obs.units}
                                                    </Typography>
                                                </Paper>
                                            </Grid>
                                        ))
                                    ) : (
                                        <Grid item xs={12}>
                                            <Typography variant="caption" color="textSecondary">No lab values recorded</Typography>
                                        </Grid>
                                    )}
                                </Grid>
                                {patientDetails?.observations?.length > 8 && (
                                    <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                                        +{patientDetails.observations.length - 8} more observations
                                    </Typography>
                                )}
                            </Box>
                        )}

                        <Divider sx={{ my: 3 }} />

                        {/* ── Clinical Decision Reasoning ── */}
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Gavel sx={{ fontSize: 20 }} /> Clinical Decision Reasoning
                        </Typography>

                        {/* Inclusion Criteria */}
                        <Box sx={{ mt: 2 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Typography variant="subtitle2" sx={{ color: '#065f46', fontWeight: 'bold' }}>
                                    INCLUSION CRITERIA
                                </Typography>
                                <Chip
                                    label={`${inclusionMet}/${inclusionTotal} met`}
                                    size="small"
                                    sx={{
                                        height: 20, fontSize: '0.65rem', fontWeight: 700,
                                        bgcolor: inclusionMet === inclusionTotal ? '#ecfdf5' : '#fffbeb',
                                        color: inclusionMet === inclusionTotal ? '#065f46' : '#92400e',
                                    }}
                                />
                            </Box>
                            <List dense sx={{ bgcolor: '#fafffe', borderRadius: 1, border: '1px solid #e2e8f0' }}>
                                {reasons?.inclusion_details?.map((item, idx) => (
                                    <ListItem key={idx} sx={{
                                        borderBottom: idx < (reasons.inclusion_details.length - 1) ? '1px solid #f1f5f9' : 'none',
                                        py: 0.5
                                    }}>
                                        <ListItemIcon sx={{ minWidth: 32 }}>
                                            {item.met ?
                                                <CheckCircle sx={{ color: '#10b981', fontSize: 18 }} /> :
                                                <Help sx={{ color: '#94a3b8', fontSize: 18 }} />
                                            }
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={item.text}
                                            secondary={item.met ? "Requirement Satisfied" : "Not Met / Insufficient Data"}
                                            primaryTypographyProps={{
                                                variant: 'body2',
                                                fontWeight: item.met ? 600 : 400,
                                                sx: { fontSize: '0.8rem', lineHeight: 1.4 }
                                            }}
                                            secondaryTypographyProps={{
                                                sx: {
                                                    fontSize: '0.65rem',
                                                    color: item.met ? '#065f46' : '#94a3b8'
                                                }
                                            }}
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        </Box>

                        {/* Exclusion Criteria */}
                        <Box sx={{ mt: 3 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Typography variant="subtitle2" sx={{ color: '#be123c', fontWeight: 'bold' }}>
                                    EXCLUSION CRITERIA
                                </Typography>
                                <Chip
                                    label={exclusionTriggered > 0 ? `${exclusionTriggered} triggered` : 'All clear'}
                                    size="small"
                                    sx={{
                                        height: 20, fontSize: '0.65rem', fontWeight: 700,
                                        bgcolor: exclusionTriggered === 0 ? '#ecfdf5' : '#fff1f2',
                                        color: exclusionTriggered === 0 ? '#065f46' : '#be123c',
                                    }}
                                />
                                {hardExclusions > 0 && (
                                    <Chip
                                        label={`${hardExclusions} hard`}
                                        size="small"
                                        sx={{
                                            height: 20, fontSize: '0.65rem', fontWeight: 700,
                                            bgcolor: '#fee2e2', color: '#991b1b',
                                        }}
                                    />
                                )}
                            </Box>
                            <List dense sx={{ bgcolor: '#fffbfb', borderRadius: 1, border: '1px solid #e2e8f0' }}>
                                {reasons?.exclusion_details?.map((item, idx) => {
                                    const isHard = item.is_hard;
                                    return (
                                        <ListItem key={idx} sx={{
                                            borderBottom: idx < (reasons.exclusion_details.length - 1) ? '1px solid #f1f5f9' : 'none',
                                            py: 0.5,
                                            bgcolor: item.met ? (isHard ? '#fef2f2' : '#fff7ed') : 'transparent'
                                        }}>
                                            <ListItemIcon sx={{ minWidth: 32 }}>
                                                {item.met ?
                                                    <Cancel sx={{ color: isHard ? '#dc2626' : '#ea580c', fontSize: 18 }} /> :
                                                    <CheckCircle sx={{ color: '#10b981', fontSize: 18 }} />
                                                }
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <Typography variant="body2" sx={{
                                                            fontWeight: item.met ? 600 : 400,
                                                            fontSize: '0.8rem', lineHeight: 1.4,
                                                            color: item.met ? '#991b1b' : '#334155'
                                                        }}>
                                                            {item.text}
                                                        </Typography>
                                                    </Box>
                                                }
                                                secondary={
                                                    item.met
                                                        ? (isHard ? "HARD EXCLUSION - Patient Disqualified" : "Soft Exclusion Triggered")
                                                        : "No Conflict Found"
                                                }
                                                secondaryTypographyProps={{
                                                    sx: {
                                                        fontSize: '0.65rem',
                                                        fontWeight: item.met ? 700 : 400,
                                                        color: item.met ? (isHard ? '#dc2626' : '#ea580c') : '#065f46'
                                                    }
                                                }}
                                            />
                                        </ListItem>
                                    );
                                })}
                            </List>
                        </Box>

                        {/* Missing Data Warning */}
                        {missingDataCount > 0 && (
                            <Box sx={{ mt: 3, p: 2, bgcolor: '#fffbeb', borderRadius: 2, border: '1px solid #fde68a' }}>
                                <Typography variant="subtitle2" sx={{ color: '#92400e', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                    <Info sx={{ fontSize: 18 }} /> Missing Data Notice
                                </Typography>
                                <Typography variant="body2" sx={{ color: '#78350f', fontSize: '0.8rem' }}>
                                    {missingDataCount} criteria could not be fully evaluated due to insufficient patient data.
                                    This may affect the confidence score. Consider collecting additional lab results or medical records.
                                </Typography>
                            </Box>
                        )}
                    </>
                )}

                <Box sx={{ mt: 4 }}>
                    <Button
                        variant="contained"
                        fullWidth
                        size="large"
                        sx={{ bgcolor: '#102a43', py: 1.5, borderRadius: 2 }}
                        endIcon={<ArrowForward />}
                    >
                        Export Clinical Verification PDF
                    </Button>
                </Box>
            </Box>
        </Drawer>
    );
};

export default TrialAnalysisSidebar;
