import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import preserveDirectives from 'rollup-preserve-directives';

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
    return {
        plugins: [react()],
        server: {
            port: 8000,
            open: true,
        },
        base: './',
        esbuild: {
            keepNames: true,
        },
        build: {
            // sourcemap: true,
            rollupOptions: {
                plugins: [preserveDirectives()],
            },
        },
    };
});
