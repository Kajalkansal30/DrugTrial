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
    TextField,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Divider,
    Checkbox,
    FormControlLabel
} from '@mui/material';
import {
    CheckCircle,
    Cancel,
    ArrowBack,
    ExpandMore,
    Comment as CommentIcon,
    ThumbUp,
    ThumbDown,
    Visibility,
    Save
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';
import TrialReportModal from '../components/TrialReportModal';
import TrialAnalysisSidebar from '../components/TrialAnalysisSidebar';

const PISubmissionDetail = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [submission, setSubmission] = useState(null);
    const [error, setError] = useState('');
    const [commentDialog, setCommentDialog] = useState({ open: false, patientId: null, approved: null });
    const [comment, setComment] = useState('');
    const [actionLoading, setActionLoading] = useState(false);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [selectedPatients, setSelectedPatients] = useState(new Set());
    const [selectAll, setSelectAll] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [analysisOpen, setAnalysisOpen] = useState(false);
    const [selectedPatientAnalysis, setSelectedPatientAnalysis] = useState(null);
    const [loadingAnalysis, setLoadingAnalysis] = useState(false);
    const [reportData, setReportData] = useState({
        formData: null,
        intelData: null,
        insilicoData: null,
        documentInfo: null
    });
    const [loadingReport, setLoadingReport] = useState(false);

    useEffect(() => {
        fetchSubmissionDetails();
    }, [id]);

    const fetchSubmissionDetails = async () => {
        try {
            const response = await apiClient.get(`/api/submissions/${id}`);
            setSubmission(response.data.submission);
        } catch (err) {
            console.error('Error fetching submission:', err);
            setError('Failed to load submission details');
        } finally {
            setLoading(false);
        }
    };

    const fetchReportData = async (trial) => {
        if (loadingReport) return;

        setLoadingReport(true);
        console.log('Fetching report data for trial:', trial.trialId);

        try {
            // Fetch FDA forms from trial rules
            let fdaFormsData = null;
            try {
                const rulesRes = await apiClient.get(`/api/trials/${trial.trialId}/rules`);
                const fdaForms = rulesRes.data?.fda_forms || null;
                // Format FDA forms to match expected structure ('1571' and '1572' keys)
                if (fdaForms) {
                    fdaFormsData = {
                        '1571': fdaForms.fda_1571 || {},
                        '1572': fdaForms.fda_1572 || {}
                    };
                }
                console.log('FDA forms fetched:', fdaFormsData ? 'Yes' : 'No');
            } catch (err) {
                console.error('Error fetching FDA forms:', err);
            }

            // Fetch LTAA research intelligence
            let ltaaData = null;
            try {
                if (trial.indication) {
                    const ltaaRes = await apiClient.get(`/api/ltaa/report/${encodeURIComponent(trial.indication)}`);
                    ltaaData = ltaaRes.data;
                    console.log('LTAA data fetched:', ltaaData ? 'Yes' : 'No');
                } else {
                    console.log('No indication found for LTAA lookup');
                }
            } catch (err) {
                console.error('Error fetching LTAA data:', err);
            }

            // Fetch In-Silico data
            let insilicoDataFetched = null;
            try {
                const insilicoRes = await apiClient.get(`/api/insilico/results/${trial.trialId}`);
                insilicoDataFetched = insilicoRes.data;
                console.log('In-silico data fetched:', insilicoDataFetched ? 'Yes' : 'No');
            } catch (err) {
                console.error('Error fetching in-silico data:', err);
            }

            setReportData({
                formData: fdaFormsData,
                intelData: ltaaData,
                insilicoData: insilicoDataFetched,
                documentInfo: {
                    trial: {
                        trial_id: trial.trialId,
                        protocol_title: trial.protocolTitle,
                        drug_name: trial.drugName,
                        indication: trial.indication,
                        phase: trial.phase,
                        status: trial.status
                    },
                    document: {
                        filename: trial.documentFilename || 'protocol_document.pdf',
                        upload_date: trial.createdAt
                    }
                }
            });

            console.log('Report data prepared successfully');
            setReportModalOpen(true);
        } catch (err) {
            console.error('Error fetching report data:', err);
            setError('Failed to load complete report data. Opening with available information.');
            setReportModalOpen(true);
        } finally {
            setLoadingReport(false);
        }
    };

    const handleApprovePatient = async (patientId, approved) => {
        setCommentDialog({ open: true, patientId, approved });
    };

    const submitApproval = async () => {
        setActionLoading(true);
        try {
            await apiClient.put(`/api/submissions/${id}/approve-patient`, {
                patientId: commentDialog.patientId,
                approved: commentDialog.approved,
                comment
            });
            setCommentDialog({ open: false, patientId: null, approved: null });
            setComment('');
            fetchSubmissionDetails();
        } catch (err) {
            console.error('Error updating patient approval:', err);
            setError(err.response?.data?.error || 'Failed to update approval');
        } finally {
            setActionLoading(false);
        }
    };

    const handleApproveAll = async () => {
        if (!window.confirm('Are you sure you want to approve all patients for this trial?')) {
            return;
        }

        setActionLoading(true);
        try {
            await apiClient.put(`/api/submissions/${id}/approve-all`, {
                comment: 'All patients approved by PI'
            });
            fetchSubmissionDetails();
        } catch (err) {
            console.error('Error approving all patients:', err);
            setError(err.response?.data?.error || 'Failed to approve all patients');
        } finally {
            setActionLoading(false);
        }
    };

    const handleAddComment = async () => {
        if (!comment.trim()) return;

        setActionLoading(true);
        try {
            await apiClient.post(`/api/submissions/${id}/review`, {
                reviewType: 'GENERAL_COMMENT',
                comment
            });
            setComment('');
            fetchSubmissionDetails();
        } catch (err) {
            console.error('Error adding comment:', err);
            setError(err.response?.data?.error || 'Failed to add comment');
        } finally {
            setActionLoading(false);
        }
    };

    const handleSelectAll = (event) => {
        const checked = event.target.checked;
        setSelectAll(checked);
        if (checked && submission?.patients) {
            const allPatientIds = new Set(submission.patients.map(p => p.id));
            setSelectedPatients(allPatientIds);
        } else {
            setSelectedPatients(new Set());
        }
    };

    const handlePatientToggle = (patientDatabaseId) => {
        setSelectedPatients(prev => {
            const newSet = new Set(prev);
            if (newSet.has(patientDatabaseId)) {
                newSet.delete(patientDatabaseId);
            } else {
                newSet.add(patientDatabaseId);
            }
            setSelectAll(submission?.patients && newSet.size === submission.patients.length);
            return newSet;
        });
    };

    const handleSaveSelections = async () => {
        if (selectedPatients.size === 0) {
            setSaveMessage('Please select at least one patient');
            setTimeout(() => setSaveMessage(''), 3000);
            return;
        }

        if (!window.confirm(`Are you sure you want to approve ${selectedPatients.size} selected patient(s)?`)) {
            return;
        }

        setActionLoading(true);
        setSaveMessage('');
        try {
            // Approve selected patients using bulk endpoint
            const selectedPatientIds = Array.from(selectedPatients)
                .map(dbId => {
                    const patient = submission?.patients.find(p => p.id === dbId);
                    return patient?.patientId;
                })
                .filter(Boolean);

            console.log('Bulk approving patients:', selectedPatientIds);

            await apiClient.put(`/api/submissions/${id}/approve-bulk`, {
                patientIds: selectedPatientIds,
                comment: 'Bulk approval by PI'
            });

            setSaveMessage(`Successfully approved ${selectedPatients.size} patient(s)`);
            setSelectedPatients(new Set());
            setSelectAll(false);
            fetchSubmissionDetails();
            setTimeout(() => setSaveMessage(''), 5000);
        } catch (err) {
            console.error('Error saving selections:', err);
            setSaveMessage(err.response?.data?.error || 'Failed to save selections');
        } finally {
            setActionLoading(false);
        }
    };

    const getApprovalColor = (isApproved) => {
        if (isApproved === null) return 'default';
        return isApproved ? 'success' : 'error';
    };

    const getApprovalLabel = (isApproved) => {
        if (isApproved === null) return 'Pending';
        return isApproved ? 'Approved' : 'Rejected';
    };

    const handleViewAnalysis = async (patient) => {
        console.log('🔍 PI - handleViewAnalysis called for patient:', patient.patientId);
        setLoadingAnalysis(true);
        try {
            // Fetch comprehensive analysis data from database
            console.log(`📥 PI - Fetching from: /api/patient-analysis/patient/${trial.id}/${patient.patientId}`);
            const response = await apiClient.get(`/api/patient-analysis/patient/${trial.id}/${patient.patientId}`);
            const analysisData = response.data;

            console.log('📊 PI - Analysis data received:', {
                hasReasons: !!analysisData.reasons,
                reasonsKeys: Object.keys(analysisData.reasons || {}),
                inclusionDetailsCount: analysisData.reasons?.inclusion_details?.length || 0,
                exclusionDetailsCount: analysisData.reasons?.exclusion_details?.length || 0
            });

            // Format patient data for TrialAnalysisSidebar
            const formattedPatient = {
                id: patient.patientId,
                gender: analysisData.patient.gender || patient.patientData?.gender,
                birthdate: analysisData.patient.birthdate || null,
                age: analysisData.patient.age || patient.patientData?.age,
                conditions: analysisData.patient.conditions || [],
                observations: analysisData.patient.observations || []
            };

            // Format analysis data
            const formattedAnalysis = {
                eligibility_status: analysisData.eligibility_status,
                confidence_score: analysisData.confidence_score,
                reasons: analysisData.reasons
            };

            console.log('✅ PI - Formatted for sidebar:', {
                patient: formattedPatient,
                analysisReasonsKeys: Object.keys(formattedAnalysis.reasons || {}),
                inclusionCount: formattedAnalysis.reasons?.inclusion_details?.length || 0,
                exclusionCount: formattedAnalysis.reasons?.exclusion_details?.length || 0
            });

            setSelectedPatientAnalysis({
                patient: formattedPatient,
                analysis: formattedAnalysis
            });
            setAnalysisOpen(true);
            console.log('✅ PI - Analysis sidebar opened');
        } catch (err) {
            console.error('Error loading patient analysis:', err);
            // Fallback to basic data if comprehensive analysis not available
            const fallbackPatient = {
                id: patient.patientId,
                gender: patient.patientData?.gender || 'Unknown',
                age: patient.patientData?.age || 'N/A',
                birthdate: null,
                conditions: [],
                observations: []
            };

            const fallbackAnalysis = {
                eligibility_status: patient.patientData?.status || 'UNKNOWN',
                confidence_score: patient.patientData?.confidence || 0,
                reasons: {
                    error: 'Detailed analysis not available. Please ensure screening was run and saved to database.'
                }
            };

            setSelectedPatientAnalysis({
                patient: fallbackPatient,
                analysis: fallbackAnalysis
            });
            setAnalysisOpen(true);
        } finally {
            setLoadingAnalysis(false);
        }
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
                <CircularProgress size={60} />
            </Box>
        );
    }

    if (error && !submission) {
        return (
            <Box sx={{ mt: 4 }}>
                <Alert severity="error">{error}</Alert>
                <Button startIcon={<ArrowBack />} onClick={() => navigate('/')} sx={{ mt: 2 }}>
                    Back to Dashboard
                </Button>
            </Box>
        );
    }

    const trial = submission.trial;
    const pendingCount = submission.patients.filter(p => p.isApproved === null).length;

    return (
        <Box sx={{ width: '100%' }}>
            {/* Header */}
            <Box sx={{ mb: 3, p: 2, bgcolor: 'white', borderRadius: 2, boxShadow: 1 }}>
                <Box display="flex" alignItems="center" gap={2}>
                    <Button startIcon={<ArrowBack />} onClick={() => navigate('/')}>
                        Back to Submissions
                    </Button>
                    <Typography variant="h4" sx={{ fontWeight: 700, flex: 1 }}>
                        Trial Submission Review
                    </Typography>
                    <Button
                        variant="outlined"
                        startIcon={loadingReport ? <CircularProgress size={16} /> : <Visibility />}
                        onClick={() => fetchReportData(trial)}
                        disabled={loadingReport}
                    >
                        {loadingReport ? 'Loading Report...' : 'View Full Report'}
                    </Button>
                </Box>
            </Box>

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}

            {/* Trial Information */}
            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                        Trial Information
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary">Protocol Title</Typography>
                            <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                {trial.protocolTitle || trial.trialId}
                            </Typography>
                        </Grid>
                        <Grid item xs={12} md={3}>
                            <Typography variant="body2" color="text.secondary">Phase</Typography>
                            <Chip label={trial.phase || 'N/A'} size="small" color="primary" />
                        </Grid>
                        <Grid item xs={12} md={3}>
                            <Typography variant="body2" color="text.secondary">Drug Name</Typography>
                            <Typography variant="body1">{trial.drugName || 'N/A'}</Typography>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary">Organization</Typography>
                            <Typography variant="body1">
                                {submission.submittedByUser.organization?.name || 'N/A'}
                            </Typography>
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <Typography variant="body2" color="text.secondary">Submitted On</Typography>
                            <Typography variant="body1">
                                {new Date(submission.submissionDate).toLocaleString()}
                            </Typography>
                        </Grid>
                        {submission.notes && (
                            <Grid item xs={12}>
                                <Typography variant="body2" color="text.secondary">Notes from Organization</Typography>
                                <Paper elevation={0} sx={{ p: 2, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                                    <Typography variant="body2">{submission.notes}</Typography>
                                </Paper>
                            </Grid>
                        )}
                    </Grid>
                </CardContent>
            </Card>

            {/* Patient List */}
            <Card sx={{ mb: 3 }}>
                <CardContent>
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            Patients ({submission.patients.length})
                        </Typography>
                        <Box display="flex" gap={2} alignItems="center">
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={selectAll}
                                        onChange={handleSelectAll}
                                        disabled={actionLoading}
                                    />
                                }
                                label="Select All"
                            />
                            <Button
                                variant="contained"
                                color="primary"
                                startIcon={<Save />}
                                onClick={handleSaveSelections}
                                disabled={actionLoading || selectedPatients.size === 0}
                            >
                                Save ({selectedPatients.size})
                            </Button>
                            {pendingCount > 0 && (
                                <Button
                                    variant="contained"
                                    color="success"
                                    startIcon={<ThumbUp />}
                                    onClick={handleApproveAll}
                                    disabled={actionLoading}
                                >
                                    Approve All
                                </Button>
                            )}
                        </Box>
                    </Box>

                    {saveMessage && (
                        <Alert severity={saveMessage.includes('Successfully') ? 'success' : 'error'} sx={{ mb: 2 }}>
                            {saveMessage}
                        </Alert>
                    )}

                    <TableContainer component={Paper} variant="outlined">
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell padding="checkbox" sx={{ width: 50 }}>Select</TableCell>
                                    <TableCell>Patient ID</TableCell>
                                    <TableCell>Age</TableCell>
                                    <TableCell>Gender</TableCell>
                                    <TableCell>Eligibility Status</TableCell>
                                    <TableCell>Confidence</TableCell>
                                    <TableCell>Approval Status</TableCell>
                                    <TableCell>Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {submission.patients.map((patient) => {
                                    const patientData = patient.patientData || {};
                                    const reasons = patientData.reasons || [];
                                    const reasonsText = Array.isArray(reasons)
                                        ? reasons.join(', ')
                                        : (typeof reasons === 'string' ? reasons : 'N/A');

                                    return (
                                        <TableRow key={patient.id}>
                                            <TableCell padding="checkbox">
                                                <Checkbox
                                                    checked={selectedPatients.has(patient.id)}
                                                    onChange={() => handlePatientToggle(patient.id)}
                                                    disabled={actionLoading}
                                                />
                                            </TableCell>
                                            <TableCell sx={{ fontWeight: 600 }}>
                                                {patient.patientId}
                                            </TableCell>
                                            <TableCell>
                                                {patientData.age || 'N/A'}
                                            </TableCell>
                                            <TableCell>
                                                {patientData.gender || 'N/A'}
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={patientData.status || 'Unknown'}
                                                    color={patientData.status === 'eligible' ? 'success' : 'error'}
                                                    size="small"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                {patientData.confidence ? `${Math.round(patientData.confidence * 100)}%` : 'N/A'}
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    label={getApprovalLabel(patient.isApproved)}
                                                    color={getApprovalColor(patient.isApproved)}
                                                    size="small"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Box display="flex" gap={1} alignItems="center">
                                                    <Button
                                                        variant="outlined"
                                                        size="small"
                                                        startIcon={<Visibility />}
                                                        onClick={() => handleViewAnalysis(patient)}
                                                        disabled={loadingAnalysis}
                                                    >
                                                        View Analysis
                                                    </Button>
                                                    {patient.isApproved === null ? (
                                                        <Box display="flex" gap={1}>
                                                            <IconButton
                                                                color="success"
                                                                size="small"
                                                                onClick={() => handleApprovePatient(patient.patientId, true)}
                                                                disabled={actionLoading}
                                                            >
                                                                <ThumbUp />
                                                            </IconButton>
                                                            <IconButton
                                                                color="error"
                                                                size="small"
                                                                onClick={() => handleApprovePatient(patient.patientId, false)}
                                                                disabled={actionLoading}
                                                            >
                                                                <ThumbDown />
                                                            </IconButton>
                                                        </Box>
                                                    ) : (
                                                        <Typography variant="body2" color="text.secondary">
                                                            {patient.isApproved ? '✓' : '✗'}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </CardContent>
            </Card>

            {/* Reviews & Comments */}
            <Card>
                <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                        Reviews & Comments
                    </Typography>

                    {/* Add Comment */}
                    <Box display="flex" gap={1} mb={3}>
                        <TextField
                            fullWidth
                            multiline
                            rows={2}
                            placeholder="Add a comment or note..."
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                        />
                        <Button
                            variant="contained"
                            onClick={handleAddComment}
                            disabled={!comment.trim() || actionLoading}
                            sx={{ minWidth: 100 }}
                        >
                            Post
                        </Button>
                    </Box>

                    <Divider sx={{ mb: 2 }} />

                    {/* Review History */}
                    {submission.reviews.length === 0 ? (
                        <Alert severity="info">No reviews yet</Alert>
                    ) : (
                        submission.reviews.map((review, idx) => (
                            <Paper
                                key={idx}
                                elevation={0}
                                sx={{ p: 2, mb: 2, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}
                            >
                                <Box display="flex" alignItems="center" gap={1} mb={1}>
                                    <Chip
                                        label={review.reviewType.replace(/_/g, ' ')}
                                        size="small"
                                        color={review.decision === 'approved' ? 'success' : review.decision === 'rejected' ? 'error' : 'default'}
                                    />
                                    {review.patientId && (
                                        <Chip label={`Patient: ${review.patientId}`} size="small" variant="outlined" />
                                    )}
                                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                                        {new Date(review.reviewedAt).toLocaleString()}
                                    </Typography>
                                </Box>
                                {review.comment && (
                                    <Typography variant="body2">{review.comment}</Typography>
                                )}
                            </Paper>
                        ))
                    )}
                </CardContent>
            </Card>

            {/* Approval Comment Dialog */}
            <Dialog open={commentDialog.open} onClose={() => setCommentDialog({ open: false, patientId: null, approved: null })}>
                <DialogTitle>
                    {commentDialog.approved ? 'Approve' : 'Reject'} Patient
                </DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Patient ID: {commentDialog.patientId}
                    </Typography>
                    <TextField
                        fullWidth
                        multiline
                        rows={3}
                        label="Comment (Optional)"
                        placeholder="Add your reasoning or notes..."
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCommentDialog({ open: false, patientId: null, approved: null })}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained"
                        color={commentDialog.approved ? 'success' : 'error'}
                        onClick={submitApproval}
                        disabled={actionLoading}
                    >
                        Confirm {commentDialog.approved ? 'Approval' : 'Rejection'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Trial Report Modal */}
            {trial && (
                <TrialReportModal
                    open={reportModalOpen}
                    onClose={() => setReportModalOpen(false)}
                    formData={reportData.formData}
                    intelData={reportData.intelData}
                    insilicoData={reportData.insilicoData}
                    documentInfo={reportData.documentInfo}
                />
            )}

            {/* Patient Analysis Sidebar */}
            {selectedPatientAnalysis && (
                <TrialAnalysisSidebar
                    open={analysisOpen}
                    onClose={() => setAnalysisOpen(false)}
                    patient={selectedPatientAnalysis.patient}
                    trial={trial}
                    analysis={selectedPatientAnalysis.analysis}
                />
            )}
        </Box>
    );
};

export default PISubmissionDetail;
