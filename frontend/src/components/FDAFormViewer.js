import React, { useState } from 'react';
import { Box, Paper, Typography, Grid, TextField, Tabs, Tab, Button, Chip } from '@mui/material';
import { CheckCircle, Edit, Lock } from '@mui/icons-material';

const FDAFormViewer = ({ document, data, onUpdate, onReview, onSign }) => {
    const [tab, setTab] = useState(0);

    const isEditable = document?.status === 'extracted';
    const isReviewable = document?.status === 'extracted';
    const isSignable = document?.status === 'reviewed';
    const isSigned = document?.status === 'signed';

    const handleTabChange = (event, newValue) => {
        setTab(newValue);
    };

    return (
        <Box>
            <Paper sx={{ mb: 3 }}>
                <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 2 }}>
                    <Tabs value={tab} onChange={handleTabChange} aria-label="fda form tabs">
                        <Tab label="FDA Form 1571 (IND)" />
                        <Tab label="FDA Form 1572 (Investigator)" />
                    </Tabs>
                    <Box>
                        <Chip
                            label={document?.status?.toUpperCase()}
                            color={isSigned ? "success" : isSignable ? "info" : "warning"}
                            size="small"
                            sx={{ mr: 2 }}
                        />
                        {isReviewable && (
                            <Button variant="contained" size="small" startIcon={<CheckCircle />} onClick={onReview}>
                                Mark as Reviewed
                            </Button>
                        )}
                        {isSignable && (
                            <Button variant="contained" color="secondary" size="small" startIcon={<Edit />} onClick={onSign}>
                                Sign Form
                            </Button>
                        )}
                    </Box>
                </Box>

                <Box sx={{ p: 3 }}>
                    {tab === 0 && (
                        <Form1571View
                            data={data.fda_1571 || {}}
                            editable={isEditable}
                            onUpdate={(d) => onUpdate('fda_1571', d)}
                        />
                    )}
                    {tab === 1 && (
                        <Form1572View
                            data={data.fda_1572 || {}}
                            editable={isEditable}
                            onUpdate={(d) => onUpdate('fda_1572', d)}
                        />
                    )}
                </Box>
            </Paper>

            {document?.signed_by && (
                <Paper sx={{ p: 2, bgcolor: '#e8f5e9', display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Lock color="success" />
                    <Box>
                        <Typography variant="subtitle2">Digitally Signed by {document.signed_by}</Typography>
                        <Typography variant="caption">{new Date(document.signed_at).toLocaleString()}</Typography>
                    </Box>
                </Paper>
            )}
        </Box>
    );
};

const Form1571View = ({ data, editable, onUpdate }) => {
    const handleChange = (field, value) => {
        onUpdate({ ...data, [field]: value });
    };

    return (
        <Grid container spacing={3}>
            <Grid item xs={12}><Typography variant="h6" color="primary">Investigational New Drug Application (IND)</Typography></Grid>

            <Grid item xs={12} md={6}>
                <TextField
                    fullWidth label="Drug Name"
                    value={data.drug_name || ''}
                    onChange={e => handleChange('drug_name', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
            <Grid item xs={12} md={6}>
                <TextField
                    fullWidth label="IND Number"
                    value={data.ind_number || ''}
                    onChange={e => handleChange('ind_number', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
            <Grid item xs={12} md={6}>
                <TextField
                    fullWidth label="Dosage Form"
                    value={data.dosage_form || ''}
                    onChange={e => handleChange('dosage_form', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
            <Grid item xs={12} md={6}>
                <TextField
                    fullWidth label="Route of Admin"
                    value={data.route_of_administration || ''}
                    onChange={e => handleChange('route_of_administration', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
            <Grid item xs={12}>
                <TextField
                    fullWidth label="Indication"
                    value={data.indication || ''}
                    onChange={e => handleChange('indication', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
            <Grid item xs={12}>
                <TextField
                    fullWidth label="Sponsor Name"
                    value={data.sponsor_name || ''}
                    onChange={e => handleChange('sponsor_name', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
        </Grid>
    );
};

const Form1572View = ({ data, editable, onUpdate }) => {
    const handleChange = (field, value) => {
        onUpdate({ ...data, [field]: value });
    };

    return (
        <Grid container spacing={3}>
            <Grid item xs={12}><Typography variant="h6" color="secondary">Statement of Investigator</Typography></Grid>

            <Grid item xs={12}>
                <TextField
                    fullWidth label="Protocol Title" multiline rows={2}
                    value={data.protocol_title || ''}
                    onChange={e => handleChange('protocol_title', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
            <Grid item xs={12} md={6}>
                <TextField
                    fullWidth label="Protocol Number"
                    value={data.protocol_number || ''}
                    onChange={e => handleChange('protocol_number', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
            <Grid item xs={12} md={6}>
                <TextField
                    fullWidth label="Investigator Name"
                    value={data.investigator_name || ''}
                    onChange={e => handleChange('investigator_name', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
            <Grid item xs={12}>
                <TextField
                    fullWidth label="IRB Name"
                    value={data.irb_name || ''}
                    onChange={e => handleChange('irb_name', e.target.value)}
                    disabled={!editable}
                    variant={editable ? "outlined" : "filled"}
                />
            </Grid>
        </Grid>
    );
};

export default FDAFormViewer;
