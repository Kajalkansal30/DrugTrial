
import React, { useState } from 'react';
import {
    Box,
    Button,
    Typography,
    Paper,
    LinearProgress,
    Alert,
    Card,
    CardContent
} from '@mui/material';
import { CloudUpload as UploadIcon } from '@mui/icons-material';
import axios from 'axios';

const DocumentUpload = ({ onUploadSuccess, apiUrl }) => {
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);
    const [stats, setStats] = useState(null);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
        setError(null);
    };

    const handleUpload = async () => {
        if (!file) {
            setError("Please select a file first.");
            return;
        }

        setUploading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await axios.post(`${apiUrl}/api/trials/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });

            setStats(response.data);
            if (onUploadSuccess) {
                onUploadSuccess(response.data);
            }
        } catch (err) {
            console.error("Upload error:", err);
            setError(err.response?.data?.detail || "Failed to upload and process document.");
        } finally {
            setUploading(false);
        }
    };

    return (
        <Card sx={{ mb: 4 }}>
            <CardContent>
                <Typography variant="h6" gutterBottom>
                    Protocol Analysis Workflow
                </Typography>
                <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>
                    Upload a clinical trial protocol (PDF) to automatically extract eligibility criteria and screen patients.
                </Typography>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <Box sx={{ border: '2px dashed #ccc', p: 3, textAlign: 'center', borderRadius: 2, mb: 2 }}>
                    <input
                        accept="application/pdf"
                        style={{ display: 'none' }}
                        id="protocol-file-upload"
                        type="file"
                        onChange={handleFileChange}
                    />
                    <label htmlFor="protocol-file-upload">
                        <Button
                            variant="outlined"
                            component="span"
                            startIcon={<UploadIcon />}
                            sx={{ mb: 1 }}
                        >
                            Select Protocol PDF
                        </Button>
                    </label>
                    <Typography variant="body2">
                        {file ? file.name : "No file selected"}
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <Button
                        variant="contained"
                        onClick={handleUpload}
                        disabled={uploading || !file}
                        color="primary"
                    >
                        {uploading ? "Processing..." : "Extract Criteria"}
                    </Button>

                    {uploading && (
                        <Box sx={{ flexGrow: 1 }}>
                            <LinearProgress />
                            <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                                Extracting medical entities and screening rules using SciSpacy...
                            </Typography>
                        </Box>
                    )}
                </Box>

                {stats && !uploading && (
                    <Alert severity="success" sx={{ mt: 2 }}>
                        Successfully extracted <strong>{stats.criteria_count}</strong> criteria from protocol: <em>{stats.title}</em>
                    </Alert>
                )}
            </CardContent>
        </Card>
    );
};

export default DocumentUpload;
