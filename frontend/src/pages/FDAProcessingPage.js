import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import {
    CircularProgress,
    Typography,
    Box,
    Chip,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Tooltip
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import WarningIcon from '@mui/icons-material/Warning';
import DomainVerificationIcon from '@mui/icons-material/DomainVerification';
import InSilicoDashboard from '../components/InSilicoDashboard';
import './FDAProcessingPage.css';

const API_BASE = process.env.REACT_APP_API_URL || '';

function FDAProcessingPage() {
    const { documentId } = useParams(); // Wizard mode if present
    const navigate = useNavigate();

    const [documents, setDocuments] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [selectedDocument, setSelectedDocument] = useState(null);
    const [showFormViewer, setShowFormViewer] = useState(false);
    const [continuing, setContinuing] = useState(false);

    // Wizard Mode Effect
    useEffect(() => {
        if (documentId) {
            handleViewDocument(documentId);
        } else {
            loadDocuments();
        }
    }, [documentId]);

    const loadDocuments = async () => {
        try {
            const response = await axios.get(`${API_BASE}/api/fda/documents`);
            setDocuments(response.data.documents);
        } catch (error) {
            console.error('Error loading documents:', error);
            // Don't alert in wizard mode if list fails provided specific doc works
            if (!documentId) alert('Failed to load documents');
        }
    };

    const handleFileSelect = (event) => {
        const file = event.target.files[0];
        if (file && file.type === 'application/pdf') {
            setSelectedFile(file);
        } else {
            alert('Please select a PDF file');
        }
    };

    const [logs, setLogs] = useState([]);
    const logsEndRef = React.useRef(null);

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [logs]);

    const handleUpload = async () => {
        if (!selectedFile) {
            alert('Please select a file first');
            return;
        }

        setUploading(true);
        setLogs([]);
        setUploadProgress(0);

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            // Use fetch instead of axios for streaming support
            const response = await fetch(`${API_BASE}/api/fda/upload`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');

                // Process all complete lines
                buffer = lines.pop(); // Keep the last incomplete line in buffer

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);

                        if (data.type === 'log') {
                            setLogs(prev => [...prev, data.message]);
                        } else if (data.type === 'result') {
                            setLogs(prev => [...prev, "✅ Upload complete! Redirecting..."]);
                            // Wait a moment for user to see success
                            setTimeout(() => {
                                loadDocuments(); // Refresh list
                                handleViewDocument(data.payload.document_id); // Open viewer
                                setSelectedFile(null);
                                setUploading(false); // Stop uploading state (hides logs)
                            }, 1500);
                            return; // Stop processing stream
                        } else if (data.type === 'error') {
                            throw new Error(data.message);
                        }
                    } catch (e) {
                        console.error("Error parsing stream line:", line, e);
                    }
                }
            }

        } catch (error) {
            console.error('Error uploading file:', error);
            alert('Upload failed: ' + error.message);
            setUploading(false);
        }
    };

    const handleViewDocument = async (id) => {
        try {
            const response = await axios.get(`${API_BASE}/api/fda/forms/${id}`);
            setSelectedDocument(response.data);
            setShowFormViewer(true);
        } catch (error) {
            console.error('Error loading document:', error);
            alert('Failed to load document details');
        }
    };

    const handleDeleteDocument = async (id) => {
        if (!window.confirm('Are you sure you want to delete this document?')) {
            return;
        }

        try {
            await axios.delete(`${API_BASE}/api/fda/documents/${id}`);
            alert('Document deleted successfully');
            loadDocuments();
        } catch (error) {
            console.error('Error deleting document:', error);
            alert('Delete failed: ' + (error.response?.data?.detail || error.message));
        }
    };

    const getStatusBadge = (status) => {
        const badges = {
            extracted: { label: 'Extracted', className: 'status-extracted' },
            reviewed: { label: 'Reviewed', className: 'status-reviewed' },
            signed: { label: 'Signed', className: 'status-signed' },
        };
        const badge = badges[status] || { label: status, className: '' };
        return <span className={`status-badge ${badge.className}`}>{badge.label}</span>;
    };

    // Wizard: Continue Logic
    const handleContinueWizard = async () => {
        if (!selectedDocument || continuing) return;
        setContinuing(true);
        try {
            const res = await axios.post(`${API_BASE}/api/fda/documents/${selectedDocument.document.id}/create-trial`);
            navigate(`/trial/${res.data.trial_id}/criteria`);
        } catch (error) {
            console.error("Error creating trial:", error);
            alert("Failed to proceed: " + error.message);
        } finally {
            setContinuing(false);
        }
    };

    if (showFormViewer && selectedDocument) {
        return (
            <FDAFormViewer
                document={selectedDocument}
                onClose={() => {
                    // If in wizard mode, onClose shouldn't just go back to empty list, maybe go home?
                    // Or if documentId is present, maybe we don't allow closing?
                    // User said "no upload option only review and sign and move to next page"
                    if (documentId) {
                        // Wizard mode: Cannot close to list. 
                        // Maybe allow close to go back to upload?
                        navigate('/');
                    } else {
                        setShowFormViewer(false);
                        setSelectedDocument(null);
                        loadDocuments();
                    }
                }}
                isWizard={!!documentId}
                onContinue={handleContinueWizard}
                continuing={continuing}
            />
        );
    }

    // If we have a documentId but no document loaded yet, show loader
    if (documentId && !selectedDocument) {
        return <div style={{ padding: 20 }}>Loading document...</div>;
    }

    return (
        <div className="fda-processing-page">
            <h1>📄 FDA Form Processing</h1>

            {/* Upload Section */}
            <div className="upload-section">
                <h2>Upload Protocol PDF</h2>
                <div className="upload-area">
                    <input
                        type="file"
                        accept=".pdf"
                        onChange={handleFileSelect}
                        disabled={uploading}
                        id="file-input"
                    />
                    <label htmlFor="file-input" className="file-label">
                        {selectedFile ? selectedFile.name : 'Choose PDF file...'}
                    </label>
                    <button
                        onClick={handleUpload}
                        disabled={!selectedFile || uploading}
                        className="upload-button"
                    >
                        {uploading ? "Processing..." : "Start Extraction"}
                    </button>
                </div>

                {uploading && (
                    <div className="upload-status">
                        <div className="progress-bar-container">
                            <CircularProgress size={24} sx={{ mr: 2 }} />
                            <Typography variant="body2" color="textSecondary">
                                {logs.length > 0 ? logs[logs.length - 1] : "Initializing..."}
                            </Typography>
                        </div>

                        <div className="logs-container" style={{
                            marginTop: '15px',
                            padding: '10px',
                            background: '#f5f5f5',
                            borderRadius: '4px',
                            maxHeight: '150px',
                            overflowY: 'auto',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem'
                        }}>
                            {logs.map((log, index) => (
                                <div key={index} className="log-entry">
                                    <span style={{ color: '#888', marginRight: '8px' }}>
                                        {new Date().toLocaleTimeString().split(' ')[0]}
                                    </span>
                                    {log}
                                </div>
                            ))}
                            <div ref={logsEndRef} />
                        </div>
                    </div>
                )}
            </div>

            {/* Documents List */}
            <div className="documents-section">
                <h2>Processed Documents ({documents.length})</h2>
                <table className="documents-table">
                    <thead>
                        <tr>
                            <th>Filename</th>
                            <th>Upload Date</th>
                            <th>Status</th>
                            <th>Reviewed By</th>
                            <th>Signed By</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {documents.map((doc) => (
                            <tr key={doc.id}>
                                <td>{doc.filename}</td>
                                <td>{new Date(doc.upload_date).toLocaleString()}</td>
                                <td>{getStatusBadge(doc.status)}</td>
                                <td>{doc.reviewed_by || '-'}</td>
                                <td>{doc.signed_by || '-'}</td>
                                <td>
                                    <button
                                        onClick={() => handleViewDocument(doc.id)}
                                        className="action-button view"
                                    >
                                        View/Edit
                                    </button>
                                    {doc.status === 'extracted' && (
                                        <button
                                            onClick={() => handleDeleteDocument(doc.id)}
                                            className="action-button delete"
                                        >
                                            Delete
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// Form Viewer Component
function FDAFormViewer({ document, onClose, isWizard, onContinue, continuing }) {
    const [activeTab, setActiveTab] = useState('1571');
    const [formData, setFormData] = useState({
        1571: document.fda_1571,
        1572: document.fda_1572,
    });
    const [showSignModal, setShowSignModal] = useState(false);
    const [saving, setSaving] = useState(false);
    // Refresh status from props if possible, or track locally?
    // Using simple local tracking for immediate UI updates
    const [localStatus, setLocalStatus] = useState(document.document.status);
    const [localSignedBy, setLocalSignedBy] = useState(document.document.signed_by);
    const [localReviewedBy, setLocalReviewedBy] = useState(document.document.reviewed_by);
    const [intelData, setIntelData] = useState(null);
    const [loadingIntel, setLoadingIntel] = useState(false);

    const isEditable = localStatus === 'extracted';
    // Allow re-review if needed? Usually only if extracted.
    const isReviewable = localStatus === 'extracted';
    const isSignable = localStatus === 'reviewed';
    const isSigned = localStatus === 'signed';

    const handleFieldChange = (formType, field, value) => {
        setFormData({
            ...formData,
            [formType]: {
                ...formData[formType],
                [field]: value,
            },
        });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await axios.put(`${API_BASE}/api/fda/forms/${document.document.id}`, {
                form_type: activeTab,
                updates: formData[activeTab],
            });
            alert('Changes saved successfully');
        } catch (error) {
            alert('Save failed: ' + (error.response?.data?.detail || error.message));
        } finally {
            setSaving(false);
        }
    };

    const handleReview = async () => {
        const reviewerName = prompt('Enter your name to mark as reviewed:');
        if (!reviewerName) return;

        try {
            await axios.post(`${API_BASE}/api/fda/forms/${document.document.id}/review`, {
                reviewed_by: reviewerName,
            });
            alert('Document marked as reviewed');
            setLocalStatus('reviewed');
            setLocalReviewedBy(reviewerName);
        } catch (error) {
            alert('Review failed: ' + (error.response?.data?.detail || error.message));
        }
    };

    const fetchIntel = async () => {
        const disease = formData['1571'].indication;
        if (!disease || disease === "Unknown") return;

        setLoadingIntel(true);
        try {
            const response = await axios.get(`${API_BASE}/api/ltaa/report/${encodeURIComponent(disease)}`);
            setIntelData(response.data);
        } catch (error) {
            console.error("Error fetching Research Intel:", error);
        } finally {
            setLoadingIntel(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'Intel' && !intelData) {
            fetchIntel();
        }
    }, [activeTab]);

    const handleSign = async (signatureData) => {
        try {
            await axios.post(`${API_BASE}/api/fda/forms/${document.document.id}/sign`, signatureData);
            alert('Document signed successfully');
            setShowSignModal(false);
            setLocalStatus('signed');
            setLocalSignedBy(signatureData.signer_name);
        } catch (error) {
            alert('Signing failed: ' + (error.response?.data?.detail || error.message));
        }
    };

    // In Wizard Mode, we want to allow continue IF signed (or reviewed?)
    // User requested "only review and sign and move to next page"
    // So "Continue to Criteria" should appear after signing.
    const showContinue = isWizard && (isSigned || localStatus === 'signed');

    const renderField = (label, field, value, formType) => {
        const isNull = value === null || value === undefined || value === '';

        return (
            <div className="form-field" key={field}>
                <label>{label}</label>
                {isEditable ? (
                    <input
                        type="text"
                        value={value || ''}
                        onChange={(e) => handleFieldChange(formType, field, e.target.value)}
                        className={isNull ? 'null-field' : ''}
                        placeholder={isNull ? 'Not extracted' : ''}
                    />
                ) : (
                    <div className={`field-value ${isNull ? 'null-field' : ''}`}>
                        {isNull ? 'Not extracted' : value}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="form-viewer">
            <div className="form-viewer-header">
                <h2>FDA Forms - {document.document.filename}</h2>
                {/* In wizard, we might hide close or change it to 'Back to Upload' */}
                {!isWizard && <button onClick={onClose} className="close-button">✕</button>}
            </div>

            <div className="document-status">
                <span>Status: <strong>{localStatus}</strong></span>
                {localReviewedBy && (
                    <span>Reviewed by: <strong>{localReviewedBy}</strong></span>
                )}
                {localSignedBy && (
                    <span>Signed by: <strong>{localSignedBy}</strong></span>
                )}
            </div>

            <div className="form-tabs">
                <button
                    className={activeTab === '1571' ? 'active' : ''}
                    onClick={() => setActiveTab('1571')}
                >
                    FDA Form 1571 (IND)
                </button>
                <button
                    className={activeTab === '1572' ? 'active' : ''}
                    onClick={() => setActiveTab('1572')}
                >
                    FDA Form 1572 (Investigator)
                </button>
                <button
                    className={activeTab === 'Intel' ? 'active' : ''}
                    onClick={() => setActiveTab('Intel')}
                    style={{ background: '#e3f2fd', color: '#1565c0', fontWeight: 'bold' }}
                >
                    🧬 Research Intelligence (AI)
                </button>
                <button
                    className={activeTab === 'InSilico' ? 'active' : ''}
                    onClick={() => setActiveTab('InSilico')}
                    style={{ background: '#f0f4f8', color: '#24292e', fontWeight: 'bold' }}
                >
                    🧪 In Silico Modeling (NEW)
                </button>
            </div>

            <div className="form-content">
                <div style={{ display: activeTab === '1571' ? 'block' : 'none' }}>
                    <div className="form-section">
                        <h3>Drug Information</h3>
                        {renderField('Drug Name', 'drug_name', formData['1571'].drug_name, '1571')}
                        {renderField('Dosage Form', 'dosage_form', formData['1571'].dosage_form, '1571')}
                        {renderField('Route of Administration', 'route_of_administration', formData['1571'].route_of_administration, '1571')}
                        {renderField('Indication', 'indication', formData['1571'].indication, '1571')}

                        <h3>Study Information</h3>
                        {renderField('Study Phase', 'study_phase', formData['1571'].study_phase, '1571')}
                        {renderField('Protocol Title', 'protocol_title', formData['1571'].protocol_title, '1571')}
                        {renderField('Protocol Number', 'protocol_number', formData['1571'].protocol_number, '1571')}

                        <h3>Sponsor Information</h3>
                        {renderField('Sponsor Name', 'sponsor_name', formData['1571'].sponsor_name, '1571')}
                        {renderField('Sponsor Address', 'sponsor_address', formData['1571'].sponsor_address, '1571')}
                        {renderField('Contact Person', 'contact_person', formData['1571'].contact_person, '1571')}
                        {renderField('Contact Phone', 'contact_phone', formData['1571'].contact_phone, '1571')}
                        {renderField('Contact Email', 'contact_email', formData['1571'].contact_email, '1571')}
                    </div>
                </div>

                <div style={{ display: activeTab === '1572' ? 'block' : 'none' }}>
                    <div className="form-section">
                        <h3>Protocol Identification</h3>
                        {renderField('Protocol Title', 'protocol_title', formData['1572'].protocol_title, '1572')}
                        {renderField('Protocol Number', 'protocol_number', formData['1572'].protocol_number, '1572')}

                        <h3>Investigator Information</h3>
                        {renderField('Investigator Name', 'investigator_name', formData['1572'].investigator_name, '1572')}
                        {renderField('Investigator Address', 'investigator_address', formData['1572'].investigator_address, '1572')}
                        {renderField('Phone', 'investigator_phone', formData['1572'].investigator_phone, '1572')}
                        {renderField('Email', 'investigator_email', formData['1572'].investigator_email, '1572')}

                        <h3>IRB Information</h3>
                        {renderField('IRB Name', 'irb_name', formData['1572'].irb_name, '1572')}
                        {renderField('IRB Address', 'irb_address', formData['1572'].irb_address, '1572')}
                    </div>
                </div>

                <div style={{ display: activeTab === 'Intel' ? 'block' : 'none' }}>
                    <div className="form-section intel-section">
                        {loadingIntel ? (
                            <div className="intel-loading">
                                <CircularProgress size={30} />
                                <Typography sx={{ mt: 2 }}>Analyzing Literature & Targets for <strong>{formData['1571'].indication}</strong>...</Typography>
                            </div>
                        ) : intelData ? (
                            <div className="intel-results">
                                {/* Analysis Header & Status */}
                                <div className="intel-header" style={{ marginBottom: '20px' }}>
                                    {intelData.status === 'analyzing' && (
                                        <div style={{ padding: '15px', backgroundColor: '#e3f2fd', borderRadius: '8px', marginBottom: '15px', display: 'flex', alignItems: 'center' }}>
                                            <CircularProgress size={20} sx={{ mr: 2 }} />
                                            <Typography variant="body2">
                                                <strong>Analysis in Progress:</strong> The agent is currently reading research papers.
                                                Please check back in 30-60 seconds.
                                            </Typography>
                                        </div>
                                    )}

                                    {/* Domain & Context Badges */}
                                    <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                        <Chip
                                            icon={<DomainVerificationIcon />}
                                            label={intelData.domain ? `Domain: ${intelData.domain.toUpperCase()}` : 'General Domain'}
                                            color="primary"
                                            variant="filled"
                                        />
                                        {intelData.stats?.document_types?.map((type, idx) => (
                                            <Chip
                                                key={idx}
                                                label={type.replace('_', ' ').toUpperCase()}
                                                variant="outlined"
                                                size="small"
                                            />
                                        ))}
                                    </Box>

                                    {/* Scientific Summary */}
                                    <div className="intel-report-summary">
                                        <h3>Scientific Justification</h3>
                                        <p>{intelData.report.summary}</p>
                                    </div>

                                    {/* Excluded Entities Accordion */}
                                    {intelData.excluded_entities && intelData.excluded_entities.total_excluded > 0 && (
                                        <Accordion variant="outlined" sx={{ mt: 2, mb: 3, borderColor: 'warning.light', '&:before': { display: 'none' } }}>
                                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                    <WarningIcon color="warning" fontSize="small" sx={{ mr: 1 }} />
                                                    <Typography variant="body2" color="text.secondary">
                                                        Filtered {intelData.excluded_entities.total_excluded} Non-Target Entities (Quality Control)
                                                    </Typography>
                                                </Box>
                                            </AccordionSummary>
                                            <AccordionDetails>
                                                <Typography variant="caption" display="block" sx={{ mb: 1, fontWeight: 'bold' }}>
                                                    Top Filtered Terms (Validation Failed):
                                                </Typography>
                                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                                    {intelData.excluded_entities.top_excluded.slice(0, 10).map((item, idx) => (
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
                                </div>

                                {/* Targets Table */}
                                <div className="intel-targets-list">
                                    <h3>Discovered Biological Targets</h3>
                                    <table className="intel-table">
                                        <thead>
                                            <tr>
                                                <th>Target/Gene</th>
                                                <th>Type</th>
                                                <th>Validation</th>
                                                <th>Score</th>
                                                <th>Top Citations</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {intelData.targets?.slice(0, 10).map((t, idx) => (
                                                <tr key={idx}>
                                                    <td className="target-name">
                                                        <div style={{ fontWeight: 'bold' }}>{t.name}</div>
                                                        {t.validation_source && (
                                                            <div style={{ fontSize: '0.75rem', color: '#666' }}>
                                                                {t.validation_source}: {t.validation_id || 'N/A'}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span className={`type-tag ${t.type?.toLowerCase().replace('/', '')}`}>
                                                            {t.type}
                                                        </span>
                                                    </td>
                                                    <td>
                                                        {t.validation_source ? (
                                                            <Tooltip title={`Validated via ${t.validation_source}`}>
                                                                <Chip
                                                                    icon={<VerifiedUserIcon style={{ fontSize: 14 }} />}
                                                                    label="Verified"
                                                                    size="small"
                                                                    color="success"
                                                                    variant="outlined"
                                                                    style={{ height: 24, fontSize: '0.75rem' }}
                                                                />
                                                            </Tooltip>
                                                        ) : (
                                                            <Chip label="Unverified" size="small" variant="outlined" style={{ height: 24, fontSize: '0.75rem' }} />
                                                        )}
                                                    </td>
                                                    <td className="score-cell">
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                            <span style={{ marginRight: '8px' }}>{Number(t.score).toFixed(1)}</span>
                                                            <div style={{ width: '50px', height: '6px', background: '#eee', borderRadius: '3px' }}>
                                                                <div style={{ width: `${Math.min(t.score * 10, 100)}%`, height: '100%', background: '#1976d2', borderRadius: '3px' }}></div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="citation-cell">
                                                        {t.citations?.slice(0, 2).map((c, cidx) => (
                                                            <div key={cidx} className="citation-snippet">
                                                                <small>
                                                                    {c.source.startsWith('http') ? '🌐 PubMed' : '📄 ' + c.source}
                                                                    {c.page > 0 && ` (Page ${c.page})`}
                                                                </small>
                                                                <p>"{c.context?.substring(0, 100)}..."</p>
                                                            </div>
                                                        ))}
                                                    </td>
                                                </tr>
                                            ))}
                                            {(!intelData.targets || intelData.targets.length === 0) && (
                                                <tr>
                                                    <td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#888' }}>
                                                        No high-confidence targets found yet.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ) : (
                            <div className="intel-empty">
                                <Typography gutterBottom>
                                    No research intelligence available for indication: <strong>{formData['1571'].indication || "Unknown"}</strong>
                                </Typography>
                                <Typography variant="caption" display="block" color="textSecondary" sx={{ mb: 2 }}>
                                    Ensure the Indication field in FDA Form 1571 is correctly filled.
                                </Typography>
                                <button onClick={fetchIntel} className="action-button">Retry Analysis</button>
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: activeTab === 'InSilico' ? 'block' : 'none' }}>
                    <div className="form-section">
                        <InSilicoDashboard
                            trialId={document.document.id}
                            indication={formData['1571'].indication}
                        />
                    </div>
                </div>
            </div>

            <div className="form-actions">
                {isEditable && (
                    <>
                        <button onClick={handleSave} disabled={saving} className="save-button">
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                        <button onClick={handleReview} className="review-button">
                            Mark as Reviewed
                        </button>
                    </>
                )}
                {isSignable && (
                    <button onClick={() => setShowSignModal(true)} className="sign-button">
                        Sign Form
                    </button>
                )}

                {/* Wizard Continue Button */}
                {showContinue && (
                    <button
                        onClick={onContinue}
                        className="save-button"
                        disabled={continuing}
                        style={{
                            backgroundColor: continuing ? '#9e9e9e' : '#2e7d32',
                            marginLeft: 'auto',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}
                    >
                        {continuing ? (
                            <>
                                <CircularProgress size={16} color="inherit" />
                                Processing...
                            </>
                        ) : (
                            'Continue to Criteria →'
                        )}
                    </button>
                )}
            </div>

            {showSignModal && (
                <SignatureModal
                    onSign={handleSign}
                    onCancel={() => setShowSignModal(false)}
                />
            )}
        </div>
    );
}

// Signature Modal Component
function SignatureModal({ onSign, onCancel }) {
    const [signerName, setSignerName] = useState('');
    const [signerRole, setSignerRole] = useState('');
    const [agreed, setAgreed] = useState(false);

    const handleSubmit = () => {
        if (!signerName || !signerRole || !agreed) {
            alert('Please fill all fields and agree to the certification');
            return;
        }

        onSign({
            signer_name: signerName,
            signer_role: signerRole,
        });
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h3>E-Signature</h3>
                <p className="warning">⚠️ Once signed, this form cannot be edited</p>

                <div className="form-field">
                    <label>Your Name *</label>
                    <input
                        type="text"
                        value={signerName}
                        onChange={(e) => setSignerName(e.target.value)}
                        placeholder="Enter your full name"
                    />
                </div>

                <div className="form-field">
                    <label>Your Role/Title *</label>
                    <input
                        type="text"
                        value={signerRole}
                        onChange={(e) => setSignerRole(e.target.value)}
                        placeholder="e.g., Principal Investigator"
                    />
                </div>

                <div className="checkbox-field">
                    <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                        id="agree-checkbox"
                    />
                    <label htmlFor="agree-checkbox">
                        I certify that the information in this form is accurate and complete
                    </label>
                </div>

                <div className="modal-actions">
                    <button onClick={handleSubmit} className="sign-button" disabled={!agreed}>
                        Sign Document
                    </button>
                    <button onClick={onCancel} className="cancel-button">
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

export default FDAProcessingPage;

