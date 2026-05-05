const STARTUP_SCAN_PROFILE = {
  toolWhitelist: [
    "http_headers_probe",
    "tls_metadata_probe",
    "dns_lookup_probe",
    "nuclei_scan",
    "nikto_scan",
    "nmap_tcp_scan",
    "sqlmap_detect"
  ],
  noDestructiveOps: true,
  quietMode: false,
  maxConcurrentOps: 2,
  timeoutMinutes: 15,
  restrictedPaths: ["/admin", "/internal", "/api/admin", "/metrics", "/_health"],
  phaseLabels: {
    recon: "Checking your public footprint",
    scanning: "Looking for known vulnerabilities",
    analysis: "Analyzing what we found",
    reporting: "Preparing your report"
  }
};

module.exports = {
  STARTUP_SCAN_PROFILE
};
