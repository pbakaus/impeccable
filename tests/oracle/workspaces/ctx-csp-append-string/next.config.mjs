const csp = "default-src 'self'; script-src 'self'; connect-src 'self'";
export default {
  async headers() {
    return [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: csp }] }];
  },
};
