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
    Button
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
    People
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';

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
        eligiblePatients: 0
    });
    const [expandedTrial, setExpandedTrial] = useState(null);
    const [trialDetails, setTrialDetails] = useState({});
    const [user, setUser] = useState(null);

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
            // Fetch all trials (already filtered by organization in backend)
            const trialsRes = await apiClient.get('/api/trials');
            setTrials(trialsRes.data);

            // Calculate stats
            const totalTrials = trialsRes.data.length;
            const activeTrials = trialsRes.data.filter(t => 
                t.status !== 'Completed' && t.status !== 'Cancelled'
            ).length;

            // Fetch patient eligibility data for stats
            try {
                const statsRes = await apiClient.get('/api/stats');
                setStats({
                    totalTrials,
                    activeTrials,
                    totalPatients: statsRes.data.total_patients || 0,
                    eligiblePatients: statsRes.data.eligible_patients || 0
                });
            } catch (e) {
                // Fallback if stats endpoint not available
                setStats({
                    totalTrials,
                    activeTrials,
                    totalPatients: 0,
                    eligiblePatients: 0
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
                const [rulesRes, eligibilityRes] = await Promise.all([
                    apiClient.get(`/api/trials/${trialId}/rules`),
                    apiClient.get(`/api/eligibility/results/${trialId}`).catch(() => ({ data: [] }))
                ]);

                setTrialDetails(prev => ({
                    ...prev,
                    [trialId]: {
                        rules: rulesRes.data,
                        eligibility: eligibilityRes.data
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

    const renderPatientResults = (eligibility) => {
        if (!eligibility || eligibility.length === 0) {
            return (
                <Alert severity="info" sx={{ mt: 2 }}>
                    No patient screening results yet. Run eligibility analysis to see results.
                </Alert>
            );
        }

        const eligible = eligibility.filter(e => e.status === 'ELIGIBLE');
        const ineligible = eligibility.filter(e => e.status === 'INELIGIBLE');
        const uncertain = eligibility.filter(e => e.status === 'UNCERTAIN');

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
                                    <TableCell>Trial ID</TableCell>
                                    <TableCell>Title</TableCell>
                                    <TableCell>Drug</TableCell>
                                    <TableCell>Phase</TableCell>
                                    <TableCell>Indication</TableCell>
                                    <TableCell>Status</TableCell>
                                    <TableCell>Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {trials.map((trial) => (
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
                                                <IconButton
                                                    size="small"
                                                    color="primary"
                                                    onClick={() => navigate(`/trial/${trial.trial_id}/criteria`)}
                                                >
                                                    <Visibility />
                                                </IconButton>
                                            </TableCell>
                                        </TableRow>
                                        <TableRow>
                                            <TableCell colSpan={8} sx={{ p: 0 }}>
                                                <Collapse in={expandedTrial === trial.trial_id} timeout="auto" unmountOnExit>
                                                    <Box sx={{ p: 3, bgcolor: '#f5f5f5' }}>
                                                        {trialDetails[trial.trial_id] ? (
                                                            <>
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
                                                                <Typography variant="subtitle1" gutterBottom>
                                                                    <People fontSize="small" sx={{ verticalAlign: 'middle', mr: 1 }} />
                                                                    Patient Eligibility Results
                                                                </Typography>
                                                                {renderPatientResults(trialDetails[trial.trial_id].eligibility)}
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
        </Container>
    );
}

export default OrganizationDashboard;
