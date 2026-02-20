import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Checkbox,
    FormControlLabel,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Typography,
    Box,
    Chip,
    Alert,
    CircularProgress
} from '@mui/material';
import { Send as SendIcon, CheckCircle, Cancel } from '@mui/icons-material';
import apiClient from '../utils/apiClient';

const SendToPIDialog = ({ open, onClose, onSuccess, trial, eligibilityResults }) => {
    const [loading, setLoading] = useState(false);
    const [pis, setPIs] = useState([]);
    const [selectedPI, setSelectedPI] = useState('');
    const [selectAll, setSelectAll] = useState(false);
    const [selectedPatients, setSelectedPatients] = useState(new Set());
    const [notes, setNotes] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (open) {
            fetchPIs();
        }
    }, [open]);

    const fetchPIs = async () => {
        try {
            const response = await apiClient.get('/api/pi/list');
            setPIs(response.data.pis || []);
        } catch (err) {
            console.error('Error fetching PIs:', err);
            setError('Failed to load Principal Investigators');
        }
    };

    const handleSelectAll = (e) => {
        const checked = e.target.checked;
        setSelectAll(checked);
        if (checked) {
            setSelectedPatients(new Set());
        }
    };

    const handlePatientToggle = (patientId) => {
        const newSelected = new Set(selectedPatients);
        if (newSelected.has(patientId)) {
            newSelected.delete(patientId);
        } else {
            newSelected.add(patientId);
        }
        setSelectedPatients(newSelected);
        setSelectAll(false);
    };

    const handleSubmit = async () => {
        // Debug: Log trial object
        console.log('Trial object in SendToPIDialog:', trial);

        if (!trial) {
            setError('Trial information is missing');
            return;
        }

        if (!selectedPI) {
            setError('Please select a Principal Investigator');
            return;
        }

        const hasEligibilityData = eligiblePatients.length > 0;
        if (hasEligibilityData && !selectAll && selectedPatients.size === 0) {
            setError('Please select at least one patient or choose "Select All"');
            return;
        }

        setLoading(true);
        setError('');

        try {
            // Use trial.id if available, otherwise fall back to trial.trial_id
            const trialIdToSubmit = trial.id || trial.trial_id;

            if (!trialIdToSubmit) {
                setError('Trial ID is missing. Cannot submit.');
                setLoading(false);
                return;
            }

            // Prepare patient data from eligibility results
            let patientDataToSend = [];
            if (selectAll) {
                // Send all eligible patients data
                patientDataToSend = eligiblePatients.map(p => ({
                    patient_id: p.patient_id || p.id,
                    status: p.overall_eligibility || p.eligibility_status || 'ELIGIBLE',
                    confidence: p.confidence_score || p.confidence || 0.9,
                    age: p.age,
                    gender: p.gender,
                    reasons: p.reasons || []
                }));
            } else if (selectedPatients.size > 0) {
                // Send only selected patients data
                const selectedIds = Array.from(selectedPatients);
                patientDataToSend = eligibilityResults
                    .filter(p => selectedIds.includes(p.patient_id || p.id))
                    .map(p => ({
                        patient_id: p.patient_id || p.id,
                        status: p.overall_eligibility || p.eligibility_status || 'ELIGIBLE',
                        confidence: p.confidence_score || p.confidence || 0.9,
                        age: p.age,
                        gender: p.gender,
                        reasons: p.reasons || []
                    }));
            }

            const payload = {
                trialId: trialIdToSubmit,
                principalInvestigatorId: selectedPI,
                selectAll,
                patientIds: selectAll ? [] : Array.from(selectedPatients),
                patientData: patientDataToSend, // Include patient data directly
                notes,
                reportData: {
                    trialId: trial.trial_id || trial.id,
                    protocolTitle: trial.protocol_title,
                    phase: trial.phase,
                    indication: trial.indication,
                    drugName: trial.drug_name,
                    fda1571: trial.fda_1571,
                    fda1572: trial.fda_1572
                }
            };

            console.log('Submitting to PI with payload:', {
                trialId: payload.trialId,
                principalInvestigatorId: payload.principalInvestigatorId,
                patientCount: payload.patientData.length,
                selectAll: payload.selectAll
            });

            await apiClient.post('/api/submissions', payload);
            setSuccess(true);

            // Call onSuccess callback to refresh parent data
            if (onSuccess) {
                onSuccess();
            }

            setTimeout(() => {
                onClose();
                setSuccess(false);
                setSelectedPI('');
                setSelectAll(false);
                setSelectedPatients(new Set());
                setNotes('');
            }, 2000);
        } catch (err) {
            console.error('Error sending submission:', err);
            const errorData = err.response?.data;
            let errorMessage = errorData?.error || 'Failed to send trial to PI';

            // Add additional details if available
            if (errorData?.details) {
                errorMessage += `\n\n${errorData.details}`;
            }
            if (errorData?.suggestion) {
                errorMessage += `\n\n💡 ${errorData.suggestion}`;
            }
            if (errorData?.hint) {
                errorMessage += ` (${errorData.hint})`;
            }

            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    const eligiblePatients = eligibilityResults?.filter(r => {
        // Handle both data formats: overall_eligibility (from backend) or eligibility_status (from ScreeningPage)
        const status = r.overall_eligibility || r.eligibility_status || '';
        return status.toLowerCase().includes('eligible') || status.toLowerCase().includes('highly');
    }) || [];
    const patientCount = selectAll ? eligiblePatients.length : selectedPatients.size;

    // If dialog is open but trial is null, show error
    if (open && !trial) {
        return (
            <Dialog open={open} onClose={onClose} maxWidth="sm">
                <DialogTitle>Error</DialogTitle>
                <DialogContent>
                    <Alert severity="error">
                        Trial information is not available. Please try again or contact support.
                    </Alert>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Close</Button>
                </DialogActions>
            </Dialog>
        );
    }

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle>
                <Box display="flex" alignItems="center" gap={1}>
                    <SendIcon color="primary" />
                    <Typography variant="h6">Send Trial to Principal Investigator</Typography>
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {success ? (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        <Typography variant="h6">✅ Trial Submitted Successfully!</Typography>
                        <Typography variant="body2">
                            The trial has been sent to the Principal Investigator for review.
                        </Typography>
                    </Alert>
                ) : (
                    <>
                        {/* Trial Info */}
                        <Paper elevation={0} sx={{ p: 2, mb: 3, bgcolor: '#f8fafc', border: '1px solid #e2e8f0' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                                Trial: {trial?.protocol_title || trial?.trial_id}
                            </Typography>
                            <Box display="flex" gap={1} flexWrap="wrap">
                                <Chip label={`Phase: ${trial?.phase || 'N/A'}`} size="small" />
                                <Chip label={`Drug: ${trial?.drug_name || 'N/A'}`} size="small" />
                                <Chip
                                    label={`${eligiblePatients.length} Eligible Patients`}
                                    size="small"
                                    color="success"
                                />
                            </Box>
                        </Paper>

                        {/* Select PI */}
                        <FormControl fullWidth sx={{ mb: 3 }}>
                            <InputLabel>Principal Investigator *</InputLabel>
                            <Select
                                value={selectedPI}
                                onChange={(e) => setSelectedPI(e.target.value)}
                                label="Principal Investigator *"
                            >
                                {pis.map((pi) => (
                                    <MenuItem key={pi.id} value={pi.id}>
                                        <Box>
                                            <Typography variant="body1" sx={{ fontWeight: 600 }}>
                                                {pi.user.fullName}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {pi.specialization} • {pi.institution}
                                            </Typography>
                                        </Box>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        {/* Select Patients */}
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                            Select Patients to Include *
                        </Typography>

                        {eligiblePatients.length === 0 && (
                            <Alert severity="warning" sx={{ mb: 2 }}>
                                <Typography variant="body2" fontWeight={600} gutterBottom>
                                    No eligibility screening results available
                                </Typography>
                                <Typography variant="body2">
                                    Please go to the <strong>Screening page</strong> first to run patient eligibility analysis.
                                    This will ensure you can select specific eligible patients to send to the PI.
                                </Typography>
                            </Alert>
                        )}

                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={selectAll}
                                    onChange={handleSelectAll}
                                />
                            }
                            label={eligiblePatients.length > 0
                                ? `Select All Eligible Patients (${eligiblePatients.length} total)`
                                : 'Send entire trial for PI review'}
                            sx={{ mb: 2 }}
                        />

                        {!selectAll && (
                            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300, mb: 2 }}>
                                <Table stickyHeader size="small">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell padding="checkbox">Select</TableCell>
                                            <TableCell>Patient ID</TableCell>
                                            <TableCell>Age</TableCell>
                                            <TableCell>Gender</TableCell>
                                            <TableCell>Eligibility</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {eligiblePatients.map((patient) => {
                                            const patientId = patient.patient_id || patient.id;
                                            return (
                                                <TableRow
                                                    key={patientId}
                                                    hover
                                                    onClick={() => handlePatientToggle(patientId)}
                                                    sx={{ cursor: 'pointer' }}
                                                >
                                                    <TableCell padding="checkbox">
                                                        <Checkbox
                                                            checked={selectedPatients.has(patientId)}
                                                            onChange={() => handlePatientToggle(patientId)}
                                                        />
                                                    </TableCell>
                                                    <TableCell>{patientId}</TableCell>
                                                    <TableCell>{patient.age || 'N/A'}</TableCell>
                                                    <TableCell>{patient.gender || 'N/A'}</TableCell>
                                                    <TableCell>
                                                        <Chip
                                                            icon={<CheckCircle />}
                                                            label="Eligible"
                                                            size="small"
                                                            color="success"
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}

                        <Alert severity="info" sx={{ mb: 2 }}>
                            {eligiblePatients.length === 0
                                ? 'Entire trial will be sent for PI review'
                                : `${patientCount} patient${patientCount !== 1 ? 's' : ''} will be included in this submission`
                            }
                        </Alert>

                        {/* Notes */}
                        <TextField
                            fullWidth
                            multiline
                            rows={3}
                            label="Additional Notes (Optional)"
                            placeholder="Add any additional information or instructions for the Principal Investigator..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />

                        {error && (
                            <Alert severity="error" sx={{ mt: 2 }}>
                                {error}
                            </Alert>
                        )}
                    </>
                )}
            </DialogContent>

            <DialogActions sx={{ p: 2 }}>
                <Button onClick={onClose} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={loading || success}
                    startIcon={loading ? <CircularProgress size={20} /> : <SendIcon />}
                >
                    {loading ? 'Sending...' : 'Send to PI'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SendToPIDialog;
