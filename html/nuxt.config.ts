import vuetify from 'vite-plugin-vuetify';

export default defineNuxtConfig({
  compatibilityDate: '2024-04-03',

  ssr: false, // Disable server-side rendering for an SPA
  target: 'static', // Set target to 'static' for static site generation

  modules: [
    '@pinia/nuxt',
    (_options, nuxt) => {
      nuxt.hooks.hook('vite:extendConfig', (config) => {
        // @ts-expect-error: Add Vuetify plugin
        config.plugins.push(
          vuetify({
            autoImport: true,
            styles: true, // Ensure styles are included
          })
        );
      });
    },
    // Add other modules here...
  ],

  pinia: {
    autoImports: ['defineStore', ['defineStore', 'definePiniaStore']],
  },

  devtools: {
    enabled: true,
  },

  build: {
    transpile: ['vuetify'],
  },

  devServer: {
    port: 8021, // Set dev server port
    open: true, // Automatically open browser on start
  },

  server: {
    port: process.env.UI_SERVER_PORT || 8021, // Use environment variable for flexibility
    host: '0.0.0.0', // Listen on all network interfaces
  },

  nitro: {
    devProxy: {
      '/api': {
        target: 'http://localhost:8020/api/',
        changeOrigin: true,
        prependPath: true,
      },
    },
  },

  app: {
    head: {
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no',
        },
        // Add other meta tags as needed
      ],
      // Add other app-level configurations here if needed
    },
  },

  hooks: {
    // Additional hooks can be added here if needed
  },
});