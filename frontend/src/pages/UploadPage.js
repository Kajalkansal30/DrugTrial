import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Typography, Button, Paper, Alert, CircularProgress, LinearProgress } from '@mui/material';
import { CloudUpload } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';

const API_URL = import.meta.env.VITE_API_URL || '';

const UploadPage = ({ onUploadSuccess }) => {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [logs, setLogs] = useState([]);
    const [progress, setProgress] = useState(0);
    const navigate = useNavigate();
    const logsEndRef = useRef(null);
    const pollingRef = useRef(null);

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => { scrollToBottom(); }, [logs]);

    useEffect(() => {
        return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
    }, []);

    const addLog = useCallback((msg) => {
        setLogs(prev => [...prev, msg]);
    }, []);

    const pollStatus = useCallback((docId) => {
        let attempts = 0;
        pollingRef.current = setInterval(async () => {
            attempts++;
            try {
                const resp = await apiClient.get(`/api/fda/status/${docId}`);
                const data = resp.data;

                setProgress(data.progress || 0);

                const newLogs = data.logs || [];
                if (newLogs.length > 0) {
                    setLogs(prev => {
                        const lastKnown = prev[prev.length - 1];
                        const newEntries = [];
                        let foundLast = !lastKnown;
                        for (const l of newLogs) {
                            if (foundLast) { newEntries.push(l); }
                            else if (l === lastKnown) { foundLast = true; }
                        }
                        if (!foundLast && newLogs.length > prev.length) {
                            return newLogs;
                        }
                        return newEntries.length > 0 ? [...prev, ...newEntries] : prev;
                    });
                }

                if (data.step === 'done') {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    addLog("✅ Processing complete! Redirecting...");
                    setProgress(100);
                    if (onUploadSuccess) onUploadSuccess({
                        document_id: data.document_id || docId,
                        trial_id: data.trial_id,
                        trial_db_id: data.trial_db_id,
                    });
                    setTimeout(() => navigate(`/process-fda/${data.document_id || docId}`), 1200);
                    return;
                }

                if (data.step === 'error') {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    setError("Processing failed. Please try again.");
                    setUploading(false);
                    return;
                }

                if (attempts > 120) {
                    clearInterval(pollingRef.current);
                    pollingRef.current = null;
                    setError("Processing is taking too long. Please check the documents list.");
                    setUploading(false);
                }
            } catch (_) { /* network blip, keep polling */ }
        }, 3000);
    }, [navigate, onUploadSuccess, addLog]);

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        setError(null);
        setLogs([]);
        setProgress(0);

        const formData = new FormData();
        formData.append('file', file);

        try {
            addLog(`📤 Uploading ${file.name}...`);
            const response = await apiClient.post('/api/fda/upload', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });

            const data = response.data;

            if (!data.document_id) {
                throw new Error("No document_id returned from server");
            }

            setProgress(5);
            addLog("✅ Upload received — processing started...");
            pollStatus(data.document_id);

        } catch (err) {
            setError(err.message || "Upload failed");
            setUploading(false);
        }
    };

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
        setError(null);
    };

    return (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h5" gutterBottom>Step 1: Protocol Upload</Typography>
            <Typography variant="body1" color="textSecondary" sx={{ mb: 4 }}>
                Select a clinical trial protocol PDF to begin the automated extraction workflow.
            </Typography>

            <Box
                sx={{
                    border: '2px dashed #ccc', p: 6, mb: 4, borderRadius: 2,
                    cursor: 'pointer', '&:hover': { bgcolor: '#fafafa' }
                }}
                onClick={() => document.getElementById('file-input').click()}
            >
                <input id="file-input" type="file" accept=".pdf" hidden onChange={handleFileChange} />
                <CloudUpload sx={{ fontSize: 48, color: '#1976d2', mb: 2 }} />
                <Typography>{file ? file.name : "Click to select protocol PDF"}</Typography>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {uploading && (
                <Box sx={{ mt: 3, textAlign: 'left' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                        <CircularProgress size={20} sx={{ mr: 2 }} />
                        <Typography variant="body2" color="textSecondary" sx={{ flex: 1 }}>
                            {logs.length > 0 ? logs[logs.length - 1] : "Initializing..."}
                        </Typography>
                        <Typography variant="body2" color="primary" sx={{ ml: 2, fontWeight: 600 }}>
                            {progress}%
                        </Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={progress} sx={{ mb: 2, height: 8, borderRadius: 4 }} />

                    <Box sx={{
                        maxHeight: '150px', overflowY: 'auto', bgcolor: '#f5f5f5',
                        p: 1.5, borderRadius: 1, fontSize: '0.85rem', fontFamily: 'monospace'
                    }}>
                        {logs.map((log, index) => (
                            <div key={index} style={{ marginBottom: '4px' }}>
                                <span style={{ color: '#888', marginRight: '8px' }}>
                                    {new Date().toLocaleTimeString().split(' ')[0]}
                                </span>
                                {log}
                            </div>
                        ))}
                        <div ref={logsEndRef} />
                    </Box>
                </Box>
            )}

            {!uploading && (
                <Button
                    variant="contained" size="large" disabled={!file}
                    onClick={handleUpload} startIcon={<CloudUpload />}
                    sx={{ mt: 2 }}
                >
                    Start Extraction
                </Button>
            )}
        </Paper>
    );
};

export default UploadPage;
