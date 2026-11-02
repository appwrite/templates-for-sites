import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import preserveDirectives from 'rollup-preserve-directives';

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
    return {
        plugins: [react()],
        resolve: {
            alias: {
                // react-admin imports named exports, which query-string 9 only exposes from base.js
                'query-string': fileURLToPath(
                    new URL('./node_modules/query-string/base.js', import.meta.url)
                ),
            },
        },
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
