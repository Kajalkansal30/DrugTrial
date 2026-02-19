import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Chip, Card, CardContent,
    CircularProgress, Button, Alert, Tooltip, IconButton
} from '@mui/material';
import {
    Security,
    CheckCircle,
    Error,
    History,
    Fingerprint,
    Refresh,
    Verified
} from '@mui/icons-material';
import apiClient from '../utils/apiClient';

const AuditTrailPage = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(false);
    const [integrityStatus, setIntegrityStatus] = useState(null);

    useEffect(() => {
        fetchLogs();
    }, []);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const response = await apiClient.get('/api/audit/logs');
            setLogs(response.data);
        } catch (err) {
            console.error("Failed to fetch audit logs", err);
        } finally {
            setLoading(false);
        }
    };

    const verifyIntegrity = async () => {
        setVerifying(true);
        try {
            const response = await apiClient.get('/api/audit/verify-integrity');
            setIntegrityStatus(response.data);
        } catch (err) {
            console.error("Failed to verify integrity", err);
            setIntegrityStatus({ status: 'failed', message: 'Verification service unreachable' });
        } finally {
            setVerifying(false);
        }
    };

    const formatHash = (hash) => {
        if (!hash || hash === "None") return '-';
        return `${hash.substring(0, 8)}...${hash.substring(hash.length - 8)}`;
    };

    return (
        <Box sx={{ p: 0 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4 }}>
                <Box>
                    <Typography variant="h4" sx={{ fontWeight: 800, color: '#102a43', mb: 1 }}>
                        Regulatory Audit Trail
                    </Typography>
                    <Typography variant="body1" color="textSecondary">
                        Immutable, time-stamped record of all regulatory actions (FDA 21 CFR Part 11).
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                        startIcon={<Refresh />}
                        onClick={fetchLogs}
                        disabled={loading}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Refresh
                    </Button>
                    <Button
                        variant="contained"
                        color="primary"
                        startIcon={verifying ? <CircularProgress size={20} color="inherit" /> : <Verified />}
                        onClick={verifyIntegrity}
                        disabled={verifying}
                        sx={{ borderRadius: 2, fontWeight: 700, textTransform: 'none', px: 3 }}
                    >
                        Verify Chain Integrity
                    </Button>
                </Box>
            </Box>

            {integrityStatus && (
                <Alert
                    severity={integrityStatus.status === 'verified' ? "success" : "error"}
                    sx={{ mb: 3, borderRadius: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                    onClose={() => setIntegrityStatus(null)}
                >
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {integrityStatus.status === 'verified' ? "Integrity Verified" : "Integrity Check Failed"}
                    </Typography>
                    {integrityStatus.message}
                    {integrityStatus.errors && (
                        <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                            {integrityStatus.errors.map((err, i) => <li key={i}>{err}</li>)}
                        </ul>
                    )}
                </Alert>
            )}

            <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2, overflow: 'hidden' }}>
                <Table stickyHeader>
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc', color: '#475569' }}>Timestamp (UTC)</TableCell>
                            <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc', color: '#475569' }}>Action</TableCell>
                            <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc', color: '#475569' }}>Agent</TableCell>
                            <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc', color: '#475569' }}>Target</TableCell>
                            <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc', color: '#475569' }}>Status</TableCell>
                            <TableCell sx={{ fontWeight: 800, bgcolor: '#f8fafc', color: '#475569' }}>Document Hash</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center" sx={{ py: 10 }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                        <CircularProgress size={40} />
                                        <Typography color="textSecondary">Loading Audit Trail...</Typography>
                                    </Box>
                                </TableCell>
                            </TableRow>
                        ) : logs.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} align="center" sx={{ py: 10 }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, color: '#94a3b8' }}>
                                        <History sx={{ fontSize: 48 }} />
                                        <Typography sx={{ fontWeight: 600 }}>No audit entries found.</Typography>
                                    </Box>
                                </TableCell>
                            </TableRow>
                        ) : (
                            logs.map((log) => (
                                <TableRow key={log.id} hover>
                                    <TableCell sx={{ color: '#64748b', fontSize: '0.85rem' }}>
                                        {new Date(log.timestamp).toLocaleString()}
                                    </TableCell>
                                    <TableCell sx={{ fontWeight: 700, color: '#1e293b' }}>
                                        {log.action}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={log.agent}
                                            size="small"
                                            sx={{ borderRadius: 1, bgcolor: '#f1f5f9', fontWeight: 600, color: '#475569' }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        {log.target_type && (
                                            <Box>
                                                <Typography variant="caption" sx={{ color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>
                                                    {log.target_type}
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontWeight: 600, color: '#334155' }}>
                                                    {log.target_id}
                                                </Typography>
                                            </Box>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            icon={log.status === 'Success' ? <CheckCircle style={{ fontSize: 16 }} /> : <Error style={{ fontSize: 16 }} />}
                                            label={log.status}
                                            color={log.status === 'Success' ? 'success' : 'error'}
                                            size="small"
                                            variant="outlined"
                                            sx={{ fontWeight: 700, borderRadius: 1.5 }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Tooltip title={log.document_hash && log.document_hash !== "None" ? log.document_hash : "No document hash"}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'help' }}>
                                                <Fingerprint sx={{ fontSize: 16, color: '#94a3b8' }} />
                                                <Typography variant="body2" sx={{ fontFamily: 'monospace', color: '#64748b' }}>
                                                    {formatHash(log.document_hash)}
                                                </Typography>
                                            </Box>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default AuditTrailPage;
