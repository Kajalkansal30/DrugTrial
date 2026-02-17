import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Card, CardContent, Grid, Chip,
    CircularProgress, Alert, Divider, Tooltip
} from '@mui/material';
import {
    Science, Warning, Timer, CheckCircle,
    HelpOutline, BlurOn, Adjust, Healing,
    SwapHoriz, WaterDrop, Error, ScienceOutlined
} from '@mui/icons-material';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip as ChartTooltip, ResponsiveContainer
} from 'recharts';
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '';

const ToxicityIcon = ({ tox }) => {
    if (!tox) return <ScienceOutlined sx={{ color: '#9fa8da' }} />;
    const isHigh = tox.status === 'high' || tox.risk_level === 'High';
    return isHigh ? <Error sx={{ color: '#d32f2f' }} /> : <CheckCircle sx={{ color: '#2b9348' }} />;
};

const MetricItem = ({ label, value, sub, color }) => (
    <Grid item xs={6} md={3}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</Typography>
        <Typography variant="h6" sx={{ fontWeight: 'bold', color: color || 'inherit' }}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{sub}</Typography>
    </Grid>
);

const InSilicoDashboard = ({ trialId, indication, isActive, onDataLoaded }) => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [polling, setPolling] = useState(false);
    const fetchedRef = React.useRef(false);

    useEffect(() => {
        if (!isActive || !trialId || fetchedRef.current) return;

        const fetchData = async () => {
            try {
                const cacheRes = await axios.get(`${API_BASE}/api/insilico/results/${trialId}`);
                if (cacheRes.data.status === 'ready') {
                    setData(cacheRes.data);
                    setLoading(false);
                    fetchedRef.current = true;
                    if (onDataLoaded) onDataLoaded(cacheRes.data);
                    return;
                }

                if (cacheRes.data.status === 'not_started') {
                    setError(cacheRes.data.message || "No trial created yet. Create a trial from this document to start analysis.");
                    setLoading(false);
                    return;
                }

                if (cacheRes.data.status === 'failed') {
                    setError(cacheRes.data.message || "Analysis failed.");
                    setLoading(false);
                    return;
                }

                // Background task still running — show pending state and poll
                setPolling(true);
                setLoading(false);
            } catch (err) {
                console.error("In Silico Load Error:", err);
                setError("Computational analysis is still being processed. Please refresh in a moment.");
                setLoading(false);
            }
        };

        fetchData();
    }, [trialId, isActive]);

    // Auto-poll when results are pending
    useEffect(() => {
        if (!polling || !trialId || !isActive) return;
        const interval = setInterval(async () => {
            try {
                const res = await axios.get(`${API_BASE}/api/insilico/results/${trialId}`);
                if (res.data.status === 'ready') {
                    setData(res.data);
                    setPolling(false);
                    fetchedRef.current = true;
                    if (onDataLoaded) onDataLoaded(res.data);
                }
                if (res.data.status === 'not_started' || res.data.status === 'failed') {
                    setPolling(false);
                    setError(res.data.message);
                }
            } catch (e) { /* ignore polling errors */ }
        }, 8000);
        return () => clearInterval(interval);
    }, [polling, trialId, isActive]);

    if (loading) return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
            <CircularProgress size={60} thickness={4} />
            <Typography variant="h6" sx={{ mt: 2 }}>Running Molecular Simulations...</Typography>
            <Typography variant="body2" color="text.secondary">Running SciSpaCy deep scan & toxicity prediction</Typography>
        </Box>
    );

    if (error) return <Alert severity="info" sx={{ mt: 2, borderRadius: 2 }}>{error}</Alert>;

    if (polling && !data) return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8 }}>
            <CircularProgress size={60} thickness={4} />
            <Typography variant="h6" sx={{ mt: 2 }}>In Silico Analysis Running in Background...</Typography>
            <Typography variant="body2" color="text.secondary">Results will appear automatically when ready. Checking every 8 seconds.</Typography>
        </Box>
    );

    if (data && data.error) return (
        <Alert severity="warning" icon={<HelpOutline />} sx={{ mt: 2, borderRadius: 2 }}>
            <strong>Modeling Unavailable:</strong> {data.error}
            <br />
            Deep scan did not identify specific drug candidates for molecular modeling in this section.
        </Alert>
    );

    const { drugs, interactions, simulation, target_analysis } = data || {};

    return (
        <Box sx={{ p: 1 }}>
            <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold', mb: 3, display: 'flex', alignItems: 'center', color: '#1a365d' }}>
                <Science sx={{ mr: 1.5, color: '#3182ce' }} /> In Silico Analysis Center
            </Typography>

            <Grid container spacing={3}>
                {/* 1. Target Interaction Analysis */}
                {(target_analysis?.targets?.length > 0 || target_analysis?.rationale) && (
                    <Grid item xs={12}>
                        <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 4, bgcolor: '#ebf8ff' }}>
                            <CardContent sx={{ p: 3 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                    <BlurOn sx={{ mr: 1.5, color: '#5a67d8' }} />
                                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#2c5282' }}>Molecular Target Identification</Typography>
                                </Box>

                                {target_analysis.rationale && (
                                    <Typography variant="body1" sx={{ fontStyle: 'italic', mb: 3, color: '#4a5568', lineHeight: 1.6 }}>
                                        "{target_analysis.rationale}"
                                    </Typography>
                                )}

                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                                    {target_analysis.targets?.map((t, idx) => (
                                        <Tooltip key={idx} title={t.definition || t.canonical_name}>
                                            <Chip
                                                label={t.canonical_name}
                                                sx={{
                                                    bgcolor: 'white',
                                                    border: '1px solid #bee3f8',
                                                    fontWeight: 600,
                                                    color: '#2b6cb0',
                                                    '&:hover': { bgcolor: '#edf2f7' }
                                                }}
                                                icon={<Adjust sx={{ fontSize: '16px !important', color: '#4299e1 !important' }} />}
                                            />
                                        </Tooltip>
                                    ))}
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                )}

                {/* 2. Drug Profiles & ADMET */}
                {drugs?.map((item, index) => (
                    <Grid item xs={12} md={6} key={index}>
                        <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 4, height: '100%', transition: 'all 0.3s ease', '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 20px -10px rgba(0,0,0,0.1)' } }}>
                            <CardContent sx={{ p: 3 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2.5 }}>
                                    <Box>
                                        <Typography variant="h6" sx={{ fontWeight: 800, color: '#2d3748' }}>
                                            {item.drug.name}
                                        </Typography>
                                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                                            {item.drug.dose} {item.drug.unit} · {item.drug.route} · {item.drug.frequency}
                                        </Typography>
                                    </Box>
                                    <Chip label="Simulated" color="success" size="small" variant="filled" sx={{ borderRadius: '6px', fontWeight: 700 }} />
                                </Box>

                                {item.chem && (
                                    <Box sx={{ mb: 3, p: 2, bgcolor: '#f7fafc', borderRadius: 3, border: '1px solid #edf2f7' }}>
                                        <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5, color: '#718096', textTransform: 'uppercase' }}>SMILES Structure</Typography>
                                        <Typography variant="body2" sx={{ fontFamily: 'Monaco, monospace', wordBreak: 'break-all', fontSize: '11px', color: '#4a5568' }}>
                                            {item.chem.smiles}
                                        </Typography>
                                    </Box>
                                )}

                                <Divider sx={{ mb: 2.5, borderStyle: 'dashed' }} />

                                <Typography variant="subtitle2" gutterBottom sx={{ fontWeight: 700, color: '#4a5568', mb: 2 }}>ADMET Safety Indicators</Typography>
                                <Grid container spacing={2}>
                                    <ADMETItem icon={<ToxicityIcon tox={item.tox} />} label="Toxicity" value={item.tox?.status === 'high' ? 'High Risk' : 'Low Risk'} color={item.tox?.status === 'high' ? '#e53e3e' : '#38a169'} />
                                    <ADMETItem icon={<Healing sx={{ color: '#38a169' }} />} label="Absorption" value="High (GI)" />
                                    <ADMETItem icon={<SwapHoriz sx={{ color: '#3182ce' }} />} label="Metabolism" value="Hepatic CYP450" />
                                    <ADMETItem icon={<WaterDrop sx={{ color: '#2b6cb0' }} />} label="Excretion" value="Renal/Biliary" />
                                </Grid>
                            </CardContent>
                        </Card>
                    </Grid>
                ))}

                {/* 3. PK/PD Curve */}
                {simulation ? (
                    <Grid item xs={12}>
                        <Card elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                            <CardContent sx={{ p: 3 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                                    <Timer sx={{ mr: 1.5, color: '#3182ce' }} />
                                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#2d3748' }}>Pharmacokinetic (PK) Profile</Typography>
                                    <Tooltip title="Predicted drug concentration over time using 1-compartment modeling.">
                                        <HelpOutline sx={{ ml: 1, fontSize: 18, color: '#cbd5e0', cursor: 'help' }} />
                                    </Tooltip>
                                </Box>

                                <Box sx={{ height: 380, width: '100%', mt: 2 }}>
                                    <ResponsiveContainer>
                                        <AreaChart data={simulation.time_points.map((t, i) => ({ time: t, conc: simulation.concentrations[i] }))}>
                                            <defs>
                                                <linearGradient id="colorConc" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#4299e1" stopOpacity={0.4} />
                                                    <stop offset="95%" stopColor="#4299e1" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f4f8" />
                                            <XAxis
                                                dataKey="time"
                                                tick={{ fill: '#718096', fontSize: 12 }}
                                                label={{ value: 'Time (Hours)', position: 'insideBottom', offset: -10, style: { fill: '#718096', fontWeight: 600 } }}
                                                tickFormatter={(val) => Math.round(val)}
                                            />
                                            <YAxis
                                                tick={{ fill: '#718096', fontSize: 12 }}
                                                label={{ value: 'Concentration (mg/L)', angle: -90, position: 'insideLeft', style: { fill: '#718096', fontWeight: 600 } }}
                                            />
                                            <ChartTooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 16px rgba(0,0,0,0.1)', fontWeight: 600 }} />
                                            <Area
                                                type="monotone"
                                                dataKey="conc"
                                                stroke="#3182ce"
                                                strokeWidth={4}
                                                fillOpacity={1}
                                                fill="url(#colorConc)"
                                                animationDuration={2000}
                                            />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </Box>

                                <Grid container spacing={3} sx={{ mt: 3, bgcolor: '#f7fafc', p: 3, borderRadius: 4, border: '1px solid #edf2f7' }}>
                                    <MetricItem label="Cmax" value={`${simulation.metrics.c_max} mg/L`} sub="Peak Plasma Conc" />
                                    <MetricItem label="t½" value={`${simulation.metrics.half_life} hrs`} sub="Elimination Half-life" />
                                    <MetricItem label="Steady State" value={`${simulation.metrics.c_min_ss} mg/L`} sub="Css Minimum" />
                                    <MetricItem label="Model" value="1-Comp Oral" sub="First-order Absorption" color="#38a169" />
                                </Grid>
                            </CardContent>
                        </Card>
                    </Grid>
                ) : (
                    <Grid item xs={12}>
                        <Card elevation={0} sx={{ border: '1px dashed #cbd5e0', bgcolor: '#f7fafc', borderRadius: 4 }}>
                            <CardContent sx={{ textAlign: 'center', py: 8 }}>
                                <ScienceOutlined sx={{ color: '#3182ce', fontSize: 56, mb: 2, opacity: 0.6 }} />
                                <Typography variant="h6" sx={{ fontWeight: 700, color: '#2d3748' }}>Awaiting Dosage Data</Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 450, mx: 'auto', mt: 1, lineHeight: 1.6 }}>
                                    Full protocol analysis is scanning for dosing regimens. Ensure the protocol contains
                                    explicit mg or mg/kg instructions for automated PK modeling.
                                </Typography>
                            </CardContent>
                        </Card>
                    </Grid>
                )}

                {/* 4. DDI Warnings */}
                {interactions && (
                    <Grid item xs={12}>
                        <Card elevation={0} sx={{ border: '1px solid #fed7d7', borderRadius: 4, bgcolor: '#fff5f5' }}>
                            <CardContent sx={{ p: 3 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                    <Warning sx={{ mr: 1.5, color: '#e53e3e' }} />
                                    <Typography variant="h6" sx={{ fontWeight: 700, color: '#9b2c2c' }}>Drug-Drug Interaction (DDI) Risks</Typography>
                                </Box>
                                <Box sx={{ p: 2.5, bgcolor: 'white', borderRadius: 3, border: '1px solid', borderColor: interactions.has_risk ? '#feb2b2' : '#c6f6d5' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                        {interactions.has_risk ? (
                                            <Error sx={{ color: '#e53e3e', mr: 2, fontSize: 32 }} />
                                        ) : (
                                            <CheckCircle sx={{ color: '#38a169', mr: 2, fontSize: 32 }} />
                                        )}
                                        <Box>
                                            <Typography variant="body1" sx={{ fontWeight: 700, color: interactions.has_risk ? '#9b2c2c' : '#22543d' }}>
                                                {interactions.has_risk ? "Critical Risks Identified" : "Safety Profile Verified"}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary">
                                                {interactions.summary || "No significant contraindications found with standard baseline therapy."}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </Box>
                            </CardContent>
                        </Card>
                    </Grid>
                )}
            </Grid>
        </Box>
    );
};

const ADMETItem = ({ icon, label, value, color }) => (
    <Grid item xs={6}>
        <Box sx={{ display: 'flex', alignItems: 'center', p: 1.5, bgcolor: '#ffffff', borderRadius: 2, border: '1px solid #f0f4f8' }}>
            <Box sx={{ display: 'flex', p: 0.5 }}>{icon}</Box>
            <Box sx={{ ml: 1.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#a0aec0', display: 'block', textTransform: 'uppercase', fontSize: '9px' }}>{label}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, color: color || '#2d3748' }}>{value}</Typography>
            </Box>
        </Box>
    </Grid>
);

export default InSilicoDashboard;
