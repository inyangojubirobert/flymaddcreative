// Native builds use app.json unchanged. The hosted web build sets
// ONEDREAM_WEB_BASE_URL (e.g. /app) so it can be served as a single-page app
// beneath the main website, on the same origin as the API.
module.exports = ({ config }) => {
  const baseUrl = process.env.ONEDREAM_WEB_BASE_URL;
  if (!baseUrl) return config;
  return {
    ...config,
    web: { ...config.web, output: 'single' },
    experiments: { ...config.experiments, baseUrl },
  };
};
