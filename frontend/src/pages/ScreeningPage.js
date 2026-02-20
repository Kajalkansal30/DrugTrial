import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Chip, Card, CardContent,
    CircularProgress, LinearProgress, Alert, Tooltip
} from '@mui/material';
import { VerifiedUser, Group, Analytics, FactCheck, HelpCenter, Refresh, Warning, Send, Save } from '@mui/icons-material';
import apiClient from '../utils/apiClient';
import { useParams } from 'react-router-dom';
import TrialAnalysisSidebar from '../components/TrialAnalysisSidebar';
import SendToPIDialog from '../components/SendToPIDialog';

const ScreeningPage = ({ trialData }) => {
    const { trialId } = useParams();
    const [localTrialData, setLocalTrialData] = useState(trialData);
    const [patients, setPatients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [matching, setMatching] = useState(false);
    const [progress, setProgress] = useState(0);
    const [stats, setStats] = useState({ total: 0, eligible: 0, potential: 0, uncertain: 0, ineligible: 0 });
    const [filterStatus, setFilterStatus] = useState('ALL');

    const [screeningDone, setScreeningDone] = useState(false);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [analysisOpen, setAnalysisOpen] = useState(false);
    const [currentAnalysis, setCurrentAnalysis] = useState(null);
    const [sendToPIDialog, setSendToPIDialog] = useState({ open: false, trial: null, eligibility: [] });
    const [saveStatus, setSaveStatus] = useState({ saved: false, saving: false, message: '' });

    const API_URL = import.meta.env.VITE_API_URL || '';
    const [analysisTriggered, setAnalysisTriggered] = useState(false);

    // Fetch trial data if not provided via props or if trial data is incomplete
    useEffect(() => {
        // Check if trialData is valid (has trial_id or id)
        const hasValidTrialData = trialData && (trialData.trial_id || trialData.id);

        if (!hasValidTrialData && trialId) {
            console.log('ScreeningPage: trialData is missing or incomplete, fetching trial data for:', trialId);
            fetchTrialData();
        } else if (hasValidTrialData) {
            setLocalTrialData(trialData);
        }
    }, [trialData, trialId]);

    const fetchTrialData = async () => {
        try {
            const response = await apiClient.get('/api/trials');
            const trials = response.data;
            const trial = trials.find(t => t.trial_id === trialId || t.id === parseInt(trialId));
            if (trial) {
                console.log('ScreeningPage: Found trial data:', trial);
                setLocalTrialData(trial);
            } else {
                console.error('ScreeningPage: Trial not found for ID:', trialId);
            }
        } catch (error) {
            console.error('ScreeningPage: Error fetching trial data:', error);
        }
    };

    useEffect(() => {
        fetchData();
        triggerAnalysis();
    }, [trialId]);

    useEffect(() => {
        if (patients.length > 0 && !matching && !screeningDone) {
            runFullScreening();
        }
    }, [patients, screeningDone]);

    const triggerAnalysis = async () => {
        if (analysisTriggered) return;
        setAnalysisTriggered(true);
        try {
            await apiClient.post(`/api/trials/${trialId}/run-analysis`);
        } catch (_) { /* best-effort */ }
    };

    const fetchData = async () => {
        try {
            setLoading(true);
            const response = await apiClient.get('/api/patients');
            const patientList = response.data.patients || [];
            setPatients(patientList);
            setStats(prev => ({ ...prev, total: patientList.length }));
            setLoading(false);

            // Try to load saved patient analyses if we have trial data
            if (localTrialData && (localTrialData.id || localTrialData.trial_id)) {
                const dbTrialId = localTrialData.id || localTrialData.trial_id;
                await loadSavedAnalyses(dbTrialId, patientList);
            }
        } catch (err) {
            console.error("Failed to fetch patients", err);
            setLoading(false);
        }
    };

    // Load saved patient analyses from database
    const loadSavedAnalyses = async (dbTrialId, patientList = patients) => {
        try {
            console.log(`Loading saved patient analyses for trial ${dbTrialId}...`);
            const res = await apiClient.get(`/api/patient-analysis/trial/${dbTrialId}`);

            if (res.data && res.data.length > 0) {
                console.log(`✅ Loaded ${res.data.length} saved patient analyses`);

                // Merge saved analyses with patient data
                const updatedPatients = patientList.map(p => {
                    const savedAnalysis = res.data.find(a => a.patientId === p.id);
                    if (savedAnalysis) {
                        return {
                            ...p,
                            age: savedAnalysis.patient.age || p.age,
                            gender: savedAnalysis.patient.gender || p.gender,
                            birthdate: savedAnalysis.patient.birthdate || p.birthdate,
                            conditions: savedAnalysis.patient.conditions || p.conditions,
                            observations: savedAnalysis.patient.observations || p.observations,
                            eligibility: {
                                eligibility_status: savedAnalysis.eligibility_status,
                                confidence_score: savedAnalysis.confidence_score,
                                reasons: savedAnalysis.reasons
                            }
                        };
                    }
                    return p;
                });

                setPatients(updatedPatients);

                // Update stats based on saved analyses
                let counts = { highly: 0, potential: 0, uncertain: 0, ineligible: 0 };
                res.data.forEach(a => {
                    const status = (a.eligibility_status || '').toUpperCase();
                    if (status.includes('HIGHLY')) counts.highly++;
                    else if (status.includes('POTENTIALLY')) counts.potential++;
                    else if (status.includes('UNCERTAIN')) counts.uncertain++;
                    else counts.ineligible++;
                });

                setStats({
                    total: res.data.length,
                    eligible: counts.highly,
                    potential: counts.potential,
                    uncertain: counts.uncertain,
                    ineligible: counts.ineligible
                });

                setScreeningDone(true);
                setSaveStatus({
                    saved: true,
                    saving: false,
                    message: '✅ Previously saved analysis data loaded from database'
                });
            } else {
                console.log('No saved analyses found for this trial');
            }
        } catch (err) {
            console.log('No saved analyses available:', err.message);
            // Not an error - just means screening hasn't been run yet
        }
    };

    const runFullScreening = async () => {
        if (matching) return;
        setMatching(true);
        setProgress(0);

        try {
            const trialRes = await apiClient.get(`/api/trials/${trialId}/rules`);
            const dbTrialId = trialRes.data.id;

            if (!dbTrialId) {
                console.error("Could not find internal trial ID");
                setMatching(false);
                return;
            }

            const patientIds = patients.map(p => p.id);
            setProgress(10);

            const res = await apiClient.post('/api/eligibility/batch-check', {
                patient_ids: patientIds,
                trial_id: dbTrialId
            });

            setProgress(80);

            const results = res.data.results;
            let counts = { highly: 0, potential: 0, uncertain: 0, ineligible: 0 };
            const updatedPatients = patients.map(p => {
                const result = results[p.id];
                if (result) {
                    const status = (result.status || '').toUpperCase();
                    if (status.includes('HIGHLY')) counts.highly++;
                    else if (status.includes('POTENTIALLY')) counts.potential++;
                    else if (status.includes('UNCERTAIN')) counts.uncertain++;
                    else counts.ineligible++;

                    return {
                        ...p, eligibility: {
                            eligibility_status: result.status,
                            confidence_score: result.confidence,
                            reasons: result.reasons
                        }
                    };
                }
                return p;
            });

            setPatients(updatedPatients);
            setStats({
                total: updatedPatients.length,
                eligible: counts.highly,
                potential: counts.potential,
                uncertain: counts.uncertain,
                ineligible: counts.ineligible
            });

            setProgress(100);
            setScreeningDone(true);
            setSaveStatus({ saved: true, saving: false, message: 'Results automatically saved to database' });

            // Auto-save comprehensive analysis data to Node backend database
            await saveAnalysesToDatabase(dbTrialId, updatedPatients);

        } catch (err) {
            console.error("Screening batch error", err);
            setPatients(prev => prev.map(p => ({
                ...p,
                eligibility: { eligibility_status: 'error', reasons: { error: "Batch Screen Failed" } }
            })));
            setScreeningDone(true);
            setSaveStatus({ saved: false, saving: false, message: 'Error during screening' });
        } finally {
            setMatching(false);
        }
    };

    const saveAnalysesToDatabase = async (trialId, patientsWithAnalysis) => {
        try {
            // Filter patients that have eligibility results
            const patientsToSave = patientsWithAnalysis.filter(p => p.eligibility);

            if (patientsToSave.length === 0) {
                console.log('No patient analyses to save');
                return;
            }

            // Format analyses for database
            const analyses = patientsToSave.map(p => ({
                patientId: p.id,
                eligibility_status: p.eligibility.eligibility_status,
                confidence_score: p.eligibility.confidence_score,
                reasons: p.eligibility.reasons,
                patient: {
                    id: p.id,
                    age: p.age,
                    gender: p.gender,
                    birthdate: p.birthdate,
                    conditions: p.conditions,
                    observations: p.observations
                }
            }));

            console.log(`Saving ${analyses.length} comprehensive patient analyses to database...`);
            console.log('Sample analysis data:', {
                patientId: analyses[0]?.patientId,
                hasReasons: !!analyses[0]?.reasons,
                reasonsKeys: Object.keys(analyses[0]?.reasons || {}),
                inclusionDetailsCount: analyses[0]?.reasons?.inclusion_details?.length || 0,
                exclusionDetailsCount: analyses[0]?.reasons?.exclusion_details?.length || 0,
                sampleInclusionDetail: analyses[0]?.reasons?.inclusion_details?.[0]
            });

            const res = await apiClient.post('/api/patient-analysis/save-batch', {
                trialId: trialId,
                analyses: analyses
            });

            console.log(`✅ Saved patient analyses:`, res.data);
        } catch (err) {
            console.error('Failed to save patient analyses:', err);
            // Don't fail the screening if save fails
        }
    };

    const saveResultsToDatabase = async () => {
        if (!patients.length) {
            alert('No patient results to save');
            return;
        }

        setSaveStatus({ saved: false, saving: true, message: 'Saving results...' });

        try {
            const trialRes = await apiClient.get(`/api/trials/${trialId}/rules`);
            const dbTrialId = trialRes.data.id;

            if (!dbTrialId) {
                throw new Error("Could not find internal trial ID");
            }

            const patientIds = patients.filter(p => p.eligibility).map(p => p.id);

            if (patientIds.length === 0) {
                alert('No screened patients to save');
                setSaveStatus({ saved: false, saving: false, message: '' });
                return;
            }

            console.log(`Saving ${patientIds.length} patient results to database for trial ${dbTrialId}`);

            const res = await apiClient.post('/api/eligibility/batch-check', {
                patient_ids: patientIds,
                trial_id: dbTrialId
            });

            console.log('Save response:', res.data);

            setSaveStatus({
                saved: true,
                saving: false,
                message: `✅ Successfully saved ${res.data.saved_count || 0} new and updated ${res.data.updated_count || 0} existing patient records`
            });

            // Auto-hide success message after 5 seconds
            setTimeout(() => {
                setSaveStatus(prev => ({ ...prev, message: '' }));
            }, 5000);

        } catch (err) {
            console.error("Error saving results:", err);
            setSaveStatus({
                saved: false,
                saving: false,
                message: `❌ Error saving results: ${err.message}`
            });
        }
    };

    const getStatusColor = (status) => {
        if (!status) return 'default';
        const s = status.toUpperCase();
        if (s.includes('HIGHLY')) return 'success';
        if (s.includes('POTENTIALLY')) return 'warning';
        if (s.includes('UNCERTAIN')) return 'default';
        if (s.includes('INELIGIBLE')) return 'error';
        if (s.includes('ERROR')) return 'error';
        return 'default';
    };

    const viewAnalysis = (patient) => {
        if (!patient.eligibility) {
            alert("Please run Full Screening first.");
            return;
        }
        setSelectedPatient(patient);
        setCurrentAnalysis(patient.eligibility);
        setAnalysisOpen(true);
    };

    const handleSendToPI = () => {
        console.log('ScreeningPage handleSendToPI - localTrialData:', localTrialData);

        if (!localTrialData) {
            alert('Error: Trial information is not available. Please wait for the trial data to load.');
            return;
        }

        // Prepare eligibility data directly from current patients state
        // Include all patient data (id, age, gender, etc.) plus eligibility results
        const eligibilityData = patients
            .filter(p => p.eligibility) // Only patients with eligibility results
            .map(p => ({
                patient_id: p.id,
                id: p.id,
                age: p.age,
                gender: p.gender,
                eligibility_status: p.eligibility.eligibility_status,
                confidence_score: p.eligibility.confidence_score,
                reasons: p.eligibility.reasons
            }));

        setSendToPIDialog({
            open: true,
            trial: localTrialData,
            eligibility: eligibilityData
        });
    };

    const handleCloseSendToPI = () => {
        setSendToPIDialog({ open: false, trial: null, eligibility: [] });
    };

    const handleFilter = (status) => {
        setFilterStatus(status);
    };

    const filteredPatients = patients.filter(p => {
        if (filterStatus === 'ALL') return true;
        const s = (p.eligibility?.eligibility_status || '').toUpperCase();
        if (filterStatus === 'HIGHLY') return s.includes('HIGHLY');
        if (filterStatus === 'POTENTIALLY') return s.includes('POTENTIALLY');
        if (filterStatus === 'UNCERTAIN') return s.includes('UNCERTAIN') || s.includes('REVIEW');
        if (filterStatus === 'INELIGIBLE') return s.includes('INELIGIBLE') || s.includes('ERROR');
        return false;
    });

    const COLORS = {
        eligible: { bg: '#ecfdf5', text: '#065f46', border: '#10b981' },
        potential: { bg: '#fffbeb', text: '#92400e', border: '#f59e0b' },
        uncertain: { bg: '#f8fafc', text: '#475569', border: '#94a3b8' },
        ineligible: { bg: '#fff1f2', text: '#be123c', border: '#e11d48' },
        info: { bg: '#eff6ff', text: '#1e40af', border: '#3b82f6' }
    };

    const StatusChip = ({ status }) => {
        const s = (status || '').toUpperCase();
        let style = COLORS.uncertain;
        if (s.includes('HIGHLY')) style = COLORS.eligible;
        else if (s.includes('POTENTIALLY')) style = COLORS.potential;
        else if (s.includes('INELIGIBLE')) style = COLORS.ineligible;

        return (
            <Chip
                label={s}
                size="small"
                sx={{
                    bgcolor: style.bg,
                    color: style.text,
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    border: `1px solid ${style.border}40`,
                    height: 24
                }}
            />
        );
    };

    const getInclusionLabel = (reasons) => {
        if (!reasons?.inclusion_details) return '-';
        const met = reasons.inclusion_details.filter(d => d.met).length;
        const total = reasons.inclusion_details.length;
        return `${met}/${total}`;
    };

    const getExclusionLabel = (reasons) => {
        if (!reasons?.exclusion_details) return '-';
        const triggered = reasons.exclusion_details.filter(d => d.met).length;
        return triggered > 0 ? `${triggered} triggered` : 'Clear';
    };

    const hasScreeningRun = patients.some(p => p.eligibility);

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                <Box>
                    <Typography variant="h5" sx={{ fontWeight: 800, color: '#102a43' }}>Eligible Patient Dashboard</Typography>
                    <Typography variant="body1" color="textSecondary" sx={{ mb: 2 }}>
                        Real-time screening results across the {stats.total} patient cohort.
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    {hasScreeningRun && !matching && (
                        <>
                            <Button
                                variant="outlined"
                                startIcon={<Refresh />}
                                onClick={() => { setScreeningDone(false); setTimeout(runFullScreening, 0); }}
                                sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
                            >
                                Re-run Screening
                            </Button>
                            <Button
                                variant="contained"
                                startIcon={<Send />}
                                onClick={handleSendToPI}
                                sx={{
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    borderRadius: 2,
                                    bgcolor: '#1e3a8a',
                                    '&:hover': { bgcolor: '#1e40af' }
                                }}
                            >
                                Send to Principal Investigator
                            </Button>
                        </>
                    )}
                </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, mb: 4 }}>
                <StatCard title="Total Cohort" count={stats.total} icon={<Group />}
                    theme={COLORS.info} isActive={filterStatus === 'ALL'} onClick={() => handleFilter('ALL')} />
                <StatCard title="Highly Eligible" count={stats.eligible} icon={<VerifiedUser />}
                    theme={COLORS.eligible} isActive={filterStatus === 'HIGHLY'} onClick={() => handleFilter('HIGHLY')} />
                <StatCard title="Potentially Eligible" count={stats.potential} icon={<FactCheck />}
                    theme={COLORS.potential} isActive={filterStatus === 'POTENTIALLY'} onClick={() => handleFilter('POTENTIALLY')} />
                <StatCard title="Needs Review" count={stats.uncertain} icon={<HelpCenter />}
                    theme={COLORS.uncertain} isActive={filterStatus === 'UNCERTAIN'} onClick={() => handleFilter('UNCERTAIN')} />
                <StatCard title="Ineligible" count={stats.ineligible} icon={<Analytics />}
                    theme={COLORS.ineligible} isActive={filterStatus === 'INELIGIBLE'} onClick={() => handleFilter('INELIGIBLE')} />
            </Box>

            {matching && (
                <Box sx={{ mb: 3 }}>
                    <Typography variant="body2" color="textSecondary" gutterBottom>
                        Screening Progress: {progress}%
                    </Typography>
                    <LinearProgress variant="determinate" value={progress} sx={{ height: 10, borderRadius: 5 }} />
                </Box>
            )}

            {screeningDone && patients.length > 0 && (
                <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={saveStatus.saving ? <CircularProgress size={20} color="inherit" /> : <Save />}
                            onClick={saveResultsToDatabase}
                            disabled={saveStatus.saving || matching}
                            sx={{ mr: 2 }}
                        >
                            {saveStatus.saving ? 'Saving...' : 'Save Results to Database'}
                        </Button>
                        {saveStatus.message && (
                            <Typography
                                variant="caption"
                                color={saveStatus.saved ? 'success.main' : 'error.main'}
                                sx={{ ml: 1 }}
                            >
                                {saveStatus.message}
                            </Typography>
                        )}
                    </Box>
                </Box>
            )}

            <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0' }}>
                <Table stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Patient ID</TableCell>
                            <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Match Status</TableCell>
                            <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Confidence</TableCell>
                            <TableCell sx={{ fontWeight: 800, color: '#475569' }}>
                                <Tooltip title="Inclusion criteria met out of total"><span>Inclusions</span></Tooltip>
                            </TableCell>
                            <TableCell sx={{ fontWeight: 800, color: '#475569' }}>
                                <Tooltip title="Exclusion criteria triggered"><span>Exclusions</span></Tooltip>
                            </TableCell>
                            <TableCell sx={{ fontWeight: 800, color: '#475569' }}>
                                <Tooltip title="Percentage of criteria with available patient data"><span>Data</span></Tooltip>
                            </TableCell>
                            <TableCell sx={{ fontWeight: 800, color: '#475569' }}>Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={7} align="center"><CircularProgress /></TableCell></TableRow>
                        ) : (
                            filteredPatients.map((patient) => {
                                const elig = patient.eligibility;
                                const reasons = elig?.reasons;
                                const excTriggered = reasons?.exclusion_details?.filter(d => d.met).length || 0;

                                return (
                                    <TableRow key={patient.id} hover>
                                        <TableCell sx={{ fontWeight: 600 }}>{patient.id}</TableCell>
                                        <TableCell>
                                            <StatusChip status={elig?.eligibility_status || 'Waiting...'} />
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" sx={{ fontWeight: 700, color: '#334155' }}>
                                                {elig ? `${(elig.confidence_score * 100).toFixed(0)}%` : '-'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" sx={{
                                                fontWeight: 600,
                                                color: reasons?.inclusion_score >= 0.8 ? '#065f46' :
                                                    reasons?.inclusion_score >= 0.5 ? '#92400e' : '#475569'
                                            }}>
                                                {getInclusionLabel(reasons)}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            {excTriggered > 0 ? (
                                                <Chip
                                                    icon={<Warning sx={{ fontSize: 14 }} />}
                                                    label={`${excTriggered}`}
                                                    size="small"
                                                    sx={{
                                                        bgcolor: '#fff1f2', color: '#be123c',
                                                        fontWeight: 700, fontSize: '0.7rem', height: 22,
                                                        border: '1px solid #fecdd3'
                                                    }}
                                                />
                                            ) : (
                                                <Typography variant="body2" sx={{ color: '#065f46', fontWeight: 600 }}>
                                                    {reasons ? 'Clear' : '-'}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2" sx={{
                                                fontWeight: 600,
                                                color: (reasons?.data_completeness || 0) >= 0.7 ? '#065f46' : '#92400e'
                                            }}>
                                                {reasons ? `${(reasons.data_completeness * 100).toFixed(0)}%` : '-'}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                onClick={() => viewAnalysis(patient)}
                                                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                                            >
                                                View Analysis
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <TrialAnalysisSidebar
                open={analysisOpen}
                onClose={() => setAnalysisOpen(false)}
                patient={selectedPatient}
                trial={localTrialData}
                analysis={currentAnalysis}
            />

            <SendToPIDialog
                open={sendToPIDialog.open}
                onClose={handleCloseSendToPI}
                trial={sendToPIDialog.trial}
                eligibilityResults={sendToPIDialog.eligibility}
            />
        </Box>
    );
};

const StatCard = ({ title, count, icon, theme, onClick, isActive }) => (
    <Card sx={{
        flex: 1,
        bgcolor: isActive ? theme.bg : 'white',
        borderLeft: `5px solid ${theme.border}`,
        boxShadow: isActive ? `0 0 0 2px ${theme.border}` : '0 2px 4px rgba(0,0,0,0.05)',
        cursor: 'pointer',
        transition: 'all 0.2s',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }
    }} onClick={onClick}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2, '&:last-child': { pb: 2 } }}>
            <Box>
                <Typography sx={{ color: isActive ? theme.text : '#64748b', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {title}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 700, color: theme.text }}>
                    {count}
                </Typography>
            </Box>
            <Box sx={{
                p: 1.5,
                borderRadius: '50%',
                bgcolor: isActive ? 'white' : theme.bg,
                color: theme.border,
                display: 'flex'
            }}>
                {icon}
            </Box>
        </CardContent>
    </Card>
);

export default ScreeningPage;
