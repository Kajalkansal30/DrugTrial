import React, { useState } from 'react';
import {
    BrowserRouter as Router,
    Routes,
    Route,
    Link,
    useLocation,
    useNavigate
} from 'react-router-dom';
import {
    Container, AppBar, Toolbar, Typography, Box, Button, CssBaseline, Menu, MenuItem, Avatar
} from '@mui/material';
import { Home, Psychology, Security, AdminPanelSettings, Science, Dashboard, ExitToApp, Business } from '@mui/icons-material';

import WorkflowStepper from './components/WorkflowStepper';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import UploadPage from './pages/UploadPage';
import FDAProcessingPage from './pages/FDAProcessingPage';
import CriteriaPage from './pages/CriteriaPage';
import ScreeningPage from './pages/ScreeningPage';
import AuditTrailPage from './pages/AuditTrailPage';
import PrivacyAuditPage from './pages/PrivacyAuditPage';
import OrganizationDashboard from './pages/OrganizationDashboard';

function App() {
    const [currentTrial, setCurrentTrial] = useState(null);

    return (
        <Router basename="/drugtrial" future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <CssBaseline />
            <Routes>
                {/* Public route */}
                <Route path="/login" element={<LoginPage />} />
                
                {/* Protected routes */}
                <Route path="/*" element={
                    <ProtectedRoute>
                        <MainLayout currentTrial={currentTrial} setCurrentTrial={setCurrentTrial} />
                    </ProtectedRoute>
                } />
            </Routes>
        </Router>
    );
}

function MainLayout({ currentTrial, setCurrentTrial }) {
    const navigate = useNavigate();
    const [anchorEl, setAnchorEl] = useState(null);
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    const handleMenuClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleMenuClose = () => {
        setAnchorEl(null);
    };

    const handleLogout = () => {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        navigate('/login');
    };

    return (
        <Box sx={{ flexGrow: 1, bgcolor: '#f5f7fa', minHeight: '100vh' }}>
            <AppBar position="static" elevation={0} sx={{ bgcolor: '#102a43' }}>
                <Toolbar>
                    <Typography variant="h6" component="div" sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
                        <Psychology sx={{ mr: 1 }} /> Clinical Trial Automation
                    </Typography>
                    <Button color="inherit" component={Link} to="/dashboard" startIcon={<Dashboard />}>
                        Dashboard
                    </Button>
                    <Button color="inherit" component={Link} to="/audit" startIcon={<Security />}>
                        Audit Trail
                    </Button>
                    <Button color="inherit" component={Link} to="/privacy" startIcon={<AdminPanelSettings />}>
                        Privacy Audit
                    </Button>
                    <Button color="inherit" component={Link} to="/" startIcon={<Home />}>
                        Home
                    </Button>
                    <Button
                        color="inherit"
                        onClick={handleMenuClick}
                        startIcon={<Avatar sx={{ width: 24, height: 24, bgcolor: 'primary.main', fontSize: 14 }}>
                            {user.fullName?.charAt(0) || user.username?.charAt(0) || 'U'}
                        </Avatar>}
                    >
                        {user.organization?.name || 'User'}
                    </Button>
                    <Menu
                        anchorEl={anchorEl}
                        open={Boolean(anchorEl)}
                        onClose={handleMenuClose}
                    >
                        <MenuItem disabled>
                            <Business sx={{ mr: 1 }} fontSize="small" />
                            {user.organization?.name}
                        </MenuItem>
                        <MenuItem disabled>
                            Logged in as: {user.fullName || user.username}
                        </MenuItem>
                        <MenuItem onClick={handleLogout}>
                            <ExitToApp sx={{ mr: 1 }} fontSize="small" />
                            Logout
                        </MenuItem>
                    </Menu>
                </Toolbar>
            </AppBar>

            <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
                <WorkflowHeader />

                <Routes>
                    <Route path="/" element={<UploadPage onUploadSuccess={setCurrentTrial} />} />
                    <Route path="/dashboard" element={<OrganizationDashboard />} />
                    <Route path="/api/fda/forms/:documentId" element={<FDAProcessingPage />} />
                    <Route path="/process-fda/:documentId" element={<FDAProcessingPage />} />
                    <Route path="/trial/:trialId/criteria" element={<CriteriaPage trialData={currentTrial} />} />
                    <Route path="/trial/:trialId/screening" element={<ScreeningPage trialData={currentTrial} />} />
                    <Route path="/fda-processing" element={<FDAProcessingPage />} />
                    <Route path="/audit" element={<AuditTrailPage />} />
                    <Route path="/privacy" element={<PrivacyAuditPage />} />
                </Routes>
            </Container>
        </Box>
    );
}

const WorkflowHeader = () => {
    const location = useLocation();
    const getStep = () => {
        if (location.pathname === '/') return 0;
        if (location.pathname.includes('/api/fda/forms/')) return 1;
        if (location.pathname.includes('/process-fda/')) return 1;
        if (location.pathname.includes('/forms')) return 1;
        if (location.pathname.includes('/criteria')) return 2;
        if (location.pathname.includes('/screening')) return 3;
        return 0;
    };

    return <WorkflowStepper activeStep={getStep()} />;
};

export default App;
