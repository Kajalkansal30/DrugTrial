import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    CircularProgress,
    Alert,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Divider
} from '@mui/material';
import { Download, PictureAsPdf, Html as HtmlIcon } from '@mui/icons-material';
import { generateTrialReport, generateHTMLReport } from '../utils/reportGenerator';

const TrialReportDownloader = ({ open, onClose, trial, eligibilityResults, apiClient }) => {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);
    const [sections, setSections] = React.useState({
        trialInfo: true,
        fdaForms: true,
        eligibilityCriteria: true,
        patientAnalysis: true,
        inSilicoData: true,
        statisticalSummary: true
    });

    const handleSectionToggle = (section) => {
        setSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const handleDownloadPDF = async () => {
        setLoading(true);
        setError(null);

        try {
            console.log('Generating PDF report with sections:', sections);
            const pdfDoc = await generateTrialReport(trial, eligibilityResults, sections, apiClient);

            const fileName = `Trial_${trial.trialId || trial.trial_id}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
            pdfDoc.save(fileName);

            console.log('PDF downloaded successfully:', fileName);
            setTimeout(() => onClose(), 500);
        } catch (err) {
            console.error('Error generating PDF:', err);
            setError(err.message || 'Failed to generate PDF report');
        } finally {
            setLoading(false);
        }
    };

    const handleDownloadHTML = async () => {
        setLoading(true);
        setError(null);

        try {
            console.log('Generating HTML report with sections:', sections);
            const htmlContent = await generateHTMLReport(trial, eligibilityResults, sections, apiClient);

            const blob = new Blob([htmlContent], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Trial_${trial.trialId || trial.trial_id}_Report_${new Date().toISOString().split('T')[0]}.html`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            console.log('HTML downloaded successfully');
            setTimeout(() => onClose(), 500);
        } catch (err) {
            console.error('Error generating HTML:', err);
            setError(err.message || 'Failed to generate HTML report');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                <Box display="flex" alignItems="center" gap={1}>
                    <Download />
                    <Typography variant="h6">Download Trial Report</Typography>
                </Box>
            </DialogTitle>

            <DialogContent dividers>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Select the sections you want to include in the report:
                </Typography>

                <FormGroup>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={sections.trialInfo}
                                onChange={() => handleSectionToggle('trialInfo')}
                            />
                        }
                        label="Trial Information & Protocol Details"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={sections.fdaForms}
                                onChange={() => handleSectionToggle('fdaForms')}
                            />
                        }
                        label="FDA Forms (1571, 1572)"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={sections.eligibilityCriteria}
                                onChange={() => handleSectionToggle('eligibilityCriteria')}
                            />
                        }
                        label="Eligibility Criteria (Inclusion/Exclusion)"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={sections.patientAnalysis}
                                onChange={() => handleSectionToggle('patientAnalysis')}
                            />
                        }
                        label="Patient Screening Analysis"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={sections.inSilicoData}
                                onChange={() => handleSectionToggle('inSilicoData')}
                            />
                        }
                        label="In-Silico Research Data"
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={sections.statisticalSummary}
                                onChange={() => handleSectionToggle('statisticalSummary')}
                            />
                        }
                        label="Statistical Summary & Analytics"
                    />
                </FormGroup>

                <Divider sx={{ my: 2 }} />

                <Typography variant="caption" color="text.secondary">
                    Trial: {trial?.protocolTitle || trial?.trialId || 'N/A'}
                </Typography>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    variant="outlined"
                    onClick={handleDownloadHTML}
                    disabled={loading}
                    startIcon={loading ? <CircularProgress size={16} /> : <Download />}
                >
                    Download HTML
                </Button>
                <Button
                    variant="contained"
                    onClick={handleDownloadPDF}
                    disabled={loading}
                    startIcon={loading ? <CircularProgress size={16} /> : <PictureAsPdf />}
                >
                    Download PDF
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TrialReportDownloader;
