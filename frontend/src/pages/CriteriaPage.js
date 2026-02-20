import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Typography, Button, Paper, Grid, Stack, Tabs, Tab,
    Drawer, List, ListItem, ListItemText, ListItemIcon,
    Divider, IconButton, Fade, CircularProgress, Alert, Chip,
    LinearProgress
} from '@mui/material';
import {
    Psychology, PlayArrow, Close, AutoStories, BarChart,
    Science, LocalHospital
} from '@mui/icons-material';
import apiClient from '../utils/apiClient';
import { useParams, useNavigate } from 'react-router-dom';
import RuleCard from '../components/RuleCard';

const API_URL = import.meta.env.VITE_API_URL || '';

const CriteriaPage = () => {
    const { trialId } = useParams();
    const [rules, setRules] = useState([]);
    const [ruleTypeSummary, setRuleTypeSummary] = useState({});
    const [loading, setLoading] = useState(true);
    const [extracting, setExtracting] = useState(false);
    const [extractProgress, setExtractProgress] = useState(0);
    const [extractMessage, setExtractMessage] = useState('');
    const [error, setError] = useState(null);
    const [glossaryOpen, setGlossaryOpen] = useState(false);
    const [glossaryTerms, setGlossaryTerms] = useState([]);
    const [activeTab, setActiveTab] = useState(0);
    const navigate = useNavigate();

    const fetchRules = useCallback(async () => {
        try {
            const response = await apiClient.get(`/api/trials/${trialId}/rules`);
            const fetchedRules = response.data.rules || [];
            setRules(fetchedRules);
            setRuleTypeSummary(response.data._summary || {});
            return fetchedRules.length;
        } catch (err) {
            console.error("Failed to fetch rules", err);
            return 0;
        }
    }, [trialId]);

    const fetchGlossary = useCallback(async () => {
        try {
            const response = await apiClient.get(`/api/trials/${trialId}/glossary`);
            setGlossaryTerms(response.data.glossary || []);
        } catch (err) {
            setGlossaryTerms([]);
        }
    }, [trialId]);

    const triggerExtraction = useCallback(async () => {
        setExtracting(true);
        setExtractProgress(5);
        setExtractMessage('Starting criteria extraction...');

        try {
            const res = await apiClient.post(`/api/trials/${trialId}/extract-criteria`);
            if (res.data.status === 'already_extracted') {
                setExtracting(false);
                await fetchRules();
                fetchGlossary();
                return;
            }

            const poll = setInterval(async () => {
                try {
                    const statusRes = await apiClient.get(`/api/trials/${trialId}/criteria-status`);
                    const data = statusRes.data;
                    setExtractProgress(data.progress || 0);
                    setExtractMessage(data.message || 'Processing...');

                    if (data.status === 'done') {
                        clearInterval(poll);
                        setExtracting(false);
                        await fetchRules();
                        fetchGlossary();
                    } else if (data.status === 'error') {
                        clearInterval(poll);
                        setExtracting(false);
                        setError(data.message || 'Criteria extraction failed');
                    }
                } catch (_) { /* keep polling */ }
            }, 3000);
        } catch (err) {
            setExtracting(false);
            setError('Failed to start criteria extraction');
        }
    }, [trialId, fetchRules, fetchGlossary]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const count = await fetchRules();
            if (!cancelled) {
                setLoading(false);
                if (count === 0) {
                    triggerExtraction();
                } else {
                    fetchGlossary();
                }
            }
        })();
        return () => { cancelled = true; };
    }, [trialId, fetchRules, triggerExtraction, fetchGlossary]);

    const inclusionRules = rules.filter(r => r.type === 'inclusion');
    const exclusionRules = rules.filter(r => r.type === 'exclusion');
    const labValueRules = rules.filter(r =>
        r.structured_data?.rule_type === 'LAB_THRESHOLD' || r.category === 'LAB_THRESHOLD'
    );
    const conditionRules = rules.filter(r =>
        r.structured_data?.rule_type?.includes('CONDITION') || r.category?.includes('CONDITION')
    );

    const tabs = [
        { label: 'All Criteria', count: rules.length },
        { label: 'Inclusion', count: inclusionRules.length },
        { label: 'Exclusion', count: exclusionRules.length },
        { label: 'Lab Values', count: labValueRules.length },
        { label: 'Conditions', count: conditionRules.length }
    ];

    const getFilteredRules = () => {
        switch (activeTab) {
            case 1: return inclusionRules;
            case 2: return exclusionRules;
            case 3: return labValueRules;
            case 4: return conditionRules;
            default: return rules;
        }
    };

    if (loading) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <CircularProgress size={60} thickness={4} sx={{ mb: 2 }} />
                <Typography variant="h6" color="textSecondary">Loading criteria...</Typography>
            </Box>
        );
    }

    if (extracting) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <Psychology sx={{ fontSize: 64, color: '#1976d2', mb: 2 }} />
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                    Extracting Eligibility Criteria
                </Typography>
                <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
                    {extractMessage}
                </Typography>
                <Box sx={{ width: '60%', mb: 2 }}>
                    <LinearProgress variant="determinate" value={extractProgress}
                        sx={{ height: 10, borderRadius: 5 }} />
                </Box>
                <Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>
                    {extractProgress}%
                </Typography>
                <Typography variant="caption" color="textSecondary" sx={{ mt: 2 }}>
                    Using scispaCy + Llama 3.1 to extract structured rules from the protocol
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ pb: 6 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#102a43', mb: 1 }}>
                        Protocol Intelligence
                    </Typography>
                    <Typography variant="subtitle1" color="textSecondary">
                        Step 3: Structured Eligibility Criteria Extraction
                    </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                    <Button variant="outlined" startIcon={<AutoStories />}
                        onClick={() => setGlossaryOpen(true)} sx={{ borderRadius: 2 }}>
                        Medical Glossary ({glossaryTerms.length})
                    </Button>
                    <Button variant="contained" endIcon={<PlayArrow />}
                        onClick={() => navigate(`/trial/${trialId}/screening`)}
                        sx={{ borderRadius: 2, px: 3, bgcolor: '#102a43' }}>
                        Analyze Patient Match
                    </Button>
                </Stack>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

            <Paper sx={{ p: 3, mb: 4, bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 2 }}>
                <Grid container alignItems="center" spacing={4}>
                    <Grid item xs={12} md={7}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
                            <Box sx={{ bgcolor: 'white', p: 1.5, borderRadius: 2, display: 'flex', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                                <Psychology sx={{ fontSize: 32, color: '#475569' }} />
                            </Box>
                            <Box>
                                <Typography variant="h6" sx={{ fontWeight: 700, color: '#1e293b' }}>
                                    Dynamic NLP Extraction Active
                                </Typography>
                                <Typography variant="body2" sx={{ color: '#64748b' }}>
                                    scispaCy + Llama 3.1 extracted <strong>{rules.length}</strong> criteria with <strong>{glossaryTerms.length}</strong> medical terms
                                </Typography>
                            </Box>
                        </Box>
                    </Grid>
                    <Grid item xs={12} md={5}>
                        <Stack direction="row" spacing={4} justifyContent={{ xs: 'center', md: 'flex-end' }}>
                            <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="h5" sx={{ fontWeight: 800, color: '#047857' }}>{inclusionRules.length}</Typography>
                                <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', fontWeight: 700 }}>Inclusion</Typography>
                            </Box>
                            <Divider orientation="vertical" flexItem />
                            <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="h5" sx={{ fontWeight: 800, color: '#be123c' }}>{exclusionRules.length}</Typography>
                                <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', fontWeight: 700 }}>Exclusion</Typography>
                            </Box>
                            <Divider orientation="vertical" flexItem />
                            <Box sx={{ textAlign: 'center' }}>
                                <Typography variant="h5" sx={{ fontWeight: 800, color: '#7c3aed' }}>{labValueRules.length}</Typography>
                                <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', fontWeight: 700 }}>Lab Tests</Typography>
                            </Box>
                        </Stack>
                    </Grid>
                </Grid>
            </Paper>

            {Object.keys(ruleTypeSummary).length > 0 && (
                <Paper sx={{ p: 3, mb: 3, borderRadius: 2, border: '1px solid #e2e8f0' }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>Rule Type Distribution</Typography>
                    <Grid container spacing={2}>
                        {Object.entries(ruleTypeSummary).map(([type, count]) => (
                            <Grid item xs={6} sm={4} md={3} key={type}>
                                <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                                    <Typography variant="h5" sx={{ fontWeight: 800, color: '#102a43' }}>{count}</Typography>
                                    <Typography variant="caption" sx={{ color: '#64748b', textTransform: 'uppercase', fontWeight: 600, fontSize: '0.65rem' }}>
                                        {type.replace(/_/g, ' ')}
                                    </Typography>
                                </Box>
                            </Grid>
                        ))}
                    </Grid>
                </Paper>
            )}

            <Paper sx={{ mb: 3, borderRadius: 2 }}>
                <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto"
                    sx={{ '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 48 } }}>
                    {tabs.map((tab, idx) => (
                        <Tab key={idx} label={
                            <Stack direction="row" spacing={1} alignItems="center">
                                <span>{tab.label}</span>
                                <Chip label={tab.count} size="small" sx={{
                                    height: 20, fontSize: '0.7rem',
                                    bgcolor: activeTab === idx ? '#102a43' : '#e2e8f0',
                                    color: activeTab === idx ? 'white' : '#475569'
                                }} />
                            </Stack>
                        } />
                    ))}
                </Tabs>
            </Paper>

            <Grid container spacing={3}>
                {getFilteredRules().map((rule, idx) => (
                    <Grid item xs={12} md={6} key={rule.id || idx}>
                        <Fade in={true} timeout={300 + idx * 100}>
                            <Box><RuleCard rule={rule} /></Box>
                        </Fade>
                    </Grid>
                ))}
                {getFilteredRules().length === 0 && (
                    <Grid item xs={12}>
                        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 2, border: '1px dashed #ccc', bgcolor: 'transparent' }}>
                            <Typography color="textSecondary">No rules found in this category.</Typography>
                        </Paper>
                    </Grid>
                )}
            </Grid>

            <Drawer anchor="right" open={glossaryOpen} onClose={() => setGlossaryOpen(false)}
                PaperProps={{ sx: { width: { xs: '100%', sm: 420 }, p: 3 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                    <Typography variant="h5" sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <AutoStories color="primary" /> Extracted Medical Terms
                    </Typography>
                    <IconButton onClick={() => setGlossaryOpen(false)}><Close /></IconButton>
                </Box>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 3 }}>
                    Dynamic glossary built from NLP entity extraction using scispaCy.
                </Typography>
                {glossaryTerms.length > 0 ? (
                    <List disablePadding>
                        {glossaryTerms.map((term, index) => (
                            <React.Fragment key={term.term || index}>
                                <ListItem alignItems="flex-start" sx={{ px: 0, py: 2 }}>
                                    <ListItemIcon sx={{ minWidth: 40, mt: 0.5 }}>
                                        {term.semantic_type?.includes('Lab') ? (
                                            <Science color="primary" fontSize="small" />
                                        ) : (
                                            <LocalHospital color="primary" fontSize="small" />
                                        )}
                                    </ListItemIcon>
                                    <ListItemText
                                        primaryTypographyProps={{ component: 'div' }}
                                        secondaryTypographyProps={{ component: 'div' }}
                                        primary={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Typography sx={{ fontWeight: 700, color: '#102a43' }}>{term.term}</Typography>
                                                <Chip label={term.used_in} size="small" sx={{
                                                    height: 18, fontSize: '0.6rem',
                                                    bgcolor: term.used_in === 'inclusion' ? '#d1fae5' : '#fecdd3',
                                                    color: term.used_in === 'inclusion' ? '#047857' : '#be123c'
                                                }} />
                                            </Box>
                                        }
                                        secondary={
                                            <Box>
                                                {term.semantic_type && <Typography variant="caption" sx={{ color: '#64748b' }}>Type: {term.semantic_type}</Typography>}
                                                {term.umls_cui && <Typography variant="caption" sx={{ display: 'block', color: '#94a3b8' }}>UMLS: {term.umls_cui}</Typography>}
                                            </Box>
                                        }
                                    />
                                </ListItem>
                                {index < glossaryTerms.length - 1 && <Divider component="li" />}
                            </React.Fragment>
                        ))}
                    </List>
                ) : (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                        <Typography color="textSecondary">No medical terms extracted yet.</Typography>
                    </Box>
                )}
                <Box sx={{ mt: 'auto', p: 2, bgcolor: '#f0f4f8', borderRadius: 2 }}>
                    <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BarChart fontSize="inherit" /> Terms extracted dynamically via scispaCy NLP
                    </Typography>
                </Box>
            </Drawer>
        </Box>
    );
};

export default CriteriaPage;
