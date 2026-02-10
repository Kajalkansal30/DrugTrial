import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Drawer, Box, Typography, Divider, List, ListItem,
    ListItemIcon, ListItemText, Chip, Grid, Paper, IconButton,
    Button, CircularProgress
} from '@mui/material';
import {
    CheckCircle, Cancel, Help, Person, Science,
    Close, ArrowForward
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

    // Helper to calculate age
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
        if (s.includes('HIGHLY')) return { color: '#2e7d32', border: '#4caf50', bg: '#f1f8e9' };
        if (s.includes('POTENTIALLY')) return { color: '#ef6c00', border: '#ff9800', bg: '#fff3e0' };
        if (s.includes('UNCERTAIN')) return { color: '#475569', border: '#94a3b8', bg: '#f1f5f9' }; // Slate/Grey for Uncertain
        if (s.includes('ERROR')) return { color: '#e65100', border: '#ff9800', bg: '#fff3e0' };
        return { color: '#c62828', border: '#f44336', bg: '#ffebee' }; // Default Red for Unable/Ineligible
    };

    const styles = getStatusStyles(eligibility_status);

    return (
        <Drawer anchor="right" open={open} onClose={onClose}>
            <Box sx={{ width: 500, p: 4 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', color: '#102a43' }}>Eligibility Analysis</Typography>
                    <IconButton onClick={onClose}><Close /></IconButton>
                </Box>

                <Divider sx={{ mb: 3 }} />

                {/* Patient Header */}
                <Box sx={{ mb: 4, display: 'flex', alignItems: 'center', p: 3, bgcolor: '#f0f4f8', borderRadius: 2 }}>
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
                        p: 3,
                        mb: 4,
                        textAlign: 'center',
                        borderRadius: 3,
                        border: '2px solid',
                        borderColor: styles.border,
                        bgcolor: styles.bg
                    }}
                >
                    <Typography variant="overline" sx={{ fontWeight: 'bold', color: 'text.secondary', letterSpacing: 2 }}>
                        {eligibility_status === 'error' ? 'SCREENING ERROR' : 'MATCH STATUS'}
                    </Typography>
                    <Typography variant="h3" sx={{
                        fontWeight: 'bold',
                        my: 1,
                        color: styles.color
                    }}>
                        {eligibility_status.toUpperCase()}
                    </Typography>
                    <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                        {eligibility_status === 'error' ? 'API Connection Failed' : `AI Confidence Score: ${(confidence_score * 100).toFixed(0)}%`}
                    </Typography>

                    {/* Confidence Breakdown */}
                    {reasons && reasons.scoring_weights && (
                        <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed #ccc' }}>
                            <Grid container spacing={1}>
                                <Grid item xs={4}>
                                    <Typography variant="caption" display="block" color="textSecondary">Match</Typography>
                                    <Typography variant="body2" fontWeight="bold">{(reasons.inclusion_score * 100).toFixed(0)}%</Typography>
                                    <Typography variant="caption" color="textSecondary" sx={{ fontSize: '0.65rem' }}>w: {(reasons.scoring_weights.inclusion * 100).toFixed(0)}%</Typography>
                                </Grid>
                                <Grid item xs={4}>
                                    <Typography variant="caption" display="block" color="textSecondary">Data</Typography>
                                    <Typography variant="body2" fontWeight="bold">{(reasons.data_completeness * 100).toFixed(0)}%</Typography>
                                    <Typography variant="caption" color="textSecondary" sx={{ fontSize: '0.65rem' }}>w: {(reasons.scoring_weights.data * 100).toFixed(0)}%</Typography>
                                </Grid>
                                <Grid item xs={4}>
                                    <Typography variant="caption" display="block" color="textSecondary">NLP</Typography>
                                    <Typography variant="body2" fontWeight="bold">{(reasons.nlp_certainty * 100).toFixed(0)}%</Typography>
                                    <Typography variant="caption" color="textSecondary" sx={{ fontSize: '0.65rem' }}>w: {(reasons.scoring_weights.nlp * 100).toFixed(0)}%</Typography>
                                </Grid>
                            </Grid>
                            {reasons.soft_exclusions > 0 && (
                                <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block', fontWeight: 'bold' }}>
                                    * Soft exclusion penalty applied
                                </Typography>
                            )}
                        </Box>
                    )}
                </Paper>

                {eligibility_status === 'error' ? (
                    <Box sx={{ p: 2, bgcolor: '#fff3e0', borderRadius: 2 }}>
                        <Typography variant="h6" color="warning.main">Technical Connection Issue</Typography>
                        <Typography variant="body2">
                            The automated screening agent encountered a technical error while processing this patient.
                            This is usually due to a temporary backend timeout or database connection issue.
                        </Typography>
                        <Button variant="outlined" color="warning" sx={{ mt: 2 }} onClick={() => window.location.reload()}>
                            Retry Screening
                        </Button>
                    </Box>
                ) : (
                    <>
                        {/* Clinical Profile Section */}
                        <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', mt: 4, fontWeight: 'bold' }}>
                            <Science sx={{ mr: 1, color: '#102a43' }} /> Clinical Highlights
                        </Typography>

                        {loadingDetails ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                                <CircularProgress size={24} />
                            </Box>
                        ) : (
                            <Box sx={{ mb: 4, pl: 1 }}>
                                <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Primary Conditions</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                                    {patientDetails?.conditions && patientDetails.conditions.length > 0 ? (
                                        patientDetails.conditions.slice(0, 5).map((c, i) => (
                                            <Chip key={i} label={c.description} size="small" variant="outlined" />
                                        ))
                                    ) : (
                                        <Typography variant="caption" color="textSecondary">No conditions recorded</Typography>
                                    )}
                                </Box>

                                <Typography variant="subtitle2" color="primary" sx={{ mb: 1 }}>Key Lab Values</Typography>
                                <Grid container spacing={2}>
                                    {patientDetails?.observations && patientDetails.observations.length > 0 ? (
                                        patientDetails.observations.slice(0, 4).map((obs, i) => (
                                            <Grid item xs={6} key={i}>
                                                <Paper variant="outlined" sx={{ p: 1, textAlign: 'center' }}>
                                                    <Typography variant="caption" display="block" noWrap>{obs.description.split(':')[0]}</Typography>
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
                            </Box>
                        )}

                        <Divider sx={{ my: 4 }} />

                        {/* Clinical Reasoning Section */}
                        <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>Clinical Decision Reasoning</Typography>

                        <Box sx={{ mt: 3 }}>
                            <Typography variant="subtitle2" sx={{ color: '#2e7d32', mb: 1, fontWeight: 'bold' }}>INCLUSION CRITERIA MET</Typography>
                            <List dense>
                                {reasons.inclusion_details?.map((item, idx) => (
                                    <ListItem key={idx}>
                                        <ListItemIcon sx={{ minWidth: 36 }}>
                                            {item.met ? <CheckCircle color="success" fontSize="small" /> : <Help color="disabled" fontSize="small" />}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={item.text}
                                            secondary={item.met ? "Requirement Satisfied" : "Not Met"}
                                            primaryTypographyProps={{ variant: 'body2', fontWeight: item.met ? 'bold' : 'normal' }}
                                        />
                                    </ListItem>
                                ))}
                            </List>

                            <Typography variant="subtitle2" sx={{ color: '#c62828', mt: 3, mb: 1, fontWeight: 'bold' }}>EXCLUSION CRITERIA</Typography>
                            <List dense>
                                {reasons.exclusion_details?.map((item, idx) => (
                                    <ListItem key={idx}>
                                        <ListItemIcon sx={{ minWidth: 36 }}>
                                            {item.met ? <Cancel color="error" fontSize="small" /> : <CheckCircle color="success" fontSize="small" />}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={item.text}
                                            secondary={item.met ? "Exclusion Triggered" : "No Conflict Found"}
                                            primaryTypographyProps={{ variant: 'body2', fontWeight: item.met ? 'bold' : 'normal' }}
                                        />
                                    </ListItem>
                                ))}
                            </List>
                        </Box>
                    </>
                )}


                <Box sx={{ mt: 6 }}>
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
        </Drawer >
    );
};

export default TrialAnalysisSidebar;
