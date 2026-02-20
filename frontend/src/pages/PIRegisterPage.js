import React, { useState } from 'react';
import {
    Container,
    Paper,
    Typography,
    TextField,
    Button,
    Box,
    Alert,
    Grid,
    Link
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import apiClient from '../utils/apiClient';

const PIRegisterPage = () => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        confirmPassword: '',
        email: '',
        fullName: '',
        licenseNumber: '',
        specialization: '',
        institution: '',
        address: '',
        phone: '',
        bio: ''
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        // Validation
        if (!formData.username || !formData.password || !formData.email || !formData.fullName) {
            setError('Please fill in all required fields');
            return;
        }

        if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (formData.password.length < 8) {
            setError('Password must be at least 8 characters long');
            return;
        }

        setLoading(true);

        try {
            const response = await apiClient.post('/pi/register', {
                username: formData.username,
                password: formData.password,
                email: formData.email,
                fullName: formData.fullName,
                licenseNumber: formData.licenseNumber,
                specialization: formData.specialization,
                institution: formData.institution,
                address: formData.address,
                phone: formData.phone,
                bio: formData.bio
            });

            // Store token
            localStorage.setItem('token', response.data.token);

            // Redirect to PI dashboard
            navigate('/pi');
        } catch (err) {
            console.error('Registration error:', err);
            setError(err.response?.data?.error || 'Registration failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Container maxWidth="md" sx={{ mt: 8, mb: 4 }}>
            <Paper elevation={3} sx={{ p: 4 }}>
                <Box textAlign="center" mb={3}>
                    <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
                        Principal Investigator Registration
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Register to receive and review clinical trial submissions
                    </Typography>
                </Box>

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <form onSubmit={handleSubmit}>
                    <Grid container spacing={2}>
                        {/* Account Information */}
                        <Grid item xs={12}>
                            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                                Account Information
                            </Typography>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                required
                                label="Username"
                                name="username"
                                value={formData.username}
                                onChange={handleChange}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                required
                                type="email"
                                label="Email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                required
                                type="password"
                                label="Password"
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                required
                                type="password"
                                label="Confirm Password"
                                name="confirmPassword"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                            />
                        </Grid>

                        {/* Professional Information */}
                        <Grid item xs={12}>
                            <Typography variant="h6" sx={{ fontWeight: 600, mt: 2, mb: 1 }}>
                                Professional Information
                            </Typography>
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                fullWidth
                                required
                                label="Full Name"
                                name="fullName"
                                value={formData.fullName}
                                onChange={handleChange}
                                placeholder="Dr. John Smith"
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Medical License Number"
                                name="licenseNumber"
                                value={formData.licenseNumber}
                                onChange={handleChange}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Specialization"
                                name="specialization"
                                value={formData.specialization}
                                onChange={handleChange}
                                placeholder="Oncology, Cardiology, etc."
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                fullWidth
                                label="Institution / Hospital"
                                name="institution"
                                value={formData.institution}
                                onChange={handleChange}
                                placeholder="Johns Hopkins Hospital"
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Phone"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                            />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label="Address"
                                name="address"
                                value={formData.address}
                                onChange={handleChange}
                            />
                        </Grid>
                        <Grid item xs={12}>
                            <TextField
                                fullWidth
                                multiline
                                rows={3}
                                label="Professional Bio"
                                name="bio"
                                value={formData.bio}
                                onChange={handleChange}
                                placeholder="Brief description of your experience and research interests..."
                            />
                        </Grid>

                        {/* Submit Button */}
                        <Grid item xs={12}>
                            <Button
                                fullWidth
                                type="submit"
                                variant="contained"
                                size="large"
                                disabled={loading}
                                sx={{ mt: 2 }}
                            >
                                {loading ? 'Registering...' : 'Register as Principal Investigator'}
                            </Button>
                        </Grid>

                        <Grid item xs={12}>
                            <Box textAlign="center" mt={2}>
                                <Typography variant="body2" color="text.secondary">
                                    Already have an account?{' '}
                                    <Link href="/login" underline="hover">
                                        Login here
                                    </Link>
                                </Typography>
                            </Box>
                        </Grid>
                    </Grid>
                </form>
            </Paper>
        </Container>
    );
};

export default PIRegisterPage;
