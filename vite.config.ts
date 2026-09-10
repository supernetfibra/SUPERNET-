import { vlyPlugin } from "@vly-ai/integrations";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Ensure a single copy of React across all modules (vly-toolbar-readonly.tsx
    // is outside src/ and can resolve a separate React without this).
    dedupe: ["react", "react-dom"],
  },
  build: {
    // Enable source maps for better debugging (disable in production if needed)
    sourcemap: false,
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching and lazy loading
        manualChunks(id) {
          // Vendor chunks for large libraries
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/react-router') || id.includes('node_modules/@remix-run')) {
            return 'react-vendor';
          }
          // Radix UI — used across most pages, good to cache together
          if (id.includes('node_modules/@radix-ui/')) {
            return 'radix-ui';
          }
          // Heavy libraries used only on specific pages — separate chunks
          if (id.includes('node_modules/recharts/')) {
            return 'charts';
          }
          if (id.includes('node_modules/react-hook-form') || id.includes('node_modules/@hookform/resolvers') || id.includes('node_modules/zod')) {
            return 'forms';
          }
          if (id.includes('node_modules/framer-motion/')) {
            return 'framer-motion';
          }
          if (id.includes('node_modules/embla-carousel/') || id.includes('node_modules/embla-carousel-react/')) {
            return 'carousel';
          }
          if (id.includes('node_modules/react-day-picker/') || id.includes('node_modules/date-fns/')) {
            return 'calendar';
          }
          if (id.includes('node_modules/cmdk/')) {
            return 'command';
          }
          if (id.includes('node_modules/vaul/')) {
            return 'drawer';
          }
          if (id.includes('node_modules/input-otp/')) {
            return 'input-otp';
          }
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons';
          }
        },
        // Optimize chunk size
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit for better chunking
    chunkSizeWarningLimit: 1000,
    // Target modern browsers for better optimization
    target: 'esnext',
    // Minify options - using esbuild (faster than terser)
    minify: 'esbuild',
  },
  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router',
    ],
  },
  // Performance hints
  server: {
    // HMR must be disabled — the Freebuff proxy breaks Vite's WebSocket-based
    // module hot-reloading, causing "Importing a module script failed" errors
    // that cascade into React removeChild NotFoundError crashes.
    hmr: false,
    // Proxy /api/* requests to the local Hono dev server
    // Run: npx vercel dev  (or start the Hono server separately on port 3001)
    proxy: {
      '/api': {
        target: process.env.API_DEV_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
