import React, { useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, TextField, Typography, FormControlLabel, Checkbox, Box
} from '@mui/material';

const SignatureModal = ({ open, onClose, onSubmit }) => {
    const [name, setName] = useState('');
    const [role, setRole] = useState('');
    const [agreed, setAgreed] = useState(false);

    const handleSubmit = () => {
        if (!name || !role || !agreed) return;
        onSubmit({
            signer_name: name,
            signer_role: role,
            timestamp: new Date().toISOString()
        });
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Electronic Signature</DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    <Typography variant="body2" color="textSecondary">
                        By signing this document, you certify that the information provided is accurate and complete to the best of your knowledge.
                    </Typography>

                    <TextField
                        label="Full Name"
                        fullWidth
                        value={name}
                        onChange={e => setName(e.target.value)}
                    />
                    <TextField
                        label="Role / Title"
                        fullWidth
                        value={role}
                        onChange={e => setRole(e.target.value)}
                    />

                    <FormControlLabel
                        control={<Checkbox checked={agreed} onChange={e => setAgreed(e.target.checked)} />}
                        label="I understand that signing this document locks it from further editing."
                    />
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={handleSubmit}
                    disabled={!name || !role || !agreed}
                >
                    Sign Document
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SignatureModal;
