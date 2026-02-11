import React, { useState, useEffect } from 'react';
import {
    Container,
    Typography,
    Box,
    TextField,
    Button,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    CircularProgress,
    Alert,
    Grid,
    Card,
    CardContent,
    Divider,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Tooltip
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ScienceIcon from '@mui/icons-material/Science';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import WarningIcon from '@mui/icons-material/Warning';
import DomainVerificationIcon from '@mui/icons-material/DomainVerification';

const API_URL = process.env.REACT_APP_API_URL || '';

const LiteratureAnalysisPage = () => {
    const [query, setQuery] = useState('Chagas Disease');
    const [loading, setLoading] = useState(false);
    const [results, setResults] = useState(null);
    const [error, setError] = useState(null);

    const handleAnalyze = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`${API_URL}/api/ltaa/analyze`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    disease_query: query,
                    max_papers: 5
                }),
            });

            if (!response.ok) {
                throw new Error('Analysis failed. Ensure Neo4j is running and SciSpaCy is loaded.');
            }

            const data = await response.json();
            setResults(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
                <ScienceIcon sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
                <Typography variant="h4" component="h1" gutterBottom sx={{ mb: 0 }}>
                    Literature & Target Analysis Agent
                </Typography>
            </Box>

            <Paper sx={{ p: 4, mb: 4, borderRadius: 2 }}>
                <Grid container spacing={2} alignItems="center">
                    <Grid item xs={12} md={8}>
                        <TextField
                            fullWidth
                            label="Disease Focus (e.g. Alzheimer's, Chagas Disease)"
                            variant="outlined"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            disabled={loading}
                        />
                    </Grid>
                    <Grid item xs={12} md={4}>
                        <Button
                            fullWidth
                            variant="contained"
                            size="large"
                            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <AutoFixHighIcon />}
                            onClick={handleAnalyze}
                            disabled={loading || !query}
                            sx={{ height: '56px' }}
                        >
                            {loading ? 'Analyzing Literature...' : 'Start AI Analysis'}
                        </Button>
                    </Grid>
                </Grid>
            </Paper>

            {error && (
                <Alert severity="error" sx={{ mb: 4 }}>
                    {error}
                </Alert>
            )}

            {results && (
                <Box>
                    <Grid container spacing={4}>
                        <Grid item xs={12} md={4}>
                            <Card sx={{ height: '100%' }}>
                                <CardContent>
                                    <Typography variant="h6" gutterBottom color="primary">
                                        Analysis Summary
                                    </Typography>
                                    <Divider sx={{ mb: 2 }} />
                                    <Typography variant="body1">
                                        {results.summary}
                                    </Typography>

                                    <Box sx={{ mt: 3, mb: 2 }}>
                                        {/* Domain Badge */}
                                        <Chip
                                            icon={<DomainVerificationIcon />}
                                            label={results.domain ? `Domain: ${results.domain.toUpperCase()}` : 'General Domain'}
                                            color="primary"
                                            variant="filled"
                                            sx={{ mr: 1, mb: 1 }}
                                        />

                                        {/* Document Type Badges */}
                                        {results.stats?.document_types?.map((type, idx) => (
                                            <Chip
                                                key={idx}
                                                label={type.replace('_', ' ').toUpperCase()}
                                                variant="outlined"
                                                size="small"
                                                sx={{ mr: 1, mb: 1 }}
                                            />
                                        ))}
                                    </Box>

                                    {/* Excluded Entities Accordion */}
                                    {results.excluded_entities && results.excluded_entities.total_excluded > 0 && (
                                        <Accordion variant="outlined" sx={{ mt: 2, borderColor: 'warning.light', '&:before': { display: 'none' } }}>
                                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                    <WarningIcon color="warning" fontSize="small" sx={{ mr: 1 }} />
                                                    <Typography variant="body2" color="text.secondary">
                                                        Filtered {results.excluded_entities.total_excluded} Non-Target Entities
                                                    </Typography>
                                                </Box>
                                            </AccordionSummary>
                                            <AccordionDetails>
                                                <Typography variant="caption" display="block" sx={{ mb: 1, fontWeight: 'bold' }}>
                                                    Top Filtered Terms (Validation Failed):
                                                </Typography>
                                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                    {results.excluded_entities.top_excluded.slice(0, 10).map((item, idx) => (
                                                        <Tooltip key={idx} title={`Reason: ${item.reason}`}>
                                                            <Chip
                                                                label={`${item.entity} (${item.count})`}
                                                                size="small"
                                                                color="default"
                                                                variant="outlined"
                                                                sx={{ bgcolor: '#fafafa' }}
                                                            />
                                                        </Tooltip>
                                                    ))}
                                                </Box>
                                            </AccordionDetails>
                                        </Accordion>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12} md={8}>
                            <TableContainer component={Paper}>
                                <Table>
                                    <TableHead sx={{ backgroundColor: 'action.hover' }}>
                                        <TableRow>
                                            <TableCell><Typography fontWeight="bold">Biological Target</Typography></TableCell>
                                            <TableCell><Typography fontWeight="bold">Type</Typography></TableCell>
                                            <TableCell><Typography fontWeight="bold">Validation</Typography></TableCell>
                                            <TableCell align="center"><Typography fontWeight="bold">Evidence Score</Typography></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {results.ranked_targets.map((target, index) => (
                                            <TableRow key={index} hover>
                                                <TableCell>
                                                    <Box>
                                                        <Typography variant="body1" fontWeight="medium">
                                                            {target.name}
                                                        </Typography>
                                                        {target.validation_source && (
                                                            <Typography variant="caption" color="text.secondary">
                                                                {target.validation_source} ID: {target.validation_id || 'N/A'}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={target.type}
                                                        size="small"
                                                        color={target.type === 'Drug' ? 'secondary' : 'primary'}
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    {target.validation_source ? (
                                                        <Tooltip title={`Validated via ${target.validation_source}`}>
                                                            <Chip
                                                                icon={<VerifiedUserIcon fontSize="small" />}
                                                                label="Verified"
                                                                size="small"
                                                                color="success"
                                                                variant="outlined"
                                                            />
                                                        </Tooltip>
                                                    ) : (
                                                        <Chip label="Unverified" size="small" variant="outlined" />
                                                    )}
                                                </TableCell>
                                                <TableCell align="center">
                                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        <Typography variant="body2" sx={{ mr: 1 }}>{Number(target.score).toFixed(1)}</Typography>
                                                        <Box
                                                            sx={{
                                                                width: 50,
                                                                height: 8,
                                                                bgcolor: 'grey.200',
                                                                borderRadius: 1,
                                                                overflow: 'hidden'
                                                            }}
                                                        >
                                                            <Box
                                                                sx={{
                                                                    width: `${Math.min(target.score * 10, 100)}%`,
                                                                    height: '100%',
                                                                    bgcolor: 'primary.main'
                                                                }}
                                                            />
                                                        </Box>
                                                    </Box>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Grid>
                    </Grid>
                </Box>
            )}

            {!results && !loading && (
                <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
                    <SearchIcon sx={{ fontSize: 60, mb: 2, opacity: 0.3 }} />
                    <Typography variant="h6">
                        Enter a disease to discover potential biological targets
                    </Typography>
                    <Typography variant="body2">
                        AI will fetch scientific abstracts and analyze uploaded protocol PDFs.
                    </Typography>
                </Box>
            )}
        </Container>
    );
};

export default LiteratureAnalysisPage;
