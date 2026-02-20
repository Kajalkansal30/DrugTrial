import React, { useRef } from 'react';
import {
    Dialog, DialogTitle, DialogContent, Box, Typography,
    IconButton, Button, Divider, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Paper, Chip, Grid
} from '@mui/material';
import { Close, Print, Description } from '@mui/icons-material';

const printStyles = `
@media print {
    body * { visibility: hidden !important; }
    .trial-report-printable, .trial-report-printable * { visibility: visible !important; }
    .trial-report-printable {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        padding: 20px 40px !important;
        background: white !important;
    }
    .no-print { display: none !important; }
    .report-section { page-break-inside: avoid; margin-bottom: 24px; }
    .report-page-break { page-break-before: always; }
    table { font-size: 11px !important; }
    h2 { font-size: 16px !important; }
    h3 { font-size: 13px !important; }
}
`;

const SectionTitle = ({ number, title }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, mt: 4 }}>
        <Box sx={{
            width: 32, height: 32, borderRadius: '50%', bgcolor: '#1e293b',
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '0.85rem', flexShrink: 0
        }}>
            {number}
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 700, color: '#1e293b' }}>{title}</Typography>
    </Box>
);

const FieldRow = ({ label, value }) => {
    if (!value && value !== 0) return null;

    // Handle arrays
    if (Array.isArray(value)) {
        if (value.length === 0) return null;
        return (
            <TableRow>
                <TableCell sx={{ fontWeight: 600, color: '#475569', width: '35%', py: 1.2, borderColor: '#f1f5f9', verticalAlign: 'top' }}>{label}</TableCell>
                <TableCell sx={{ color: '#1e293b', py: 1.2, borderColor: '#f1f5f9' }}>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', listStyle: 'none' }}>
                        {value.map((item, idx) => {
                            // Handle objects with common patterns
                            if (typeof item === 'object' && item !== null) {
                                // Site pattern
                                if (item.site_name) {
                                    return (
                                        <li key={idx} style={{ marginBottom: '0.5rem', paddingLeft: '1rem', position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: 0, color: '#64748b' }}>•</span>
                                            <strong>{item.site_name}</strong>
                                            {item.site_address && <div style={{ color: '#64748b', fontSize: '0.875rem' }}>{item.site_address}</div>}
                                        </li>
                                    );
                                }
                                // Lab pattern
                                if (item.lab_name) {
                                    return (
                                        <li key={idx} style={{ marginBottom: '0.5rem', paddingLeft: '1rem', position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: 0, color: '#64748b' }}>•</span>
                                            <strong>{item.lab_name}</strong>
                                            {item.lab_address && <div style={{ color: '#64748b', fontSize: '0.875rem' }}>{item.lab_address}</div>}
                                        </li>
                                    );
                                }
                                // Investigator pattern
                                if (item.name) {
                                    return (
                                        <li key={idx} style={{ marginBottom: '0.5rem', paddingLeft: '1rem', position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: 0, color: '#64748b' }}>•</span>
                                            <strong>{item.name}</strong>
                                            {item.role && <span style={{ color: '#64748b', marginLeft: '0.5rem' }}>({item.role})</span>}
                                        </li>
                                    );
                                }
                                // Generic object - show as key: value pairs
                                const entries = Object.entries(item).filter(([_, v]) => v != null);
                                if (entries.length > 0) {
                                    return (
                                        <li key={idx} style={{ marginBottom: '0.5rem', paddingLeft: '1rem', position: 'relative' }}>
                                            <span style={{ position: 'absolute', left: 0, color: '#64748b' }}>•</span>
                                            {entries.map(([k, v], i) => (
                                                <div key={i}>
                                                    <strong>{k}:</strong> {String(v)}
                                                </div>
                                            ))}
                                        </li>
                                    );
                                }
                            }
                            // Primitive value
                            return (
                                <li key={idx} style={{ marginBottom: '0.25rem', paddingLeft: '1rem', position: 'relative' }}>
                                    <span style={{ position: 'absolute', left: 0, color: '#64748b' }}>•</span>
                                    {String(item)}
                                </li>
                            );
                        })}
                    </ul>
                </TableCell>
            </TableRow>
        );
    }

    // Handle objects
    if (typeof value === 'object' && value !== null) {
        return null; // Skip object display or handle specially
    }

    return (
        <TableRow>
            <TableCell sx={{ fontWeight: 600, color: '#475569', width: '35%', py: 1.2, borderColor: '#f1f5f9' }}>{label}</TableCell>
            <TableCell sx={{ color: '#1e293b', py: 1.2, borderColor: '#f1f5f9' }}>{value}</TableCell>
        </TableRow>
    );
};

const NotAvailable = ({ label }) => (
    <Box sx={{ p: 3, bgcolor: '#f8fafc', borderRadius: 2, border: '1px dashed #cbd5e0', textAlign: 'center', my: 2 }}>
        <Typography variant="body2" color="text.secondary">{label} analysis not yet available for this trial.</Typography>
    </Box>
);

const TrialReportModal = ({ open, onClose, formData, intelData, insilicoData, documentInfo }) => {
    const printRef = useRef(null);

    if (!open) return null;

    const fda1571 = formData?.['1571'] || {};
    const fda1572 = formData?.['1572'] || {};
    const doc = documentInfo?.document || {};
    const trial = documentInfo?.trial || {};

    const handlePrint = () => {
        window.print();
    };

    const ltaa = intelData;
    const insilico = insilicoData;

    return (
        <>
            <style>{printStyles}</style>
            <Dialog open={open} onClose={onClose} fullScreen>
                {/* Top Bar */}
                <DialogTitle className="no-print" sx={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    bgcolor: '#1e293b', color: 'white', py: 1.5
                }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Description />
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>Trial Analysis Report</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            variant="contained"
                            startIcon={<Print />}
                            onClick={handlePrint}
                            sx={{ bgcolor: '#3b82f6', textTransform: 'none', fontWeight: 600, borderRadius: 2 }}
                        >
                            Print / Save PDF
                        </Button>
                        <IconButton onClick={onClose} sx={{ color: 'white' }}><Close /></IconButton>
                    </Box>
                </DialogTitle>

                <DialogContent sx={{ bgcolor: '#f8fafc', p: 0 }}>
                    <Box
                        ref={printRef}
                        className="trial-report-printable"
                        sx={{ maxWidth: 900, mx: 'auto', p: 5, bgcolor: 'white', minHeight: '100vh' }}
                    >
                        {/* ── Cover / Header ── */}
                        <Box className="report-section" sx={{ textAlign: 'center', pb: 4, borderBottom: '3px solid #1e293b' }}>
                            <Typography variant="overline" sx={{ letterSpacing: 3, color: '#64748b', fontWeight: 600 }}>
                                CLINICAL TRIAL ANALYSIS REPORT
                            </Typography>
                            <Typography variant="h4" sx={{ fontWeight: 800, color: '#0f172a', mt: 1, mb: 2, lineHeight: 1.3 }}>
                                {fda1571.protocol_title || trial.protocol_title || 'Untitled Protocol'}
                            </Typography>
                            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
                                {fda1571.indication && (
                                    <Chip label={fda1571.indication} sx={{ fontWeight: 600, bgcolor: '#ecfdf5', color: '#065f46' }} />
                                )}
                                {fda1571.study_phase && (
                                    <Chip label={fda1571.study_phase} sx={{ fontWeight: 600, bgcolor: '#fef3c7', color: '#92400e' }} />
                                )}
                                {fda1571.route_of_administration && (
                                    <Chip label={fda1571.route_of_administration} sx={{ fontWeight: 600, bgcolor: '#eff6ff', color: '#1e40af' }} />
                                )}
                            </Box>
                            <Typography variant="body2" color="text.secondary">
                                Trial ID: {trial.trial_id || 'N/A'} | Document: {doc.filename || 'N/A'} | Generated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </Typography>
                        </Box>

                        {/* ── Section 1: FDA Form 1571 ── */}
                        <Box className="report-section">
                            <SectionTitle number="1" title="FDA Form 1571 — IND Application" />
                            <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
                                <Table size="small">
                                    <TableBody>
                                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                            <TableCell colSpan={2} sx={{ fontWeight: 700, color: '#334155', py: 1.5 }}>Drug Information</TableCell>
                                        </TableRow>
                                        <FieldRow label="Drug Name" value={fda1571.drug_name} />
                                        <FieldRow label="Dosage Form" value={fda1571.dosage_form} />
                                        <FieldRow label="Route of Administration" value={fda1571.route_of_administration} />
                                        <FieldRow label="Indication" value={fda1571.indication} />
                                        <FieldRow label="Manufacturer(s)" value={fda1571.manufacturer} />
                                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                            <TableCell colSpan={2} sx={{ fontWeight: 700, color: '#334155', py: 1.5 }}>Study Information</TableCell>
                                        </TableRow>
                                        <FieldRow label="Study Phase" value={fda1571.study_phase} />
                                        <FieldRow label="Protocol Title" value={fda1571.protocol_title} />
                                        <FieldRow label="Protocol Number" value={fda1571.protocol_number} />
                                        <FieldRow label="IND Number" value={fda1571.ind_number} />
                                        <FieldRow label="Submission Type" value={fda1571.submission_type} />
                                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                            <TableCell colSpan={2} sx={{ fontWeight: 700, color: '#334155', py: 1.5 }}>Sponsor Information</TableCell>
                                        </TableRow>
                                        <FieldRow label="Sponsor Name" value={fda1571.sponsor_name} />
                                        <FieldRow label="Sponsor Address" value={fda1571.sponsor_address} />
                                        <FieldRow label="Sponsor Phone" value={fda1571.sponsor_phone} />
                                        <FieldRow label="Contact Person" value={fda1571.contact_person} />
                                        <FieldRow label="Contact Phone" value={fda1571.contact_phone} />
                                        <FieldRow label="Contact Email" value={fda1571.contact_email} />
                                        <FieldRow label="FDA Review Division" value={fda1571.fda_review_division} />
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>

                        {/* ── Section 2: FDA Form 1572 ── */}
                        <Box className="report-section report-page-break">
                            <SectionTitle number="2" title="FDA Form 1572 — Investigator Statement" />
                            <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
                                <Table size="small">
                                    <TableBody>
                                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                            <TableCell colSpan={2} sx={{ fontWeight: 700, color: '#334155', py: 1.5 }}>Protocol Identification</TableCell>
                                        </TableRow>
                                        <FieldRow label="Protocol Title" value={fda1572.protocol_title} />
                                        <FieldRow label="Protocol Number" value={fda1572.protocol_number} />
                                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                            <TableCell colSpan={2} sx={{ fontWeight: 700, color: '#334155', py: 1.5 }}>Investigator Information</TableCell>
                                        </TableRow>
                                        <FieldRow label="Investigator Name" value={fda1572.investigator_name} />
                                        <FieldRow label="Investigator Address" value={fda1572.investigator_address} />
                                        <FieldRow label="Phone" value={fda1572.investigator_phone} />
                                        <FieldRow label="Email" value={fda1572.investigator_email} />
                                        <TableRow sx={{ bgcolor: '#f8fafc' }}>
                                            <TableCell colSpan={2} sx={{ fontWeight: 700, color: '#334155', py: 1.5 }}>IRB Information</TableCell>
                                        </TableRow>
                                        <FieldRow label="IRB Name" value={fda1572.irb_name} />
                                        <FieldRow label="IRB Address" value={fda1572.irb_address} />
                                        <FieldRow label="Study Sites" value={fda1572.study_sites} />
                                        <FieldRow label="Sub-Investigators" value={fda1572.sub_investigators} />
                                        <FieldRow label="Clinical Laboratories" value={fda1572.clinical_laboratories} />
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        </Box>

                        {/* ── Section 3: LTAA Research Intelligence ── */}
                        <Box className="report-section report-page-break">
                            <SectionTitle number="3" title="LTAA Research Intelligence" />
                            {ltaa && (ltaa.report || ltaa.ranked_targets || ltaa.stats || ltaa.disease || ltaa.domain) ? (
                                <>
                                    {/* Domain & Disease */}
                                    {(ltaa.disease || ltaa.domain) && (
                                        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                                            {ltaa.disease && <Chip label={`Disease: ${ltaa.disease}`} size="small" sx={{ fontWeight: 600, bgcolor: '#ecfdf5', color: '#065f46' }} />}
                                            {ltaa.domain && <Chip label={`Domain: ${ltaa.domain}`} size="small" sx={{ fontWeight: 600, bgcolor: '#eff6ff', color: '#1e40af' }} />}
                                        </Box>
                                    )}

                                    {/* Scientific Summary */}
                                    {ltaa.report?.summary && (
                                        <Paper elevation={0} sx={{ p: 2.5, mb: 3, bgcolor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 2 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#334155', mb: 1 }}>Scientific Summary</Typography>
                                            <Typography variant="body2" sx={{ color: '#475569', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                                                {ltaa.report.summary}
                                            </Typography>
                                        </Paper>
                                    )}

                                    {/* Ranked Targets Table */}
                                    {ltaa.ranked_targets?.length > 0 && (
                                        <Box sx={{ mb: 3 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#334155', mb: 1 }}>Ranked Therapeutic Targets</Typography>
                                            <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
                                                <Table size="small">
                                                    <TableHead>
                                                        <TableRow sx={{ bgcolor: '#f1f5f9' }}>
                                                            <TableCell sx={{ fontWeight: 700 }}>Target</TableCell>
                                                            <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                                                            <TableCell sx={{ fontWeight: 700 }} align="center">Score</TableCell>
                                                            <TableCell sx={{ fontWeight: 700 }} align="center">Mentions</TableCell>
                                                        </TableRow>
                                                    </TableHead>
                                                    <TableBody>
                                                        {ltaa.ranked_targets.map((t, i) => (
                                                            <TableRow key={i}>
                                                                <TableCell sx={{ fontWeight: 600 }}>{t.name}</TableCell>
                                                                <TableCell>
                                                                    <Chip label={t.type || 'Unknown'} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                                                                </TableCell>
                                                                <TableCell align="center" sx={{ fontWeight: 700, color: t.score >= 0.7 ? '#065f46' : '#92400e' }}>
                                                                    {typeof t.score === 'number' ? t.score.toFixed(2) : t.score}
                                                                </TableCell>
                                                                <TableCell align="center">{t.mentions || '-'}</TableCell>
                                                            </TableRow>
                                                        ))}
                                                    </TableBody>
                                                </Table>
                                            </TableContainer>
                                        </Box>
                                    )}

                                    {/* Target Justifications */}
                                    {(ltaa.report?.justifications?.length > 0 || ltaa.report?.targets?.length > 0) && (
                                        <Box sx={{ mb: 3 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#334155', mb: 1 }}>Target Justifications</Typography>
                                            {(ltaa.report.justifications || ltaa.report.targets || []).map((j, i) => (
                                                <Paper key={i} elevation={0} sx={{ p: 2, mb: 1.5, border: '1px solid #e2e8f0', borderRadius: 2 }}>
                                                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1e40af', mb: 0.5 }}>
                                                        {j.target}
                                                        {j.confidence_score && (
                                                            <Chip label={`Confidence: ${(j.confidence_score * 100).toFixed(0)}%`} size="small"
                                                                sx={{ ml: 1, fontSize: '0.65rem', fontWeight: 600, bgcolor: '#ecfdf5', color: '#065f46' }} />
                                                        )}
                                                    </Typography>
                                                    {j.biological_context && (
                                                        <Typography variant="body2" sx={{ color: '#475569', mb: 0.5 }}>
                                                            <strong>Biological Context:</strong> {j.biological_context}
                                                        </Typography>
                                                    )}
                                                    {j.disease_mechanism && (
                                                        <Typography variant="body2" sx={{ color: '#475569', mb: 0.5 }}>
                                                            <strong>Disease Mechanism:</strong> {j.disease_mechanism}
                                                        </Typography>
                                                    )}
                                                    {j.therapeutic_rationale && (
                                                        <Typography variant="body2" sx={{ color: '#475569' }}>
                                                            <strong>Therapeutic Rationale:</strong> {j.therapeutic_rationale}
                                                        </Typography>
                                                    )}
                                                </Paper>
                                            ))}
                                        </Box>
                                    )}

                                    {/* Analysis Stats */}
                                    {ltaa.stats && (
                                        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                            {ltaa.stats.pubmed_count != null && <Chip label={`PubMed Articles: ${ltaa.stats.pubmed_count}`} size="small" variant="outlined" />}
                                            {ltaa.stats.pdf_count != null && <Chip label={`PDF Documents: ${ltaa.stats.pdf_count}`} size="small" variant="outlined" />}
                                            {ltaa.stats.targets_found != null && <Chip label={`Targets Found: ${ltaa.stats.targets_found}`} size="small" variant="outlined" sx={{ fontWeight: 600 }} />}
                                            {ltaa.stats.papers_analyzed != null && <Chip label={`Papers Analyzed: ${ltaa.stats.papers_analyzed}`} size="small" variant="outlined" />}
                                            {ltaa.stats.entities_extracted != null && <Chip label={`Entities Extracted: ${ltaa.stats.entities_extracted}`} size="small" variant="outlined" />}
                                        </Box>
                                    )}

                                    {/* Show partial data message if incomplete */}
                                    {!ltaa.report?.summary && !ltaa.ranked_targets?.length && (
                                        <Paper elevation={0} sx={{ p: 2, bgcolor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 2, mt: 2 }}>
                                            <Typography variant="body2" sx={{ color: '#92400e', fontWeight: 600 }}>
                                                ⚠️ LTAA analysis is incomplete or still processing. Available data is shown above.
                                            </Typography>
                                        </Paper>
                                    )}
                                </>
                            ) : ltaa?.status === 'analyzing' ? (
                                <Paper elevation={0} sx={{ p: 3, bgcolor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 2, textAlign: 'center' }}>
                                    <Typography variant="body2" sx={{ color: '#1e40af', fontWeight: 600 }}>🔄 Analysis in Progress</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        LTAA research intelligence is currently being analyzed. This process may take several minutes. Please check back later for complete results.
                                    </Typography>
                                </Paper>
                            ) : (
                                <NotAvailable label="LTAA Research Intelligence" />
                            )}
                        </Box>

                        {/* ── Section 4: In Silico Drug Modeling ── */}
                        <Box className="report-section report-page-break">
                            <SectionTitle number="4" title="In Silico Drug Modeling" />
                            {insilico && (insilico.target_analysis || insilico.drugs || insilico.interactions || insilico.simulation) && !insilico.error ? (
                                <>
                                    {/* Target Analysis */}
                                    {insilico.target_analysis?.targets?.length > 0 && (
                                        <Box sx={{ mb: 3 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#334155', mb: 1 }}>Molecular Targets</Typography>
                                            {insilico.target_analysis.rationale && (
                                                <Typography variant="body2" sx={{ fontStyle: 'italic', color: '#475569', mb: 1.5 }}>
                                                    "{insilico.target_analysis.rationale}"
                                                </Typography>
                                            )}
                                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                                {insilico.target_analysis.targets.map((t, i) => (
                                                    <Chip key={i} label={t.canonical_name} size="small"
                                                        sx={{ fontWeight: 600, bgcolor: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' }} />
                                                ))}
                                            </Box>
                                        </Box>
                                    )}

                                    {/* Drug Profiles */}
                                    {insilico.drugs?.length > 0 && (
                                        <Box sx={{ mb: 3 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#334155', mb: 1 }}>Drug Profiles & ADMET</Typography>
                                            {insilico.drugs.map((item, idx) => (
                                                <Paper key={idx} elevation={0} sx={{ p: 2.5, mb: 2, border: '1px solid #e2e8f0', borderRadius: 2 }}>
                                                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#1e293b', mb: 0.5 }}>
                                                        {item.drug?.name || 'Unknown Drug'}
                                                    </Typography>
                                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                                        {[item.drug?.dose, item.drug?.unit, item.drug?.route, item.drug?.frequency].filter(Boolean).join(' | ')}
                                                    </Typography>

                                                    <Grid container spacing={2}>
                                                        {/* Chemical Properties */}
                                                        {item.chem && (
                                                            <Grid item xs={12} md={6}>
                                                                <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748b', display: 'block', mb: 1 }}>CHEMICAL PROPERTIES</Typography>
                                                                <TableContainer>
                                                                    <Table size="small">
                                                                        <TableBody>
                                                                            {item.chem.molecular_weight && <FieldRow label="Molecular Weight" value={`${item.chem.molecular_weight} g/mol`} />}
                                                                            {item.chem.logp != null && <FieldRow label="LogP" value={item.chem.logp} />}
                                                                            {item.chem.solubility && <FieldRow label="Solubility" value={item.chem.solubility} />}
                                                                            {item.chem.tpsa != null && <FieldRow label="TPSA" value={`${item.chem.tpsa} A^2`} />}
                                                                            {item.chem.smiles && <FieldRow label="SMILES" value={
                                                                                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>
                                                                                    {item.chem.smiles}
                                                                                </Typography>
                                                                            } />}
                                                                        </TableBody>
                                                                    </Table>
                                                                </TableContainer>
                                                            </Grid>
                                                        )}

                                                        {/* Toxicity */}
                                                        {item.tox && (
                                                            <Grid item xs={12} md={6}>
                                                                <Typography variant="caption" sx={{ fontWeight: 700, color: '#64748b', display: 'block', mb: 1 }}>TOXICITY PREDICTION</Typography>
                                                                <TableContainer>
                                                                    <Table size="small">
                                                                        <TableBody>
                                                                            <FieldRow label="Risk Level" value={
                                                                                <Chip
                                                                                    label={item.tox.status === 'high' || item.tox.risk_level === 'High' ? 'High Risk' : 'Low Risk'}
                                                                                    size="small"
                                                                                    sx={{
                                                                                        fontWeight: 700, fontSize: '0.7rem',
                                                                                        bgcolor: item.tox.status === 'high' || item.tox.risk_level === 'High' ? '#fee2e2' : '#dcfce7',
                                                                                        color: item.tox.status === 'high' || item.tox.risk_level === 'High' ? '#991b1b' : '#166534',
                                                                                    }}
                                                                                />
                                                                            } />
                                                                            {item.tox.ld50 && <FieldRow label="LD50" value={`${item.tox.ld50} mg/kg`} />}
                                                                            {item.tox.toxicity_class && <FieldRow label="Toxicity Class" value={item.tox.toxicity_class} />}
                                                                            {item.tox.organ_toxicity && <FieldRow label="Organ Toxicity" value={item.tox.organ_toxicity} />}
                                                                            {item.tox.mutagenicity && <FieldRow label="Mutagenicity" value={item.tox.mutagenicity} />}
                                                                            {item.tox.hepatotoxicity && <FieldRow label="Hepatotoxicity" value={item.tox.hepatotoxicity} />}
                                                                        </TableBody>
                                                                    </Table>
                                                                </TableContainer>
                                                            </Grid>
                                                        )}
                                                    </Grid>
                                                </Paper>
                                            ))}
                                        </Box>
                                    )}

                                    {/* Drug-Drug Interactions */}
                                    {insilico.interactions && (
                                        <Box sx={{ mb: 3 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#334155', mb: 1 }}>Drug-Drug Interactions</Typography>
                                            <Paper elevation={0} sx={{
                                                p: 2, border: '1px solid',
                                                borderColor: insilico.interactions.has_risk ? '#fecaca' : '#bbf7d0',
                                                borderRadius: 2,
                                                bgcolor: insilico.interactions.has_risk ? '#fef2f2' : '#f0fdf4'
                                            }}>
                                                <Typography variant="body2" sx={{
                                                    fontWeight: 600,
                                                    color: insilico.interactions.has_risk ? '#991b1b' : '#166534'
                                                }}>
                                                    {insilico.interactions.has_risk ? 'Critical Risks Identified' : 'Safety Profile Verified'}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    {insilico.interactions.summary || 'No significant contraindications found with standard baseline therapy.'}
                                                </Typography>
                                            </Paper>
                                        </Box>
                                    )}

                                    {/* PK Simulation Metrics */}
                                    {insilico.simulation?.metrics && (
                                        <Box sx={{ mb: 3 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#334155', mb: 1 }}>Pharmacokinetic Simulation</Typography>
                                            <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #e2e8f0', borderRadius: 2 }}>
                                                <Table size="small">
                                                    <TableBody>
                                                        <FieldRow label="Peak Plasma Concentration (Cmax)" value={`${insilico.simulation.metrics.c_max} mg/L`} />
                                                        <FieldRow label="Elimination Half-life" value={`${insilico.simulation.metrics.half_life} hrs`} />
                                                        <FieldRow label="Steady State Minimum (Css min)" value={`${insilico.simulation.metrics.c_min_ss} mg/L`} />
                                                        <FieldRow label="Model" value="1-Compartment Oral (First-order Absorption)" />
                                                    </TableBody>
                                                </Table>
                                            </TableContainer>
                                        </Box>
                                    )}

                                    {/* Show partial data message if incomplete */}
                                    {!insilico.drugs?.length && !insilico.target_analysis && !insilico.simulation && (
                                        <Paper elevation={0} sx={{ p: 2, bgcolor: '#fffbeb', border: '1px solid #fde68a', borderRadius: 2, mt: 2 }}>
                                            <Typography variant="body2" sx={{ color: '#92400e', fontWeight: 600 }}>
                                                ⚠️ In Silico analysis is incomplete or still processing. Available data is shown above.
                                            </Typography>
                                        </Paper>
                                    )}
                                </>
                            ) : insilico?.error ? (
                                <Paper elevation={0} sx={{ p: 3, bgcolor: '#fee2e2', border: '1px solid #fecaca', borderRadius: 2, textAlign: 'center' }}>
                                    <Typography variant="body2" sx={{ color: '#991b1b', fontWeight: 600 }}>❌ Analysis Error</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {insilico.error || 'An error occurred during In Silico drug modeling analysis.'}
                                    </Typography>
                                </Paper>
                            ) : (
                                <NotAvailable label="In Silico Drug Modeling" />
                            )}
                        </Box>

                        {/* ── Footer ── */}
                        <Divider sx={{ mt: 6, mb: 2 }} />
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                This report was auto-generated by the DrugTrial AI Platform.
                                All data is derived from automated extraction and computational analysis.
                                Clinical decisions should be verified by qualified personnel.
                            </Typography>
                        </Box>
                    </Box>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default TrialReportModal;
