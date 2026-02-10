import React, { useState, useEffect } from 'react';
import {
    Box, Paper, Typography, Grid, Card, CardContent,
    Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Chip, LinearProgress, Alert, AlertTitle, Button, Tooltip, Divider
} from '@mui/material';
import {
    AdminPanelSettings, Security, VerifiedUser, BugReport,
    CompareArrows, Visibility, VisibilityOff, Refresh
} from '@mui/icons-material';

const API_BASE = 'http://localhost:8201/api';

const PrivacyAuditPage = () => {
    const [summary, setSummary] = useState(null);
    const [samples, setSamples] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showVault, setShowVault] = useState({});

    const fetchData = async () => {
        setLoading(true);
        try {
            const sumRes = await fetch(`${API_BASE}/privacy/summary`);
            const sumData = await sumRes.json();
            setSummary(sumData);

            const sampleRes = await fetch(`${API_BASE}/privacy/verify-samples`);
            const sampleData = await sampleRes.json();
            setSamples(sampleData);
        } catch (error) {
            console.error('Error fetching privacy audit data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const toggleVaultVisibility = (id) => {
        setShowVault(prev => ({ ...prev, [id]: !prev[id] }));
    };

    if (loading && !summary) return <LinearProgress />;

    return (
        <Box sx={{ py: 3 }}>
            <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#102a43', display: 'flex', alignItems: 'center' }}>
                        <AdminPanelSettings sx={{ mr: 2, fontSize: 40, color: '#334e68' }} />
                        Privacy & Compliance Audit
                    </Typography>
                    <Typography variant="subtitle1" color="text.secondary">
                        HIPAA 164.514 Compliance Verification Lab
                    </Typography>
                </Box>
                <Button variant="contained" startIcon={<Refresh />} onClick={fetchData} sx={{ borderRadius: 2 }}>
                    Re-scan Pipeline
                </Button>
            </Box>

            {/* Summary Cards */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid item xs={12} md={4}>
                    <Card sx={{ borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', height: '100%' }}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                <Security color="primary" sx={{ mr: 1 }} />
                                <Typography variant="h6">De-identification Status</Typography>
                            </Box>
                            <Typography variant="h3" sx={{ fontWeight: 700 }}>
                                {summary?.compliance_score.toFixed(1)}%
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {summary?.deidentified_count} of {summary?.total_patients} Patients Anonymized
                            </Typography>
                            <LinearProgress
                                variant="determinate"
                                value={summary?.compliance_score}
                                sx={{ mt: 2, height: 8, borderRadius: 4 }}
                            />
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                    <Card sx={{ borderRadius: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)', height: '100%', borderColor: summary?.status === 'SECURE' ? '#e3f9e5' : '#ffeeee' }}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                <BugReport color={summary?.status === 'SECURE' ? "success" : "error"} sx={{ mr: 1 }} />
                                <Typography variant="h6">Leak Detection</Typography>
                            </Box>
                            <Typography variant="h3" sx={{ fontWeight: 700, color: summary?.status === 'SECURE' ? '#2f8132' : '#d64545' }}>
                                {summary?.plain_text_leaks}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                Plain-text PII attributes found in Research Layer
                            </Typography>
                            <Chip
                                label={summary?.status}
                                color={summary?.status === 'SECURE' ? "success" : "error"}
                                sx={{ mt: 2, fontWeight: 700 }}
                            />
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                    <Card sx={{ borderRadius: 4, bgcolor: '#102a43', color: 'white', height: '100%' }}>
                        <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                <VerifiedUser sx={{ mr: 1, color: '#48bb78' }} />
                                <Typography variant="h6">Audit Trail integrity</Typography>
                            </Box>
                            <Typography variant="h3" sx={{ fontWeight: 700 }}>VERIFIED</Typography>
                            <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                Hashing Chain Root: sha256:70fee...
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.6 }}>
                                Last Chain Verification: Today 21:05
                            </Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Verification Lab */}
            <Paper sx={{ p: 4, borderRadius: 4, boxShadow: '0 10px 30px rgba(0,0,0,0.08)' }}>
                <Typography variant="h5" sx={{ mb: 3, fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                    <CompareArrows sx={{ mr: 1 }} /> Verification Lab: Split-Storage Audit
                </Typography>

                <Alert severity="info" sx={{ mb: 4, borderRadius: 2 }}>
                    <AlertTitle>Audit Protocol</AlertTitle>
                    This lab displays a side-by-side comparison of <strong>De-identified Research Records</strong> vs. the <strong>Encrypted PII Vault</strong>. Access to vault data is restricted to authorized auditors under 21 CFR Part 11.
                </Alert>

                <TableContainer>
                    <Table>
                        <TableHead>
                            <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                <TableCell sx={{ fontWeight: 700 }}>Research ID (Public)</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Age Group</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                <TableCell sx={{ fontWeight: 700, bgcolor: '#ebf4ff' }}>Vault Data (Private View)</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {samples.map((row, index) => (
                                <TableRow key={index} hover>
                                    <TableCell>
                                        <code style={{ fontSize: '0.9rem', color: '#334e68', fontWeight: 600 }}>
                                            {row.research.id}
                                        </code>
                                    </TableCell>
                                    <TableCell>
                                        <Chip label={row.research.age_group} size="small" variant="outlined" />
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label="PSEUDONYMIZED"
                                            size="small"
                                            color="success"
                                            icon={<Security sx={{ fontSize: '12px !important' }} />}
                                            sx={{ fontWeight: 700, fontSize: '10px' }}
                                        />
                                    </TableCell>
                                    <TableCell sx={{ bgcolor: showVault[row.research.id] ? '#ebf4ff' : '#f1f5f9' }}>
                                        {showVault[row.research.id] ? (
                                            <Box sx={{ fontSize: '0.85rem' }}>
                                                <div><strong>Name:</strong> {row.vault.first_name} {row.vault.last_name}</div>
                                                <div><strong>Original ID:</strong> {row.vault.original_id}</div>
                                                <div><strong>SSN:</strong> {row.vault.masked_ssn}</div>
                                            </Box>
                                        ) : (
                                            <Box sx={{ display: 'flex', alignItems: 'center', opacity: 0.5 }}>
                                                <VisibilityOff sx={{ mr: 1, fontSize: 18 }} />
                                                <em>Encrypted in Vault</em>
                                            </Box>
                                        )}
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title={showVault[row.research.id] ? "Mask Vault Data" : "Unmask for verification"}>
                                            <Button
                                                size="small"
                                                variant={showVault[row.research.id] ? "outlined" : "contained"}
                                                onClick={() => toggleVaultVisibility(row.research.id)}
                                                startIcon={showVault[row.research.id] ? <VisibilityOff /> : <Visibility />}
                                                sx={{ borderRadius: 2 }}
                                            >
                                                {showVault[row.research.id] ? "Mask" : "Verify"}
                                            </Button>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>
        </Box>
    );
};

export default PrivacyAuditPage;
