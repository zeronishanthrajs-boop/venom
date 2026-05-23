const test = require("node:test");
const assert = require("node:assert/strict");

const { withMemoryHeavyTaskLock } = require("../utils/memoryHeavyTaskGate");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("withMemoryHeavyTaskLock enforces max concurrency of one", async () => {
  const previous = process.env.MAX_CONCURRENT_MEMORY_HEAVY_TASKS;
  process.env.MAX_CONCURRENT_MEMORY_HEAVY_TASKS = "1";

  let active = 0;
  let maxObserved = 0;
  const runTask = async (name, waitMs) =>
    withMemoryHeavyTaskLock(name, async () => {
      active += 1;
      maxObserved = Math.max(maxObserved, active);
      await sleep(waitMs);
      active -= 1;
    });

  await Promise.all([runTask("first", 40), runTask("second", 20), runTask("third", 10)]);
  assert.equal(maxObserved, 1);

  if (previous === undefined) {
    delete process.env.MAX_CONCURRENT_MEMORY_HEAVY_TASKS;
  } else {
    process.env.MAX_CONCURRENT_MEMORY_HEAVY_TASKS = previous;
  }
});
