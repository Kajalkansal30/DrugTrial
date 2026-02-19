import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Chip, Card, CardContent,
    CircularProgress, LinearProgress, Alert, Tooltip
} from '@mui/material';
import { VerifiedUser, Group, Analytics, FactCheck, HelpCenter, Refresh, Warning } from '@mui/icons-material';
import apiClient from '../utils/apiClient';
import { useParams } from 'react-router-dom';
import TrialAnalysisSidebar from '../components/TrialAnalysisSidebar';

const ScreeningPage = ({ trialData }) => {
    const { trialId } = useParams();
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

    const API_URL = import.meta.env.VITE_API_URL || '';
    const [analysisTriggered, setAnalysisTriggered] = useState(false);

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
        } catch (err) {
            console.error("Failed to fetch patients", err);
            setLoading(false);
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

        } catch (err) {
            console.error("Screening batch error", err);
            setPatients(prev => prev.map(p => ({
                ...p,
                eligibility: { eligibility_status: 'error', reasons: { error: "Batch Screen Failed" } }
            })));
            setScreeningDone(true);
        } finally {
            setMatching(false);
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
                {hasScreeningRun && !matching && (
                    <Button
                        variant="outlined"
                        startIcon={<Refresh />}
                        onClick={() => { setScreeningDone(false); setTimeout(runFullScreening, 0); }}
                        sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
                    >
                        Re-run Screening
                    </Button>
                )}
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
                trial={trialData}
                analysis={currentAnalysis}
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
