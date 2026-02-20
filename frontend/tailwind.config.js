/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: {
                    50: '#e6f1ff',
                    100: '#b3d7ff',
                    200: '#80beff',
                    300: '#4da5ff',
                    400: '#1a8cff',
                    500: '#0073e6',
                    600: '#005cb3',
                    700: '#004480',
                    800: '#002d4d',
                    900: '#001a2e',
                },
            },
        },
    },
    plugins: [],
    // Disable preflight to work with Material-UI
    corePlugins: {
        preflight: false,
    },
}
