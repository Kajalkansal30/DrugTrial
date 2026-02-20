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
    Avatar,
    TableSortLabel
} from '@mui/material';
import {
    Science as ScienceIcon,
    Assignment as AssignmentIcon,
    CheckCircle,
    HourglassEmpty,
    Cancel,
    Visibility
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';

const PIPage = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [dashboard, setDashboard] = useState(null);
    const [error, setError] = useState('');
    const [sortBy, setSortBy] = useState('submissionDate');
    const [sortOrder, setSortOrder] = useState('desc');

    useEffect(() => {
        fetchDashboard();
    }, []);

    const fetchDashboard = async () => {
        try {
            const response = await apiClient.get('/api/pi/dashboard');
            setDashboard(response.data);
        } catch (err) {
            console.error('Error fetching dashboard:', err);
            setError('Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    };

    const handleSort = (column) => {
        if (sortBy === column) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortOrder('desc');
        }
    };

    const getSortedSubmissions = () => {
        if (!dashboard?.recentSubmissions) return [];

        const sorted = [...dashboard.recentSubmissions].sort((a, b) => {
            let comparison = 0;

            switch (sortBy) {
                case 'trial':
                    comparison = (a.trial.protocolTitle || a.trial.trialId || '').localeCompare(
                        b.trial.protocolTitle || b.trial.trialId || ''
                    );
                    break;
                case 'organization':
                    comparison = (a.submittedByUser.organization?.name || '').localeCompare(
                        b.submittedByUser.organization?.name || ''
                    );
                    break;
                case 'patients':
                    comparison = a._count.patients - b._count.patients;
                    break;
                case 'submissionDate':
                    comparison = new Date(a.submissionDate) - new Date(b.submissionDate);
                    break;
                case 'status':
                    comparison = a.status.localeCompare(b.status);
                    break;
                default:
                    comparison = 0;
            }

            return sortOrder === 'asc' ? comparison : -comparison;
        });

        return sorted;
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
        const colors = {
            SUBMITTED: 'info',
            UNDER_REVIEW: 'warning',
            APPROVED: 'success',
            PARTIALLY_APPROVED: 'warning',
            REJECTED: 'error',
            WITHDRAWN: 'default'
        };
        return colors[status] || 'default';
    };

    const getStatusIcon = (status) => {
        const icons = {
            SUBMITTED: <HourglassEmpty />,
            UNDER_REVIEW: <AssignmentIcon />,
            APPROVED: <CheckCircle />,
            PARTIALLY_APPROVED: <CheckCircle />,
            REJECTED: <Cancel />
        };
        return icons[status];
    };

    const formatStatusLabel = (status) => {
        return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
                <CircularProgress size={60} />
            </Box>
        );
    }

    if (error) {
        return (
            <Box sx={{ mt: 4 }}>
                <Alert severity="error">{error}</Alert>
            </Box>
        );
    }

    const { profile, stats, recentSubmissions } = dashboard;

    return (
        <Box sx={{ width: '100%' }}>
            {/* Header */}
            <Box sx={{ mb: 4, p: 3, bgcolor: 'white', borderRadius: 2, boxShadow: 1 }}>
                <Box display="flex" alignItems="center" gap={2} mb={2}>
                    <Avatar sx={{ width: 64, height: 64, bgcolor: '#2c5282', fontSize: 28 }}>
                        {profile.user.fullName?.charAt(0) || 'P'}
                    </Avatar>
                    <Box>
                        <Typography variant="h4" sx={{ fontWeight: 700 }}>
                            Dr. {profile.user.fullName}
                        </Typography>
                        <Typography variant="body1" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <ScienceIcon fontSize="small" />
                            Principal Investigator • {profile.pi.institution}
                        </Typography>
                    </Box>
                </Box>

                <Box display="flex" gap={1} mt={2}>
                    {profile.pi.specialization && (
                        <Chip
                            label={profile.pi.specialization}
                            color="primary"
                            sx={{ fontWeight: 600 }}
                        />
                    )}
                    {profile.pi.licenseNumber && (
                        <Chip
                            label={`License: ${profile.pi.licenseNumber}`}
                            variant="outlined"
                        />
                    )}
                </Box>
            </Box>

            {/* Statistics Cards */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <Box>
                                    <Typography color="text.secondary" variant="body2">
                                        Total Submissions
                                    </Typography>
                                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                                        {stats.totalSubmissions}
                                    </Typography>
                                </Box>
                                <AssignmentIcon sx={{ fontSize: 40, color: '#3b82f6' }} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <Box>
                                    <Typography color="text.secondary" variant="body2">
                                        Pending Review
                                    </Typography>
                                    <Typography variant="h4" sx={{ fontWeight: 700, color: '#f59e0b' }}>
                                        {stats.pendingSubmissions}
                                    </Typography>
                                </Box>
                                <HourglassEmpty sx={{ fontSize: 40, color: '#f59e0b' }} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <Box>
                                    <Typography color="text.secondary" variant="body2">
                                        Approved
                                    </Typography>
                                    <Typography variant="h4" sx={{ fontWeight: 700, color: '#10b981' }}>
                                        {stats.approvedSubmissions}
                                    </Typography>
                                </Box>
                                <CheckCircle sx={{ fontSize: 40, color: '#10b981' }} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                    <Card>
                        <CardContent>
                            <Box display="flex" alignItems="center" justifyContent="space-between">
                                <Box>
                                    <Typography color="text.secondary" variant="body2">
                                        Patients Reviewed
                                    </Typography>
                                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                                        {stats.approvedPatients}/{stats.totalPatients}
                                    </Typography>
                                </Box>
                                <ScienceIcon sx={{ fontSize: 40, color: '#8b5cf6' }} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Submissions Table */}
            <Card>
                <CardContent>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
                        Trial Submissions
                    </Typography>

                    {recentSubmissions.length === 0 ? (
                        <Alert severity="info">
                            No trial submissions yet. Organizations will send trial details here for your review.
                        </Alert>
                    ) : (
                        <TableContainer component={Paper} variant="outlined">
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>
                                            <TableSortLabel
                                                active={sortBy === 'trial'}
                                                direction={sortBy === 'trial' ? sortOrder : 'asc'}
                                                onClick={() => handleSort('trial')}
                                            >
                                                Trial ID & Title
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell>
                                            <TableSortLabel
                                                active={sortBy === 'organization'}
                                                direction={sortBy === 'organization' ? sortOrder : 'asc'}
                                                onClick={() => handleSort('organization')}
                                            >
                                                Organization
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell align="center">
                                            <TableSortLabel
                                                active={sortBy === 'patients'}
                                                direction={sortBy === 'patients' ? sortOrder : 'asc'}
                                                onClick={() => handleSort('patients')}
                                            >
                                                Patients
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell>
                                            <TableSortLabel
                                                active={sortBy === 'submissionDate'}
                                                direction={sortBy === 'submissionDate' ? sortOrder : 'asc'}
                                                onClick={() => handleSort('submissionDate')}
                                            >
                                                Submitted Date & Time
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell>
                                            <TableSortLabel
                                                active={sortBy === 'status'}
                                                direction={sortBy === 'status' ? sortOrder : 'asc'}
                                                onClick={() => handleSort('status')}
                                            >
                                                Review Status
                                            </TableSortLabel>
                                        </TableCell>
                                        <TableCell align="right">Actions</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {getSortedSubmissions().map((submission) => (
                                        <TableRow key={submission.id} hover>
                                            <TableCell>
                                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                                    {submission.trial.trialId}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                                                    {submission.trial.protocolTitle || 'Untitled Trial'}
                                                </Typography>
                                                <Box display="flex" gap={0.5} mt={0.5}>
                                                    {submission.trial.phase && (
                                                        <Chip label={submission.trial.phase} size="small" />
                                                    )}
                                                    {submission.trial.drugName && (
                                                        <Chip label={submission.trial.drugName} size="small" variant="outlined" />
                                                    )}
                                                </Box>
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                    {submission.submittedByUser.organization?.name || 'N/A'}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {submission.submittedByUser.fullName || ''}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="center">
                                                <Chip
                                                    label={submission._count.patients}
                                                    size="small"
                                                    color="primary"
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <Typography variant="body2">
                                                    {formatDateTime(submission.submissionDate)}
                                                </Typography>
                                            </TableCell>
                                            <TableCell>
                                                <Chip
                                                    icon={getStatusIcon(submission.status)}
                                                    label={formatStatusLabel(submission.status)}
                                                    color={getStatusColor(submission.status)}
                                                    size="small"
                                                />
                                            </TableCell>
                                            <TableCell align="right">
                                                <Button
                                                    variant="outlined"
                                                    size="small"
                                                    startIcon={<Visibility />}
                                                    onClick={() => navigate(`/submissions/${submission.id}`)}
                                                >
                                                    Review
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </CardContent>
            </Card>
        </Box>
    );
};

export default PIPage;
