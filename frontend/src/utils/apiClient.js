import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Create axios instance
const apiClient = axios.create({
    baseURL: API_URL
});

// Add auth token to all requests
apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('auth_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Handle auth errors
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            // Token expired or invalid
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            window.location.href = '/drugtrial/login';
        }
        return Promise.reject(error);
    }
);

export default apiClient;
