let activeCount = 0;
const waitQueue = [];

function toInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getMaxConcurrentMemoryHeavyTasks() {
  return Math.max(toInteger(process.env.MAX_CONCURRENT_MEMORY_HEAVY_TASKS, 1), 1);
}

async function acquireMemoryHeavyTaskSlot() {
  const maxConcurrent = getMaxConcurrentMemoryHeavyTasks();
  if (activeCount < maxConcurrent && waitQueue.length === 0) {
    activeCount += 1;
  } else {
    await new Promise((resolve) => {
      waitQueue.push(resolve);
    });
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const next = waitQueue.shift();
    if (typeof next === "function") {
      next();
      return;
    }
    activeCount = Math.max(0, activeCount - 1);
  };
}

async function withMemoryHeavyTaskLock(taskName, runner) {
  const release = await acquireMemoryHeavyTaskSlot();
  try {
    return await runner();
  } finally {
    release();
  }
}

function getMemoryHeavyTaskGateStats() {
  return {
    activeCount,
    queuedCount: waitQueue.length,
    maxConcurrent: getMaxConcurrentMemoryHeavyTasks()
  };
}

module.exports = {
  withMemoryHeavyTaskLock,
  getMemoryHeavyTaskGateStats
};
