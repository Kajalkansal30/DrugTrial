import React, { useState, useEffect } from 'react';
import {
    Container,
    Paper,
    Typography,
    Box,
    CircularProgress,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    IconButton,
    Collapse,
    Card,
    CardContent,
    Grid,
    Divider,
    Button,
    TableSortLabel
} from '@mui/material';
import {
    ExpandMore,
    ExpandLess,
    Visibility,
    CheckCircle,
    Cancel,
    HourglassEmpty,
    Science,
    Description,
    People,
    Send,
    ArrowUpward,
    ArrowDownward
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import SendToPIDialog from '../components/SendToPIDialog';
import TrialAnalysisSidebar from '../components/TrialAnalysisSidebar';
import TrialReportDownloader from '../components/TrialReportDownloader';

const API_URL = import.meta.env.VITE_API_URL || '';

function OrganizationDashboard() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [trials, setTrials] = useState([]);
    const [stats, setStats] = useState({
        totalTrials: 0,
        activeTrials: 0,
        totalPatients: 0,
        eligiblePatients: 0,
        totalSubmissions: 0,
        pendingApprovals: 0
    });
    const [expandedTrial, setExpandedTrial] = useState(null);
    const [trialDetails, setTrialDetails] = useState({});
    const [user, setUser] = useState(null);
    const [sendToPIDialog, setSendToPIDialog] = useState({ open: false, trial: null, eligibility: [] });
    const [submissions, setSubmissions] = useState([]);
    const [submissionSortBy, setSubmissionSortBy] = useState('date');
    const [submissionSortOrder, setSubmissionSortOrder] = useState('desc');
    const [trialSortBy, setTrialSortBy] = useState('date');
    const [trialSortOrder, setTrialSortOrder] = useState('desc');
    const [analysisOpen, setAnalysisOpen] = useState(false);
    const [selectedPatientAnalysis, setSelectedPatientAnalysis] = useState(null);
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);
    const [reportDialogOpen, setReportDialogOpen] = useState(false);
    const [selectedTrialForReport, setSelectedTrialForReport] = useState(null);
    const [reportEligibilityResults, setReportEligibilityResults] = useState([]);

    useEffect(() => {
        // Get user info from localStorage
        const userStr = localStorage.getItem('user');
        if (userStr) {
            setUser(JSON.parse(userStr));
        }
        fetchDashboardData();
    }, []);

    const fetchDashboardData = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch all trials and submissions (already filtered by organization in backend)
            const [trialsRes, submissionsRes] = await Promise.all([
                apiClient.get('/api/trials'),
                apiClient.get('/api/submissions').catch(() => ({ data: { submissions: [] } }))
            ]);
            console.log('Fetched trials:', trialsRes.data);
            console.log('Fetched submissions:', submissionsRes.data);
            setTrials(trialsRes.data);
            setSubmissions(submissionsRes.data.submissions || []);

            // Calculate stats
            const totalTrials = trialsRes.data.length;
            const activeTrials = trialsRes.data.filter(t =>
                t.status !== 'Completed' && t.status !== 'Cancelled'
            ).length;

            const totalSubmissions = submissionsRes.data.submissions?.length || 0;
            const pendingApprovals = submissionsRes.data.submissions?.filter(s =>
                s.status === 'SUBMITTED' || s.status === 'UNDER_REVIEW'
            ).length || 0;

            // Fetch patient eligibility data for stats
            try {
                const statsRes = await apiClient.get('/api/stats');
                setStats({
                    totalTrials,
                    activeTrials,
                    totalPatients: statsRes.data.total_patients || 0,
                    eligiblePatients: statsRes.data.eligible_patients || 0,
                    totalSubmissions,
                    pendingApprovals
                });
            } catch (e) {
                // Fallback if stats endpoint not available
                setStats({
                    totalTrials,
                    activeTrials,
                    totalPatients: 0,
                    eligiblePatients: 0,
                    totalSubmissions,
                    pendingApprovals
                });
            }
        } catch (err) {
            setError(err.response?.data?.detail || err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleExpandTrial = async (trialId) => {
        if (expandedTrial === trialId) {
            setExpandedTrial(null);
            return;
        }

        setExpandedTrial(trialId);

        // Fetch detailed data if not already loaded
        if (!trialDetails[trialId]) {
            try {
                // Fetch trial rules first to get the numeric trial ID
                const rulesRes = await apiClient.get(`/api/trials/${trialId}/rules`);
                const numericTrialId = rulesRes.data.id;

                console.log(`📥 Fetching patient analyses for trial ${trialId} (ID: ${numericTrialId})`);

                // Try to fetch comprehensive patient analyses from Node backend first
                let eligibilityData = [];
                try {
                    const analysisRes = await apiClient.get(`/api/patient-analysis/trial/${numericTrialId}`);
                    console.log(`✅ Loaded ${analysisRes.data.length} patient analyses from database`);

                    // Format to match expected structure for renderPatientResults
                    eligibilityData = analysisRes.data.map(a => ({
                        patient_id: a.patientId,
                        status: a.eligibility_status,
                        confidence: a.confidence_score,
                        criteria_met: a.criteria_met,
                        criteria_total: a.criteria_total,
                        evaluation_date: a.screened_at,
                        reasons: a.reasons
                    }));
                } catch (analysisErr) {
                    console.log('⚠️ No patient analyses in database, falling back to legacy endpoint');
                    // Fallback to old eligibility endpoint
                    const eligibilityRes = await apiClient.get(`/api/eligibility/results/${trialId}`);
                    eligibilityData = eligibilityRes.data || [];
                }

                setTrialDetails(prev => ({
                    ...prev,
                    [trialId]: {
                        rules: rulesRes.data,
                        eligibility: eligibilityData,
                        numericId: numericTrialId
                    }
                }));
            } catch (err) {
                console.error('Failed to fetch trial details:', err);
            }
        }
    };

    const getStatusColor = (status) => {
        const statusMap = {
            'Criteria Extracted': 'primary',
            'Forms Approved': 'success',
            'Active': 'success',
            'Completed': 'default',
            'Cancelled': 'error'
        };
        return statusMap[status] || 'default';
    };

    const getSubmissionStatusColor = (status) => {
        const statusMap = {
            'SUBMITTED': 'info',
            'UNDER_REVIEW': 'warning',
            'APPROVED': 'success',
            'PARTIALLY_APPROVED': 'warning',
            'REJECTED': 'error',
            'WITHDRAWN': 'default'
        };
        return statusMap[status] || 'default';
    };

    const getTrialSubmissions = (trialId) => {
        return submissions.filter(s => s.trial.id === trialId);
    };

    const handleSubmissionSort = (sortBy) => {
        if (submissionSortBy === sortBy) {
            setSubmissionSortOrder(submissionSortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSubmissionSortBy(sortBy);
            setSubmissionSortOrder('desc');
        }
    };

    const getSortedSubmissions = (trialSubmissions) => {
        return [...trialSubmissions].sort((a, b) => {
            let comparison = 0;
            switch (submissionSortBy) {
                case 'date':
                    comparison = new Date(a.submissionDate) - new Date(b.submissionDate);
                    break;
                case 'status':
                    comparison = a.status.localeCompare(b.status);
                    break;
                case 'pi':
                    comparison = (a.principalInvestigator?.user?.fullName || '').localeCompare(b.principalInvestigator?.user?.fullName || '');
                    break;
                case 'patients':
                    comparison = (a._count?.patients || a.patients?.length || 0) - (b._count?.patients || b.patients?.length || 0);
                    break;
                default:
                    comparison = 0;
            }
            return submissionSortOrder === 'asc' ? comparison : -comparison;
        });
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleTrialSort = (sortBy) => {
        if (trialSortBy === sortBy) {
            setTrialSortOrder(trialSortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setTrialSortBy(sortBy);
            setTrialSortOrder('desc');
        }
    };

    const getSortedTrials = () => {
        return [...trials].sort((a, b) => {
            let comparison = 0;
            switch (trialSortBy) {
                case 'date':
                    comparison = new Date(a.created_at || a.createdAt || 0) - new Date(b.created_at || b.createdAt || 0);
                    break;
                case 'trial_id':
                    comparison = (a.trial_id || '').localeCompare(b.trial_id || '');
                    break;
                case 'title':
                    comparison = (a.protocol_title || '').localeCompare(b.protocol_title || '');
                    break;
                case 'drug':
                    comparison = (a.drug_name || '').localeCompare(b.drug_name || '');
                    break;
                case 'phase':
                    comparison = (a.phase || '').localeCompare(b.phase || '');
                    break;
                case 'status':
                    comparison = (a.status || '').localeCompare(b.status || '');
                    break;
                default:
                    comparison = 0;
            }
            return trialSortOrder === 'asc' ? comparison : -comparison;
        });
    };

    const handleSendToPI = async (trial) => {
        console.log('handleSendToPI called with trial:', trial);

        if (!trial || !trial.id) {
            alert('Error: Trial information is not available');
            return;
        }

        // Fetch comprehensive patient analysis data from Node backend database
        try {
            console.log(`Fetching saved patient analyses from: /api/patient-analysis/trial/${trial.id}`);

            const response = await apiClient.get(`/api/patient-analysis/trial/${trial.id}`);
            const analysisData = response.data || [];

            console.log(`Fetched ${analysisData.length} saved patient analyses`);

            // Format data for SendToPIDialog with full analysis details
            const formattedEligibility = analysisData.map(analysis => ({
                patient_id: analysis.patientId,
                id: analysis.patientId,
                status: analysis.eligibility_status,
                eligibility_status: analysis.eligibility_status,
                confidence: analysis.confidence_score,
                confidence_score: analysis.confidence_score,
                age: analysis.patient?.age || analysis.patient_age || 'N/A',
                gender: analysis.patient?.gender || analysis.patient_gender || 'N/A',
                birthdate: analysis.patient?.birthdate,
                reasons: analysis.reasons || {},
                criteria_met: analysis.criteria_met || analysis.criteriaMetCount,
                criteria_total: analysis.criteria_total || analysis.criteriaTotalCount,
                overall_eligibility: analysis.eligibility_status,
                // Include full patient details for comprehensive view
                conditions: analysis.patient?.conditions,
                observations: analysis.patient?.observations,
                exclusions_triggered: analysis.exclusions_triggered || analysis.exclusionsTriggered,
                hard_exclusions: analysis.hard_exclusions || analysis.hardExclusions,
                screened_at: analysis.screened_at || analysis.screenedAt
            }));

            setSendToPIDialog({
                open: true,
                trial,
                eligibility: formattedEligibility
            });
        } catch (err) {
            console.log('No saved patient analyses found for trial', trial.id);
            console.error('Error:', err);

            // Fallback to old endpoint if new one doesn't have data
            try {
                console.log('Trying fallback: /api/submissions/eligibility/${trial.id}');
                const response = await apiClient.get(`/api/submissions/eligibility/${trial.id}`);
                const eligibilityData = response.data || [];

                const formattedEligibility = eligibilityData.map(result => ({
                    patient_id: result.patient_id,
                    id: result.patient_id,
                    status: result.status,
                    eligibility_status: result.status,
                    confidence: result.confidence,
                    confidence_score: result.confidence,
                    age: result.age || 'N/A',
                    gender: result.gender || 'N/A',
                    reasons: result.details?.reasons || [],
                    criteria_met: result.criteria_met,
                    criteria_total: result.criteria_total,
                    overall_eligibility: result.status
                }));

                setSendToPIDialog({
                    open: true,
                    trial,
                    eligibility: formattedEligibility
                });
            } catch (fallbackErr) {
                console.error('Fallback also failed:', fallbackErr);
                setSendToPIDialog({
                    open: true,
                    trial,
                    eligibility: []
                });
            }
        }
    };

    const handleCloseSendToPI = () => {
        setSendToPIDialog({ open: false, trial: null, eligibility: [] });
    };

    const handleSubmissionSuccess = () => {
        // Refresh dashboard to show updated submission status
        fetchDashboardData();
    };

    const handleViewPatientAnalysis = async (patientId, trialId) => {
        console.log('handleViewPatientAnalysis called with:', { patientId, trialId });
        setLoadingAnalysis(true);
        try {
            // Fetch comprehensive analysis data from database
            console.log(`Fetching patient analysis from: /api/patient-analysis/patient/${trialId}/${patientId}`);
            const response = await apiClient.get(`/api/patient-analysis/patient/${trialId}/${patientId}`);
            const analysisData = response.data;
            console.log('Analysis data received:', analysisData);

            // Format patient data for TrialAnalysisSidebar
            const formattedPatient = {
                id: patientId,
                gender: analysisData.patient.gender,
                birthdate: analysisData.patient.birthdate || null,
                age: analysisData.patient.age,
                conditions: analysisData.patient.conditions || [],
                observations: analysisData.patient.observations || []
            };

            // Format analysis data
            const formattedAnalysis = {
                eligibility_status: analysisData.eligibility_status,
                confidence_score: analysisData.confidence_score,
                reasons: analysisData.reasons
            };

            console.log('✅ Formatted analysis for TrialAnalysisSidebar:', {
                hasReasons: !!formattedAnalysis.reasons,
                reasonsKeys: Object.keys(formattedAnalysis.reasons || {}),
                inclusionDetailsCount: formattedAnalysis.reasons?.inclusion_details?.length || 0,
                exclusionDetailsCount: formattedAnalysis.reasons?.exclusion_details?.length || 0,
                sampleInclusion: formattedAnalysis.reasons?.inclusion_details?.[0],
                sampleExclusion: formattedAnalysis.reasons?.exclusion_details?.[0]
            });

            // Get trial info - trialId is the numeric ID, find matching trial
            const currentTrial = trials.find(t => t.id === trialId);
            console.log('Found trial:', currentTrial);

            setSelectedPatientAnalysis({
                patient: formattedPatient,
                analysis: formattedAnalysis,
                trial: currentTrial || { id: trialId, trial_id: `TRIAL_${trialId}` }
            });
            setAnalysisOpen(true);
            console.log('Analysis sidebar opened');
        } catch (err) {
            console.error('Error loading patient analysis:', err);
            // Show alert if analysis not available
            alert('Detailed analysis not available. Please ensure screening was run and saved to database.');
        } finally {
            setLoadingAnalysis(false);
        }
    };

    const handleDownloadReport = async (trialId) => {
        try {
            console.log('Opening report downloader for trial:', trialId);

            // Find the trial
            const trial = trials.find(t => t.id === trialId);
            if (!trial) {
                alert('Trial not found');
                return;
            }

            // Get eligibility results for this trial
            const details = trialDetails[trialId];
            const eligibilityResults = details?.eligibility || [];

            console.log('Report data:', {
                trial: trial.trial_id,
                patientsCount: eligibilityResults.length
            });

            setSelectedTrialForReport(trial);
            setReportEligibilityResults(eligibilityResults);
            setReportDialogOpen(true);
        } catch (err) {
            console.error('Error preparing report:', err);
            alert('Failed to prepare report download');
        }
    };

    const renderPatientResults = (eligibility, trial) => {
        console.log('renderPatientResults called with:', {
            eligibilityCount: eligibility?.length,
            trial: trial,
            trialId: trial?.trial_id,
            trialNumericId: trial?.id
        });

        if (!eligibility || eligibility.length === 0) {
            return (
                <Alert severity="info" sx={{ mt: 2 }}>
                    No patient screening results yet. Run eligibility analysis to see results.
                </Alert>
            );
        }

        // Get the numeric trial ID from trialDetails or trial object
        const trialStringId = trial.trial_id;
        const trialNumericId = trial.id || trialDetails[trialStringId]?.numericId;

        console.log(`📊 Rendering ${eligibility.length} patient results for trial:`, {
            trialStringId,
            trialNumericId,
            samplePatient: eligibility[0]
        });

        const eligible = eligibility.filter(e => e.status === 'ELIGIBLE' || e.status?.includes('ELIGIBLE'));
        const ineligible = eligibility.filter(e => e.status === 'INELIGIBLE');
        const uncertain = eligibility.filter(e => !e.status?.includes('ELIGIBLE') && e.status !== 'INELIGIBLE');

        return (
            <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                    Patient Screening Results:
                </Typography>
                <Grid container spacing={2} sx={{ mb: 2 }}>
                    <Grid item xs={4}>
                        <Card variant="outlined">
                            <CardContent>
                                <Box display="flex" alignItems="center" justifyContent="space-between">
                                    <Typography variant="h4" color="success.main">{eligible.length}</Typography>
                                    <CheckCircle color="success" />
                                </Box>
                                <Typography variant="body2" color="textSecondary">Eligible</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={4}>
                        <Card variant="outlined">
                            <CardContent>
                                <Box display="flex" alignItems="center" justifyContent="space-between">
                                    <Typography variant="h4" color="error.main">{ineligible.length}</Typography>
                                    <Cancel color="error" />
                                </Box>
                                <Typography variant="body2" color="textSecondary">Ineligible</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                    <Grid item xs={4}>
                        <Card variant="outlined">
                            <CardContent>
                                <Box display="flex" alignItems="center" justifyContent="space-between">
                                    <Typography variant="h4" color="warning.main">{uncertain.length}</Typography>
                                    <HourglassEmpty color="warning" />
                                </Box>
                                <Typography variant="body2" color="textSecondary">Uncertain</Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                </Grid>

                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Patient ID</TableCell>
                                <TableCell>Status</TableCell>
                                <TableCell>Confidence</TableCell>
                                <TableCell>Criteria Met</TableCell>
                                <TableCell>Evaluation Date</TableCell>
                                <TableCell>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {eligibility.slice(0, 10).map((result, idx) => (
                                <TableRow key={idx}>
                                    <TableCell>{result.patient_id}</TableCell>
                                    <TableCell>
                                        <Chip
                                            label={result.status}
                                            color={
                                                result.status === 'ELIGIBLE' ? 'success' :
                                                    result.status === 'INELIGIBLE' ? 'error' : 'warning'
                                            }
                                            size="small"
                                        />
                                    </TableCell>
                                    <TableCell>{(result.confidence * 100).toFixed(1)}%</TableCell>
                                    <TableCell>
                                        {result.criteria_met || 0} / {result.criteria_total || 0}
                                    </TableCell>
                                    <TableCell>
                                        {result.evaluation_date ?
                                            new Date(result.evaluation_date).toLocaleDateString() :
                                            'N/A'
                                        }
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            startIcon={<Visibility />}
                                            onClick={() => {
                                                console.log('View Analysis button clicked for patient:', result.patient_id, 'trialNumericId:', trialNumericId);
                                                handleViewPatientAnalysis(result.patient_id, trialNumericId);
                                            }}
                                            disabled={loadingAnalysis || !trialNumericId}
                                        >
                                            View Analysis
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
                {eligibility.length > 10 && (
                    <Typography variant="caption" color="textSecondary" sx={{ mt: 1, display: 'block' }}>
                        Showing first 10 of {eligibility.length} results
                    </Typography>
                )}
            </Box>
        );
    };

    if (loading) {
        return (
            <Container maxWidth="lg" sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
                <CircularProgress />
            </Container>
        );
    }

    if (error) {
        return (
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                <Alert severity="error">{error}</Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            {/* Header */}
            <Paper sx={{ p: 3, mb: 3, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
                <Typography variant="h4" gutterBottom>
                    Organization Dashboard
                </Typography>
                {user && user.organization && (
                    <Typography variant="h6">
                        {user.organization.name}
                    </Typography>
                )}
                <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    Comprehensive view of all clinical trials, documents, and patient eligibility results
                </Typography>
            </Paper>

            {/* Stats Overview */}
            <Grid container spacing={3} sx={{ mb: 3 }}>
                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <div>
                                    <Typography variant="h4" color="primary">
                                        {stats.totalTrials}
                                    </Typography>
                                    <Typography variant="body2" color="textSecondary">
                                        Total Trials
                                    </Typography>
                                </div>
                                <Science fontSize="large" color="primary" />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <div>
                                    <Typography variant="h4" color="success.main">
                                        {stats.activeTrials}
                                    </Typography>
                                    <Typography variant="body2" color="textSecondary">
                                        Active Trials
                                    </Typography>
                                </div>
                                <CheckCircle fontSize="large" color="success" />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <div>
                                    <Typography variant="h4" color="info.main">
                                        {stats.totalPatients}
                                    </Typography>
                                    <Typography variant="body2" color="textSecondary">
                                        Total Patients
                                    </Typography>
                                </div>
                                <People fontSize="large" color="info" />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <div>
                                    <Typography variant="h4" color="success.main">
                                        {stats.eligiblePatients}
                                    </Typography>
                                    <Typography variant="body2" color="textSecondary">
                                        Eligible Patients
                                    </Typography>
                                </div>
                                <CheckCircle fontSize="large" color="success" />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <div>
                                    <Typography variant="h4" color="primary">
                                        {stats.totalSubmissions}
                                    </Typography>
                                    <Typography variant="body2" color="textSecondary">
                                        Total Submissions
                                    </Typography>
                                </div>
                                <Send fontSize="large" color="primary" />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <div>
                                    <Typography variant="h4" color="warning.main">
                                        {stats.pendingApprovals}
                                    </Typography>
                                    <Typography variant="body2" color="textSecondary">
                                        Pending Approvals
                                    </Typography>
                                </div>
                                <HourglassEmpty fontSize="large" color="warning" />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Trials List */}
            <Paper sx={{ p: 3 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                    <Typography variant="h5">All Clinical Trials</Typography>
                    <Button
                        variant="contained"
                        startIcon={<Description />}
                        onClick={() => navigate('/')}
                    >
                        Upload New Protocol
                    </Button>
                </Box>
                <Divider sx={{ mb: 2 }} />

                {trials.length === 0 ? (
                    <Alert severity="info">
                        No trials found. Upload a protocol to get started.
                    </Alert>
                ) : (
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell />
                                    <TableCell>
                                        <TableSortLabel
                                            active={trialSortBy === 'trial_id'}
                                            direction={trialSortBy === 'trial_id' ? trialSortOrder : 'asc'}
                                            onClick={() => handleTrialSort('trial_id')}
                                        >
                                            Trial ID
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell>
                                        <TableSortLabel
                                            active={trialSortBy === 'title'}
                                            direction={trialSortBy === 'title' ? trialSortOrder : 'asc'}
                                            onClick={() => handleTrialSort('title')}
                                        >
                                            Title
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell>
                                        <TableSortLabel
                                            active={trialSortBy === 'drug'}
                                            direction={trialSortBy === 'drug' ? trialSortOrder : 'asc'}
                                            onClick={() => handleTrialSort('drug')}
                                        >
                                            Drug
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell>
                                        <TableSortLabel
                                            active={trialSortBy === 'phase'}
                                            direction={trialSortBy === 'phase' ? trialSortOrder : 'asc'}
                                            onClick={() => handleTrialSort('phase')}
                                        >
                                            Phase
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell>Indication</TableCell>
                                    <TableCell>
                                        <TableSortLabel
                                            active={trialSortBy === 'status'}
                                            direction={trialSortBy === 'status' ? trialSortOrder : 'asc'}
                                            onClick={() => handleTrialSort('status')}
                                        >
                                            Status
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell>
                                        <TableSortLabel
                                            active={trialSortBy === 'date'}
                                            direction={trialSortBy === 'date' ? trialSortOrder : 'asc'}
                                            onClick={() => handleTrialSort('date')}
                                        >
                                            Created Date
                                        </TableSortLabel>
                                    </TableCell>
                                    <TableCell>Submission Status</TableCell>
                                    <TableCell>Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {getSortedTrials().map((trial) => (
                                    <React.Fragment key={trial.trial_id}>
                                        <TableRow hover>
                                            <TableCell>
                                                <IconButton
                                                    size="small"
                                                    onClick={() => handleExpandTrial(trial.trial_id)}
                                                >
                                                    {expandedTrial === trial.trial_id ? <ExpandLess /> : <ExpandMore />}
                                                </IconButton>
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="body2" fontWeight="bold">
                                                    {trial.trial_id}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>{trial.protocol_title || 'N/A'}</TableCell>
                                            <TableCell>{trial.drug_name || 'N/A'}</TableCell>
                                            <TableCell>{trial.phase || 'N/A'}</TableCell>
                                            <TableCell>{trial.indication || 'N/A'}</TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={trial.status || 'Unknown'}
                                                    color={getStatusColor(trial.status)}
                                                    size="small"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="body2">
                                                    {formatDateTime(trial.created_at || trial.createdAt)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                {(() => {
                                                    const trialSubmissions = getTrialSubmissions(trial.id);
                                                    if (trialSubmissions.length === 0) {
                                                        return (
                                                            <Chip
                                                                label="Not Submitted"
                                                                size="small"
                                                                variant="outlined"
                                                            />
                                                        );
                                                    }
                                                    const latestSubmission = trialSubmissions[0];
                                                    return (
                                                        <Box>
                                                            <Chip
                                                                label={latestSubmission.status.replace('_', ' ')}
                                                                color={getSubmissionStatusColor(latestSubmission.status)}
                                                                size="small"
                                                            />
                                                            <Typography variant="caption" display="block" sx={{ mt: 0.5, fontWeight: 500 }}>
                                                                To: {latestSubmission.principalInvestigator?.user?.fullName || 'N/A'}
                                                            </Typography>
                                                            <Typography variant="caption" display="block" color="text.secondary">
                                                                {formatDateTime(latestSubmission.submissionDate)}
                                                            </Typography>
                                                        </Box>
                                                    );
                                                })()}
                                            </TableCell>
                                            <TableCell>
                                                <Box display="flex" gap={1}>
                                                    <IconButton
                                                        size="small"
                                                        color="primary"
                                                        onClick={() => navigate(`/trial/${trial.trial_id}/details`)}
                                                        title="View Trial Details"
                                                    >
                                                        <Visibility />
                                                    </IconButton>
                                                    {getTrialSubmissions(trial.id).length === 0 && (
                                                        <IconButton
                                                            size="small"
                                                            color="secondary"
                                                            onClick={() => {
                                                                console.log('Send to PI button clicked, trial:', trial);
                                                                handleSendToPI(trial);
                                                            }}
                                                            title="Send to Principal Investigator"
                                                        >
                                                            <Send />
                                                        </IconButton>
                                                    )}
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                        <TableRow>
                                            <TableCell colSpan={10} sx={{ p: 0 }}>
                                                <Collapse in={expandedTrial === trial.trial_id} timeout="auto" unmountOnExit>
                                                    <Box sx={{ p: 3, bgcolor: '#f5f5f5' }}>
                                                        {trialDetails[trial.trial_id] ? (
                                                            <>
                                                                {/* Submission History */}
                                                                {(() => {
                                                                    const trialSubmissions = getTrialSubmissions(trial.id);
                                                                    if (trialSubmissions.length > 0) {
                                                                        const sortedSubmissions = getSortedSubmissions(trialSubmissions);
                                                                        return (
                                                                            <>
                                                                                <Typography variant="subtitle1" gutterBottom>
                                                                                    <Send fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />
                                                                                    Submission History ({trialSubmissions.length})
                                                                                </Typography>
                                                                                <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
                                                                                    <Table size="small">
                                                                                        <TableHead>
                                                                                            <TableRow>
                                                                                                <TableCell>
                                                                                                    <TableSortLabel
                                                                                                        active={submissionSortBy === 'date'}
                                                                                                        direction={submissionSortBy === 'date' ? submissionSortOrder : 'asc'}
                                                                                                        onClick={() => handleSubmissionSort('date')}
                                                                                                    >
                                                                                                        Submission Date
                                                                                                    </TableSortLabel>
                                                                                                </TableCell>
                                                                                                <TableCell>
                                                                                                    <TableSortLabel
                                                                                                        active={submissionSortBy === 'pi'}
                                                                                                        direction={submissionSortBy === 'pi' ? submissionSortOrder : 'asc'}
                                                                                                        onClick={() => handleSubmissionSort('pi')}
                                                                                                    >
                                                                                                        Principal Investigator
                                                                                                    </TableSortLabel>
                                                                                                </TableCell>
                                                                                                <TableCell>Institution</TableCell>
                                                                                                <TableCell>
                                                                                                    <TableSortLabel
                                                                                                        active={submissionSortBy === 'status'}
                                                                                                        direction={submissionSortBy === 'status' ? submissionSortOrder : 'asc'}
                                                                                                        onClick={() => handleSubmissionSort('status')}
                                                                                                    >
                                                                                                        Status
                                                                                                    </TableSortLabel>
                                                                                                </TableCell>
                                                                                                <TableCell>
                                                                                                    <TableSortLabel
                                                                                                        active={submissionSortBy === 'patients'}
                                                                                                        direction={submissionSortBy === 'patients' ? submissionSortOrder : 'asc'}
                                                                                                        onClick={() => handleSubmissionSort('patients')}
                                                                                                    >
                                                                                                        Patients
                                                                                                    </TableSortLabel>
                                                                                                </TableCell>
                                                                                                <TableCell>Reviewed Date</TableCell>
                                                                                                <TableCell align="right">Actions</TableCell>
                                                                                            </TableRow>
                                                                                        </TableHead>
                                                                                        <TableBody>
                                                                                            {sortedSubmissions.map((submission) => (
                                                                                                <TableRow key={submission.id} hover>
                                                                                                    <TableCell>
                                                                                                        <Typography variant="body2">
                                                                                                            {formatDateTime(submission.submissionDate)}
                                                                                                        </Typography>
                                                                                                    </TableCell>
                                                                                                    <TableCell>
                                                                                                        <Typography variant="body2" fontWeight={600}>
                                                                                                            {submission.principalInvestigator?.user?.fullName || 'N/A'}
                                                                                                        </Typography>
                                                                                                        <Typography variant="caption" color="text.secondary">
                                                                                                            {submission.principalInvestigator?.user?.email || ''}
                                                                                                        </Typography>
                                                                                                    </TableCell>
                                                                                                    <TableCell>
                                                                                                        <Typography variant="body2">
                                                                                                            {submission.principalInvestigator?.institution || 'N/A'}
                                                                                                        </Typography>
                                                                                                    </TableCell>
                                                                                                    <TableCell>
                                                                                                        <Chip
                                                                                                            label={submission.status.replace('_', ' ')}
                                                                                                            color={getSubmissionStatusColor(submission.status)}
                                                                                                            size="small"
                                                                                                        />
                                                                                                    </TableCell>
                                                                                                    <TableCell>
                                                                                                        <Typography variant="body2">
                                                                                                            {submission._count?.patients || submission.patients?.length || 0}
                                                                                                        </Typography>
                                                                                                        {submission.patients && submission.patients.filter(p => p.isApproved === true).length > 0 && (
                                                                                                            <Typography variant="caption" color="success.main">
                                                                                                                {submission.patients.filter(p => p.isApproved === true).length} approved
                                                                                                            </Typography>
                                                                                                        )}
                                                                                                    </TableCell>
                                                                                                    <TableCell>
                                                                                                        <Typography variant="body2">
                                                                                                            {formatDateTime(submission.reviewedAt)}
                                                                                                        </Typography>
                                                                                                    </TableCell>
                                                                                                    <TableCell align="right">
                                                                                                        <Button
                                                                                                            variant="outlined"
                                                                                                            size="small"
                                                                                                            onClick={() => navigate(`/submissions/${submission.id}`)}
                                                                                                        >
                                                                                                            View
                                                                                                        </Button>
                                                                                                    </TableCell>
                                                                                                </TableRow>
                                                                                            ))}
                                                                                        </TableBody>
                                                                                    </Table>
                                                                                </TableContainer>
                                                                            </>
                                                                        );
                                                                    }
                                                                    return null;
                                                                })()}

                                                                {/* Trial Documents */}
                                                                <Typography variant="subtitle1" gutterBottom>
                                                                    <Description fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />
                                                                    FDA Documents
                                                                </Typography>
                                                                <Box sx={{ mb: 3 }}>
                                                                    {trial.document_id ? (
                                                                        <Card variant="outlined">
                                                                            <CardContent>
                                                                                <Typography variant="body2">
                                                                                    <strong>Document ID:</strong> {trial.document_id}
                                                                                </Typography>
                                                                                {trialDetails[trial.trial_id].rules?.fda_forms?.fda_1571 && (
                                                                                    <Typography variant="body2">
                                                                                        <strong>Form 1571:</strong> {trialDetails[trial.trial_id].rules.fda_forms.fda_1571.sponsor_name || 'Available'}
                                                                                    </Typography>
                                                                                )}
                                                                                {trialDetails[trial.trial_id].rules?.fda_forms?.fda_1572 && (
                                                                                    <Typography variant="body2">
                                                                                        <strong>Form 1572:</strong> {trialDetails[trial.trial_id].rules.fda_forms.fda_1572.investigator_name || 'Available'}
                                                                                    </Typography>
                                                                                )}
                                                                            </CardContent>
                                                                        </Card>
                                                                    ) : (
                                                                        <Typography variant="body2" color="textSecondary">
                                                                            No FDA documents associated
                                                                        </Typography>
                                                                    )}
                                                                </Box>

                                                                {/* Eligibility Criteria Summary */}
                                                                <Typography variant="subtitle1" gutterBottom>
                                                                    <Science fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />
                                                                    Eligibility Criteria
                                                                </Typography>
                                                                <Box sx={{ mb: 3 }}>
                                                                    {trialDetails[trial.trial_id].rules?.rules?.length > 0 ? (
                                                                        <Grid container spacing={2}>
                                                                            <Grid item xs={6}>
                                                                                <Card variant="outlined">
                                                                                    <CardContent>
                                                                                        <Typography variant="h6" color="success.main">
                                                                                            {trialDetails[trial.trial_id].rules.rules.filter(r => r.type === 'inclusion').length}
                                                                                        </Typography>
                                                                                        <Typography variant="body2" color="textSecondary">
                                                                                            Inclusion Criteria
                                                                                        </Typography>
                                                                                    </CardContent>
                                                                                </Card>
                                                                            </Grid>
                                                                            <Grid item xs={6}>
                                                                                <Card variant="outlined">
                                                                                    <CardContent>
                                                                                        <Typography variant="h6" color="error.main">
                                                                                            {trialDetails[trial.trial_id].rules.rules.filter(r => r.type === 'exclusion').length}
                                                                                        </Typography>
                                                                                        <Typography variant="body2" color="textSecondary">
                                                                                            Exclusion Criteria
                                                                                        </Typography>
                                                                                    </CardContent>
                                                                                </Card>
                                                                            </Grid>
                                                                        </Grid>
                                                                    ) : (
                                                                        <Typography variant="body2" color="textSecondary">
                                                                            No criteria extracted yet
                                                                        </Typography>
                                                                    )}
                                                                </Box>

                                                                {/* Patient Results */}
                                                                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                                                    <Typography variant="subtitle1">
                                                                        <People fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />
                                                                        Patient Eligibility Results
                                                                    </Typography>
                                                                    <Button
                                                                        variant="outlined"
                                                                        size="small"
                                                                        startIcon={<Description />}
                                                                        onClick={() => handleDownloadReport(trial.id)}
                                                                    >
                                                                        Download Report
                                                                    </Button>
                                                                </Box>
                                                                {renderPatientResults(trialDetails[trial.trial_id].eligibility, trial)}
                                                            </>
                                                        ) : (
                                                            <Box display="flex" justifyContent="center" p={3}>
                                                                <CircularProgress size={24} />
                                                            </Box>
                                                        )}
                                                    </Box>
                                                </Collapse>
                                            </TableCell>
                                        </TableRow>
                                    </React.Fragment>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>

            {/* Send to PI Dialog */}
            <SendToPIDialog
                open={sendToPIDialog.open}
                onClose={handleCloseSendToPI}
                onSuccess={handleSubmissionSuccess}
                trial={sendToPIDialog.trial}
                eligibilityResults={sendToPIDialog.eligibility}
            />

            {/* Patient Analysis Sidebar */}
            {selectedPatientAnalysis && (
                <TrialAnalysisSidebar
                    open={analysisOpen}
                    onClose={() => {
                        console.log('Closing analysis sidebar');
                        setAnalysisOpen(false);
                    }}
                    patient={selectedPatientAnalysis.patient}
                    trial={selectedPatientAnalysis.trial}
                    analysis={selectedPatientAnalysis.analysis}
                />
            )}

            {/* Trial Report Downloader */}
            <TrialReportDownloader
                open={reportDialogOpen}
                onClose={() => {
                    console.log('Closing report downloader');
                    setReportDialogOpen(false);
                }}
                trial={selectedTrialForReport}
                eligibilityResults={reportEligibilityResults}
                apiClient={apiClient}
            />
        </Container>
    );
}

export default OrganizationDashboard;
