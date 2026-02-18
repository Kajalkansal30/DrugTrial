import React, { useState } from 'react';
import { Box, Typography, Button, Paper, Alert, CircularProgress } from '@mui/material';
import { CloudUpload } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

const UploadPage = ({ onUploadSuccess }) => {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [logs, setLogs] = useState([]);
    const navigate = useNavigate();
    const logsEndRef = React.useRef(null);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
    };

    const scrollToBottom = () => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    React.useEffect(() => {
        scrollToBottom();
    }, [logs]);

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        setError(null);
        setLogs([]);

        const formData = new FormData();
        formData.append('file', file);
        const API_URL = process.env.REACT_APP_API_URL || '';

        try {
            const response = await fetch(`${API_URL}/api/fda/upload`, {
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
            let gotResult = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (!line.trim()) continue;
                    let data;
                    try {
                        data = JSON.parse(line);
                    } catch (parseErr) {
                        console.warn("Skipping unparseable stream line:", line);
                        continue;
                    }

                    if (data.type === 'log') {
                        setLogs(prev => [...prev, data.message]);
                    } else if (data.type === 'result') {
                        gotResult = true;
                        setLogs(prev => [...prev, "✅ Upload complete! Redirecting..."]);
                        if (onUploadSuccess) onUploadSuccess(data.payload);
                        setTimeout(() => {
                            navigate(`/process-fda/${data.payload.document_id}`);
                        }, 1000);
                        return;
                    } else if (data.type === 'error') {
                        throw new Error(data.message);
                    }
                }
            }

            // Stream ended without a result event -- likely proxy cut the connection.
            // Fall through to the recovery check below.
            if (!gotResult) {
                throw new Error("Stream ended unexpectedly. Checking if upload succeeded...");
            }
        } catch (err) {
            // Stream may have broken due to proxy timeout, but the backend might have
            // finished processing. Poll the documents list to check.
            setLogs(prev => [...prev, "🔄 Verifying upload status..."]);
            const maxAttempts = 6;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                await new Promise(r => setTimeout(r, 5000));
                try {
                    const checkResp = await fetch(`${API_URL}/api/fda/documents`);
                    if (checkResp.ok) {
                        const docsResp = await checkResp.json();
                        const docsList = docsResp.documents || docsResp;
                        const recent = (Array.isArray(docsList) ? docsList : []).find(d =>
                            d.filename === file.name &&
                            new Date(d.processed_at || d.upload_date) > new Date(Date.now() - 300000)
                        );
                        if (recent) {
                            setLogs(prev => [...prev, "✅ Upload complete! Redirecting..."]);
                            if (onUploadSuccess) onUploadSuccess({ document_id: recent.id, ...recent });
                            setTimeout(() => navigate(`/process-fda/${recent.id}`), 1000);
                            return;
                        }
                    }
                } catch (_) { /* retry */ }
                setLogs(prev => [...prev, `⏳ Still processing... (attempt ${attempt + 1}/${maxAttempts})`]);
            }

            setError("Upload timed out. Please refresh and check if the document appears in the list.");
            setUploading(false);
        }
    };

    return (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="h5" gutterBottom>Step 1: Protocol Upload</Typography>
            <Typography variant="body1" color="textSecondary" sx={{ mb: 4 }}>
                Select a clinical trial protocol PDF to begin the automated extraction workflow.
            </Typography>

            <Box
                sx={{
                    border: '2px dashed #ccc',
                    p: 6,
                    mb: 4,
                    borderRadius: 2,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: '#fafafa' }
                }}
                onClick={() => document.getElementById('file-input').click()}
            >
                <input
                    id="file-input"
                    type="file"
                    hidden
                    onChange={handleFileChange}
                />
                <CloudUpload sx={{ fontSize: 48, color: '#1976d2', mb: 2 }} />
                <Typography>{file ? file.name : "Click to select protocol PDF"}</Typography>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

            {uploading && (
                <Box sx={{ mt: 3, textAlign: 'left' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                        <CircularProgress size={20} sx={{ mr: 2 }} />
                        <Typography variant="body2" color="textSecondary">
                            {logs.length > 0 ? logs[logs.length - 1] : "Initializing..."}
                        </Typography>
                    </Box>

                    <Box sx={{
                        maxHeight: '150px',
                        overflowY: 'auto',
                        bgcolor: '#f5f5f5',
                        p: 1.5,
                        borderRadius: 1,
                        fontSize: '0.85rem',
                        fontFamily: 'monospace'
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
                    variant="contained"
                    size="large"
                    disabled={!file}
                    onClick={handleUpload}
                    startIcon={<CloudUpload />}
                    sx={{ mt: 2 }}
                >
                    Start Extraction
                </Button>
            )}
        </Paper>
    );
};

export default UploadPage;
