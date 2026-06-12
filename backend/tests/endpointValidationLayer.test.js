const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EndpointValidationLayer,
  detectStackFromSignals
} = require("../services/endpointValidationLayer");

function createLayer(handler) {
  return new EndpointValidationLayer({
    httpClient: async (request) => handler(request)
  });
}

function response(status, { headers = {}, body = "" } = {}) {
  return {
    ok: true,
    status,
    headers,
    body,
    durationMs: 1
  };
}

test("HTTP 404 generic body is NOT_PRESENT and skipped", async () => {
  const layer = createLayer(async ({ url, method }) => {
    if (url.endsWith("/favicon.ico")) return response(404, { body: "404 not found" });
    if (url.endsWith("/")) {
      return response(200, {
        body: "<html><script src=\"/_next/static/app.js\"></script></html>"
      });
    }
    assert.ok(["HEAD", "GET"].includes(method));
    return response(404, { body: "404 page not found" });
  });

  const stack = await layer.detectTechnologyStack("https://example.com");
  const result = await layer.validateEndpoint(
    "https://example.com",
    { path: "/api/missing", source: "DISCOVERED" },
    stack
  );

  assert.equal(result.endpointStatus, "NOT_PRESENT");
  assert.equal(result.skipReason, "GENERIC_404");
});

test("HTTP 403 with Cloudflare WAF header is INFERRED_PRESENT and wafProtected", async () => {
  const layer = createLayer(async ({ url }) => {
    if (url.endsWith("/favicon.ico")) return response(404);
    if (url.endsWith("/")) return response(200, { body: "<html></html>" });
    return response(403, {
      headers: { server: "cloudflare", "cf-ray": "abc-MAA" },
      body: "Access denied"
    });
  });

  const stack = await layer.detectTechnologyStack("https://example.com");
  const result = await layer.validateEndpoint(
    "https://example.com",
    { path: "/api/protected", source: "DISCOVERED" },
    stack
  );

  assert.equal(result.endpointStatus, "INFERRED_PRESENT");
  assert.equal(result.wafProtected, true);
});

test("PHP endpoint against detected Next.js stack is skipped with STACK_MISMATCH", async () => {
  const layer = createLayer(async ({ url }) => {
    if (url.endsWith("/favicon.ico")) return response(404);
    return response(200, {
      body: "<html><script src=\"/_next/static/chunks/app.js\"></script></html>"
    });
  });

  const stack = await layer.detectTechnologyStack("https://example.com");
  const result = await layer.validateEndpoint(
    "https://example.com",
    { path: "/product.php?id=1", source: "SUPPLEMENTARY" },
    stack
  );

  assert.equal(stack.primaryStack, "Next.js");
  assert.equal(result.endpointStatus, "NOT_PRESENT");
  assert.equal(result.skipReason, "STACK_MISMATCH");
});

test("sitemap URL is extracted and added to DISCOVERED list", async () => {
  const layer = createLayer(async ({ url }) => {
    if (url.endsWith("/robots.txt")) return response(404, { body: "not found" });
    if (url.endsWith("/sitemap.xml")) {
      return response(200, {
        body: "<urlset><url><loc>https://example.com/api/users</loc></url></urlset>"
      });
    }
    return response(200, { body: "<html></html>" });
  });

  const discovered = await layer.discoverDynamicEndpoints("https://example.com");
  assert.ok(
    discovered.some((endpoint) => endpoint.path === "/api/users" && endpoint.source === "DISCOVERED")
  );
});

test("Unknown stack keeps full wordlist and marks supplementary findings unverified", () => {
  const stack = detectStackFromSignals({
    headers: {},
    body: "<html><title>Plain site</title></html>"
  });
  const layer = createLayer(async () => response(200));
  const wordlist = layer.buildStackWordlist(stack, ["/index.php", "/api/users"]);

  assert.equal(stack.primaryStack, "Unknown");
  assert.deepEqual(
    wordlist.map((endpoint) => endpoint.path),
    ["/index.php", "/api/users"]
  );
  assert.ok(wordlist.every((endpoint) => endpoint.unverified === true));
});
