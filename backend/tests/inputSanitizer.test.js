const test = require("node:test");
const assert = require("node:assert/strict");

const inputSanitizer = require("../middleware/inputSanitizer");

function runMiddleware(req) {
  let called = false;
  inputSanitizer(req, {}, () => {
    called = true;
  });
  assert.equal(called, true);
}

test("inputSanitizer strips script payloads for regular routes", () => {
  const req = {
    path: "/api/engagements",
    body: {
      title: "<script>alert(document.cookie)</script>"
    },
    query: {}
  };

  runMiddleware(req);
  assert.equal(req.body.title.includes("<script>"), false);
});

test("inputSanitizer preserves raw body for patterns route", () => {
  const rawPayload = "<script>alert(document.cookie)</script>";
  const req = {
    path: "/api/patterns",
    body: {
      payload: rawPayload
    },
    query: {}
  };

  runMiddleware(req);
  assert.equal(req.body.payload, rawPayload);
});

test("inputSanitizer preserves raw body for prompts route while still sanitizing query", () => {
  const req = {
    path: "/api/prompts/evolve",
    body: {
      prompt: "<script>alert('xss')</script>"
    },
    query: {
      q: "<img src=x onerror=alert(1)>"
    }
  };

  runMiddleware(req);
  assert.equal(req.body.prompt, "<script>alert('xss')</script>");
  assert.equal(req.query.q.includes("<"), false);
});
