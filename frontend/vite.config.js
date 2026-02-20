import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react({
            include: '**/*.{jsx,js}',
        })
    ],
    base: '/drugtrial/',
    server: {
        port: 3000,
        open: true,
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
                ws: true,
                timeout: 1800000, // 30 minutes
                proxyTimeout: 1800000,
                configure: (proxy, options) => {
                    proxy.on('proxyReq', (proxyReq, req, res) => {
                        // Set no timeout on proxy request
                        proxyReq.setTimeout(0);
                    });
                    proxy.on('proxyRes', (proxyRes, req, res) => {
                        // Disable buffering for streaming
                        proxyRes.headers['x-accel-buffering'] = 'no';
                    });
                }
            }
        }
    },
    build: {
        outDir: 'build',
        sourcemap: true
    },
    esbuild: {
        loader: 'jsx',
        include: /src\/.*\.js$/,
        exclude: []
    },
    optimizeDeps: {
        esbuildOptions: {
            loader: {
                '.js': 'jsx'
            }
        }
    }
})
