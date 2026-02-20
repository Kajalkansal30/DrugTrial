import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box,
    Paper,
    TextField,
    Button,
    Typography,
    Alert,
    Container,
    InputAdornment,
    IconButton
} from '@mui/material';
import { Visibility, VisibilityOff, Lock, Person } from '@mui/icons-material';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function LoginPage() {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const response = await axios.post(`${API_URL}/api/auth/login`, {
                username,
                password
            });

            // Store token and user info in localStorage
            localStorage.setItem('auth_token', response.data.token);
            localStorage.setItem('user', JSON.stringify(response.data.user));

            // Redirect to home/dashboard
            navigate('/');

        } catch (err) {
            console.error('Login error:', err);
            setError(err.response?.data?.error || 'Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                py: 4
            }}
        >
            <Container maxWidth="sm">
                <Paper
                    elevation={24}
                    sx={{
                        p: 4,
                        borderRadius: 3
                    }}
                >
                    <Box sx={{ textAlign: 'center', mb: 4 }}>
                        <Typography variant="h4" gutterBottom fontWeight="bold">
                            DrugTrial Automation
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            AI-Powered Clinical Trial Management System
                        </Typography>
                    </Box>

                    {error && (
                        <Alert severity="error" sx={{ mb: 3 }}>
                            {error}
                        </Alert>
                    )}

                    <form onSubmit={handleLogin}>
                        <TextField
                            fullWidth
                            label="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            margin="normal"
                            autoFocus
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Person />
                                    </InputAdornment>
                                ),
                            }}
                        />

                        <TextField
                            fullWidth
                            label="Password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            margin="normal"
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <Lock />
                                    </InputAdornment>
                                ),
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton
                                            onClick={() => setShowPassword(!showPassword)}
                                            edge="end"
                                        >
                                            {showPassword ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </InputAdornment>
                                ),
                            }}
                        />

                        <Button
                            type="submit"
                            fullWidth
                            variant="contained"
                            size="large"
                            disabled={loading}
                            sx={{
                                mt: 3,
                                mb: 2,
                                py: 1.5,
                                fontSize: '1.1rem',
                                background: 'linear-gradient(45deg, #667eea 30%, #764ba2 90%)',
                                '&:hover': {
                                    background: 'linear-gradient(45deg, #764ba2 30%, #667eea 90%)',
                                }
                            }}
                        >
                            {loading ? 'Logging in...' : 'Sign In'}
                        </Button>
                    </form>

                    <Box sx={{ mt: 4, p: 2, bgcolor: 'grey.100', borderRadius: 2 }}>
                        <Typography variant="caption" display="block" gutterBottom fontWeight="bold">
                            Demo Credentials:
                        </Typography>
                        <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                            Username: admin@veersa
                        </Typography>
                        <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                            Password: password123
                        </Typography>
                        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                            Other users: user@veersa, admin@dndi, user@clintech
                        </Typography>
                        <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 1 }}>
                            PI accounts: pi_dr_smith, pi_dr_jones, pi_dr_williams
                        </Typography>
                    </Box>
                </Paper>
            </Container>
        </Box>
    );
}

export default LoginPage;
