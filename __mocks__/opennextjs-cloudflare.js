module.exports = {
  getCloudflareContext() {
    throw new Error('Cloudflare context is unavailable in Jest.');
  },
};
