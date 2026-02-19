import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Protected Route Component
 * Redirects to login if user is not authenticated
 */
function ProtectedRoute({ children }) {
    const location = useLocation();
    const token = localStorage.getItem('auth_token');

    if (!token) {
        // Redirect to login, save current location
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return children;
}

export default ProtectedRoute;
