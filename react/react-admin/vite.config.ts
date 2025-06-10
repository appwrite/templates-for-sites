import { defineConfig } from 'vite';
import path from "path";
import react from "@vitejs/plugin-react";
import preserveDirectives from 'rollup-preserve-directives';

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  return {
    plugins: [react()],
    define: {
      "process.env": process.env,
    },
    server: {
      port: 8000,
      open: true,
    },
    base: "./",
    esbuild: {
      keepNames: true,
    },
    build: {
      // sourcemap: true,
      rollupOptions: {
        plugins: [preserveDirectives()],
      },
    },
    resolve: {
      preserveSymlinks: true,
      alias: [
        // The 2 next aliases are needed to avoid having multiple MUI instances
        {
          find: /^@mui\/([a-zA-Z0-9-_]+)\/*(.*)$/,
          replacement: `${path.resolve(
            __dirname,
            "node_modules/@mui/$1/esm/$2"
          )}`,
        },
      ],
    },
  };
});
