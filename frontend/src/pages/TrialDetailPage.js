import React, { useState, useEffect } from 'react';
import {
    Container,
    Typography,
    Box,
    Card,
    CardContent,
    Grid,
    Chip,
    Button,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    CircularProgress,
    Alert,
    Divider,
    Tabs,
    Tab,
    IconButton,
    Collapse
} from '@mui/material';
import {
    ArrowBack,
    Assignment,
    People,
    Description,
    CheckCircle,
    Cancel,
    HelpOutline,
    ExpandMore,
    ExpandLess
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import TrialReportDownloader from '../components/TrialReportDownloader';

const TrialDetailPage = () => {
    const { trialId } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [trial, setTrial] = useState(null);
    const [eligibilityResults, setEligibilityResults] = useState([]);
    const [error, setError] = useState('');
    const [activeTab, setActiveTab] = useState(0);
    const [expandedPatient, setExpandedPatient] = useState(null);
    const [fdaDocument, setFdaDocument] = useState(null);
    const [reportDialogOpen, setReportDialogOpen] = useState(false);

    useEffect(() => {
        fetchTrialDetails();
    }, [trialId]);

    const fetchTrialDetails = async () => {
        setLoading(true);
        try {
            // Fetch trial from Node backend
            const trialsRes = await apiClient.get('/api/trials');
            // API returns array directly, not { trials: [] }
            const trialsArray = Array.isArray(trialsRes.data) ? trialsRes.data : [];
            const foundTrial = trialsArray.find(t =>
                t.trial_id === trialId ||
                t.id === parseInt(trialId) ||
                String(t.id) === trialId
            );

            if (!foundTrial) {
                setError('Trial not found');
                setLoading(false);
                return;
            }

            setTrial(foundTrial);

            // Fetch eligibility results from patient-analysis endpoint
            try {
                const analysisRes = await apiClient.get(`/api/patient-analysis/trial/${foundTrial.id}`);
                console.log('Patient analysis results:', analysisRes.data);

                // Transform the analysis results to match the expected format
                const formattedResults = (analysisRes.data || []).map(analysis => ({
                    patient_id: analysis.patientId,
                    age: analysis.patient?.age || 'N/A',
                    gender: analysis.patient?.gender || 'N/A',
                    status: analysis.eligibility_status || 'Unknown',
                    approval_status: analysis.approvalStatus,
                    approval_date: analysis.approvalDate,
                    confidence: analysis.confidence_score || 0,
                    criteria_met: analysis.criteria_met,
                    criteria_total: analysis.criteria_total,
                    evaluation_date: analysis.screened_at || analysis.createdAt,
                    details: {
                        reasons: (analysis.reasons?.inclusion_details || []).concat(
                            analysis.reasons?.exclusion_details || []
                        )
                    }
                }));

                setEligibilityResults(formattedResults);
                console.log('Formatted eligibility results:', formattedResults);
            } catch (err) {
                console.log('No patient analysis available:', err);
                setEligibilityResults([]);
            }

            // Fetch FDA forms from trial rules endpoint
            try {
                const rulesRes = await apiClient.get(`/api/trials/${foundTrial.trial_id || foundTrial.trialId}/rules`);
                console.log('FDA forms from rules:', rulesRes.data?.fda_forms);

                if (rulesRes.data?.fda_forms) {
                    setFdaDocument({
                        fda1571: rulesRes.data.fda_forms.fda_1571 || null,
                        fda1572: rulesRes.data.fda_forms.fda_1572 || null
                    });
                } else {
                    setFdaDocument(null);
                }
            } catch (err) {
                console.log('No FDA forms available:', err);
                setFdaDocument(null);
            }
        } catch (err) {
            console.error('Error fetching trial details:', err);
            setError('Failed to load trial details');
        } finally {
            setLoading(false);
        }
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    };

    const getStatusColor = (status) => {
        if (!status) return 'default';
        const upperStatus = status.toUpperCase();
        if (upperStatus === 'APPROVED' || upperStatus === 'ELIGIBLE') return 'success';
        if (upperStatus === 'REJECTED' || upperStatus === 'INELIGIBLE') return 'error';
        if (upperStatus === 'PENDING') return 'warning';
        return 'warning';
    };

    const getStatusIcon = (status) => {
        if (!status) return <HelpOutline />;
        const upperStatus = status.toUpperCase();
        if (upperStatus === 'APPROVED' || upperStatus === 'ELIGIBLE') return <CheckCircle />;
        if (upperStatus === 'REJECTED' || upperStatus === 'INELIGIBLE') return <Cancel />;
        return <HelpOutline />;
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
                <CircularProgress size={60} />
            </Box>
        );
    }

    if (error || !trial) {
        return (
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                <Alert severity="error">{error || 'Trial not found'}</Alert>
                <Button startIcon={<ArrowBack />} onClick={() => navigate('/dashboard')} sx={{ mt: 2 }}>
                    Back to Dashboard
                </Button>
            </Container>
        );
    }

    const approvedCount = eligibilityResults.filter(r => r.status?.toUpperCase() === 'APPROVED').length;
    const rejectedCount = eligibilityResults.filter(r => r.status?.toUpperCase() === 'REJECTED').length;
    const eligibleCount = eligibilityResults.filter(r => r.status?.toUpperCase() === 'ELIGIBLE').length;
    const ineligibleCount = eligibilityResults.filter(r => r.status?.toUpperCase() === 'INELIGIBLE').length;
    const uncertainCount = eligibilityResults.filter(r => {
        const upperStatus = r.status?.toUpperCase();
        return upperStatus !== 'APPROVED' && upperStatus !== 'REJECTED' &&
            upperStatus !== 'ELIGIBLE' && upperStatus !== 'INELIGIBLE';
    }).length;

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
            {/* Header */}
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={3}>
                <Box display="flex" alignItems="center" gap={2}>
                    <IconButton onClick={() => navigate('/dashboard')} color="primary">
                        <ArrowBack />
                    </IconButton>
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        Trial Details
                    </Typography>
                </Box>
                <Box display="flex" gap={2} alignItems="center">
                    <Button
                        variant="outlined"
                        startIcon={<Description />}
                        onClick={() => setReportDialogOpen(true)}
                        disabled={!eligibilityResults || eligibilityResults.length === 0}
                    >
                        Download Report
                    </Button>
                    <Chip label={trial.status || 'Active'} color="primary" />
                </Box>
            </Box>

            {/* Trial Information Card */}
            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Box display="flex" alignItems="start" justifyContent="space-between" mb={2}>
                        <Box>
                            <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
                                {trial.protocol_title || trial.protocolTitle || 'Untitled Trial'}
                            </Typography>
                            <Typography variant="body1" color="text.secondary" gutterBottom>
                                Trial ID: <strong>{trial.trial_id}</strong>
                            </Typography>
                        </Box>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Grid container spacing={3}>
                        <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" color="text.secondary">Drug Name</Typography>
                            <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                {trial.drug_name || trial.drugName || 'N/A'}
                            </Typography>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" color="text.secondary">Phase</Typography>
                            <Chip label={trial.phase || 'N/A'} size="small" color="primary" />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" color="text.secondary">Indication</Typography>
                            <Typography variant="body1">{trial.indication || 'N/A'}</Typography>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <Typography variant="subtitle2" color="text.secondary">Created Date</Typography>
                            <Typography variant="body1">{formatDateTime(trial.created_at || trial.createdAt)}</Typography>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            {/* Tabs */}
            <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
                <Tabs value={activeTab} onChange={(e, newValue) => setActiveTab(newValue)}>
                    <Tab icon={<People />} label={`Patient Analysis (${eligibilityResults.length})`} />
                    <Tab icon={<Description />} label="Documents" />
                    <Tab icon={<Assignment />} label="FDA Forms" />
                </Tabs>
            </Box>

            {/* Tab Panels */}
            {activeTab === 0 && (
                <Card>
                    <CardContent>
                        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                            Patient Eligibility Analysis
                        </Typography>

                        {eligibilityResults.length === 0 ? (
                            <Alert severity="info">
                                No patient screening results available. Run eligibility analysis from the screening page.
                            </Alert>
                        ) : (
                            <>
                                {/* Summary Stats */}
                                <Grid container spacing={2} sx={{ mb: 3 }}>
                                    <Grid item xs={12} sm={3}>
                                        <Paper sx={{ p: 2, bgcolor: '#d4edda', textAlign: 'center' }}>
                                            <CheckCircle sx={{ fontSize: 40, color: '#28a745' }} />
                                            <Typography variant="h4" sx={{ fontWeight: 700, color: '#28a745' }}>
                                                {approvedCount}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">Approved by PI</Typography>
                                        </Paper>
                                    </Grid>
                                    <Grid item xs={12} sm={3}>
                                        <Paper sx={{ p: 2, bgcolor: '#f8d7da', textAlign: 'center' }}>
                                            <Cancel sx={{ fontSize: 40, color: '#dc3545' }} />
                                            <Typography variant="h4" sx={{ fontWeight: 700, color: '#dc3545' }}>
                                                {rejectedCount}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">Rejected by PI</Typography>
                                        </Paper>
                                    </Grid>
                                    <Grid item xs={12} sm={3}>
                                        <Paper sx={{ p: 2, bgcolor: '#d1ecf1', textAlign: 'center' }}>
                                            <CheckCircle sx={{ fontSize: 40, color: '#0c5460' }} />
                                            <Typography variant="h4" sx={{ fontWeight: 700, color: '#0c5460' }}>
                                                {eligibleCount}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">Eligible (Pending Review)</Typography>
                                        </Paper>
                                    </Grid>
                                    <Grid item xs={12} sm={3}>
                                        <Paper sx={{ p: 2, bgcolor: '#fff3cd', textAlign: 'center' }}>
                                            <HelpOutline sx={{ fontSize: 40, color: '#856404' }} />
                                            <Typography variant="h4" sx={{ fontWeight: 700, color: '#856404' }}>
                                                {uncertainCount + ineligibleCount}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">Under Review</Typography>
                                        </Paper>
                                    </Grid>
                                </Grid>

                                {/* Patient Table */}
                                <TableContainer component={Paper} variant="outlined">
                                    <Table>
                                        <TableHead>
                                            <TableRow>
                                                <TableCell>Patient ID</TableCell>
                                                <TableCell>Age</TableCell>
                                                <TableCell>Gender</TableCell>
                                                <TableCell>Eligibility Status</TableCell>
                                                <TableCell>PI Review Status</TableCell>
                                                <TableCell>Confidence</TableCell>
                                                <TableCell>Criteria</TableCell>
                                                <TableCell>Evaluated</TableCell>
                                                <TableCell></TableCell>
                                            </TableRow>
                                        </TableHead>
                                        <TableBody>
                                            {eligibilityResults.map((result) => (
                                                <React.Fragment key={result.patient_id}>
                                                    <TableRow hover>
                                                        <TableCell sx={{ fontWeight: 600 }}>{result.patient_id}</TableCell>
                                                        <TableCell>{result.age || 'N/A'}</TableCell>
                                                        <TableCell>{result.gender || 'N/A'}</TableCell>
                                                        <TableCell>
                                                            <Chip
                                                                icon={getStatusIcon(result.status)}
                                                                label={result.status || 'Unknown'}
                                                                color={getStatusColor(result.status)}
                                                                size="small"
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            {result.approval_status ? (
                                                                <Box>
                                                                    <Chip
                                                                        icon={getStatusIcon(result.approval_status)}
                                                                        label={result.approval_status}
                                                                        color={getStatusColor(result.approval_status)}
                                                                        size="small"
                                                                    />
                                                                    {result.approval_date && (
                                                                        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
                                                                            {formatDateTime(result.approval_date)}
                                                                        </Typography>
                                                                    )}
                                                                </Box>
                                                            ) : (
                                                                <Chip label="Pending" size="small" variant="outlined" />
                                                            )}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Chip
                                                                label={`${Math.round((result.confidence || 0) * 100)}%`}
                                                                size="small"
                                                                variant="outlined"
                                                            />
                                                        </TableCell>
                                                        <TableCell>
                                                            {result.criteria_met !== null && result.criteria_total !== null
                                                                ? `${result.criteria_met}/${result.criteria_total}`
                                                                : 'N/A'}
                                                        </TableCell>
                                                        <TableCell>{formatDateTime(result.evaluation_date)}</TableCell>
                                                        <TableCell>
                                                            {result.details?.reasons && result.details.reasons.length > 0 && (
                                                                <IconButton
                                                                    size="small"
                                                                    onClick={() => setExpandedPatient(
                                                                        expandedPatient === result.patient_id ? null : result.patient_id
                                                                    )}
                                                                >
                                                                    {expandedPatient === result.patient_id ? <ExpandLess /> : <ExpandMore />}
                                                                </IconButton>
                                                            )}
                                                        </TableCell>
                                                    </TableRow>
                                                    {result.details?.reasons && result.details.reasons.length > 0 && (
                                                        <TableRow>
                                                            <TableCell colSpan={9} sx={{ p: 0 }}>
                                                                <Collapse in={expandedPatient === result.patient_id} timeout="auto" unmountOnExit>
                                                                    <Box sx={{ p: 2, bgcolor: '#f8f9fa' }}>
                                                                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                                                                            Eligibility Details:
                                                                        </Typography>
                                                                        <ul style={{ margin: 0, paddingLeft: 20 }}>
                                                                            {result.details.reasons.map((reason, idx) => (
                                                                                <li key={idx}>
                                                                                    <Typography variant="body2">{reason}</Typography>
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    </Box>
                                                                </Collapse>
                                                            </TableCell>
                                                        </TableRow>
                                                    )}
                                                </React.Fragment>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </TableContainer>
                            </>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeTab === 1 && (
                <Card>
                    <CardContent>
                        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                            Trial Documents
                        </Typography>
                        {trial.document_id || trial.documentId ? (
                            <Paper sx={{ p: 2, mb: 2 }}>
                                <Typography variant="body2" color="text.secondary">Document ID</Typography>
                                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                    {trial.document_id || trial.documentId}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                                    FDA forms are available in the FDA Forms tab
                                </Typography>
                            </Paper>
                        ) : (
                            <Alert severity="info">No documents associated with this trial.</Alert>
                        )}
                    </CardContent>
                </Card>
            )}

            {activeTab === 2 && (
                <Card>
                    <CardContent>
                        <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                            FDA Forms
                        </Typography>
                        {fdaDocument && (fdaDocument.fda1571 || fdaDocument.fda1572) ? (
                            <Box>
                                {/* FDA 1571 */}
                                {fdaDocument.fda1571 && (
                                    <Box mb={4}>
                                        <Paper sx={{ p: 3, mb: 2, bgcolor: '#f8f9fa' }}>
                                            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                                                FDA Form 1571 - Investigational New Drug Application (IND)
                                            </Typography>
                                            <Divider sx={{ mb: 2 }} />
                                            <Grid container spacing={2}>
                                                {Object.entries(fdaDocument.fda1571).map(([key, value]) => {
                                                    if (typeof value === 'object' && value !== null) {
                                                        return (
                                                            <Grid item xs={12} key={key}>
                                                                <Paper sx={{ p: 2 }}>
                                                                    <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 600, mb: 1 }}>
                                                                        {key.replace(/_/g, ' ').toUpperCase()}
                                                                    </Typography>
                                                                    <Box sx={{ pl: 2 }}>
                                                                        {Object.entries(value).map(([subKey, subValue]) => (
                                                                            <Box key={subKey} sx={{ mb: 1 }}>
                                                                                <Typography variant="caption" color="text.secondary">
                                                                                    {subKey.replace(/_/g, ' ')}
                                                                                </Typography>
                                                                                <Typography variant="body2">
                                                                                    {String(subValue || 'N/A')}
                                                                                </Typography>
                                                                            </Box>
                                                                        ))}
                                                                    </Box>
                                                                </Paper>
                                                            </Grid>
                                                        );
                                                    }
                                                    return (
                                                        <Grid item xs={12} md={6} key={key}>
                                                            <Box>
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {key.replace(/_/g, ' ').toUpperCase()}
                                                                </Typography>
                                                                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                                                                    {String(value || 'N/A')}
                                                                </Typography>
                                                            </Box>
                                                        </Grid>
                                                    );
                                                })}
                                            </Grid>
                                        </Paper>
                                    </Box>
                                )}

                                {/* FDA 1572 */}
                                {fdaDocument.fda1572 && (
                                    <Box>
                                        <Paper sx={{ p: 3, bgcolor: '#f8f9fa' }}>
                                            <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                                                FDA Form 1572 - Statement of Investigator
                                            </Typography>
                                            <Divider sx={{ mb: 2 }} />
                                            <Grid container spacing={2}>
                                                {Object.entries(fdaDocument.fda1572).map(([key, value]) => {
                                                    if (typeof value === 'object' && value !== null) {
                                                        return (
                                                            <Grid item xs={12} key={key}>
                                                                <Paper sx={{ p: 2 }}>
                                                                    <Typography variant="subtitle2" color="primary" sx={{ fontWeight: 600, mb: 1 }}>
                                                                        {key.replace(/_/g, ' ').toUpperCase()}
                                                                    </Typography>
                                                                    <Box sx={{ pl: 2 }}>
                                                                        {Object.entries(value).map(([subKey, subValue]) => (
                                                                            <Box key={subKey} sx={{ mb: 1 }}>
                                                                                <Typography variant="caption" color="text.secondary">
                                                                                    {subKey.replace(/_/g, ' ')}
                                                                                </Typography>
                                                                                <Typography variant="body2">
                                                                                    {String(subValue || 'N/A')}
                                                                                </Typography>
                                                                            </Box>
                                                                        ))}
                                                                    </Box>
                                                                </Paper>
                                                            </Grid>
                                                        );
                                                    }
                                                    return (
                                                        <Grid item xs={12} md={6} key={key}>
                                                            <Box>
                                                                <Typography variant="caption" color="text.secondary">
                                                                    {key.replace(/_/g, ' ').toUpperCase()}
                                                                </Typography>
                                                                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                                                                    {String(value || 'N/A')}
                                                                </Typography>
                                                            </Box>
                                                        </Grid>
                                                    );
                                                })}
                                            </Grid>
                                        </Paper>
                                    </Box>
                                )}
                            </Box>
                        ) : (
                            <Alert severity="info">
                                {fdaDocument ? 'No FDA forms extracted yet.' : 'Loading FDA forms...'}
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Trial Report Downloader */}
            <TrialReportDownloader
                open={reportDialogOpen}
                onClose={() => setReportDialogOpen(false)}
                trial={trial}
                eligibilityResults={eligibilityResults}
                apiClient={apiClient}
            />
        </Container>
    );
};

export default TrialDetailPage;
