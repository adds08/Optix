# Condition-Based Waiting

## Overview

Flaky tests often guess at timing with arbitrary delays. This creates race conditions where tests pass on fast machines but fail under load or in CI.

**Core principle:** Wait for the actual condition you care about, not a guess about how long it takes.

## When to Use

**Use when:**
- Tests have arbitrary delays (`sleep`, `time.sleep()`)
- Tests are flaky (pass sometimes, fail under load)
- Tests timeout when run in parallel
- Waiting for async operations to complete

## Core Pattern

```python
# BAD: Guessing at timing
import time
time.sleep(5)
result = get_result()

# GOOD: Waiting for condition
import time
start = time.time()
while time.time() - start < 30:  # timeout
    result = get_result()
    if result is not None:
        break
    time.sleep(0.1)  # poll interval
```

## Quick Patterns

| Scenario | Pattern |
|----------|---------|
| Wait for process | Poll until exit code |
| Wait for file | Poll until file exists |
| Wait for API | Poll until 200 response |
| Wait for DB state | Poll query until expected result |

## Common Mistakes

- Polling too fast (wastes CPU) -- poll every 100ms-1s
- No timeout (loop forever) -- always include timeout
- Stale data (cached before loop) -- re-query inside loop

## When Arbitrary Timeout IS Correct

Only when testing actual timing behavior (debounce, rate limits). Always document WHY.
