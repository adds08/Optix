# Root Cause Tracing

## Overview

Bugs often manifest deep in the call stack. Your instinct is to fix where the error appears, but that's treating a symptom.

**Core principle:** Trace backward through the call chain until you find the original trigger, then fix at the source.

## When to Use

**Use when:**
- Error happens deep in execution (not at entry point)
- Stack trace shows long call chain
- Unclear where invalid data originated
- Need to find which test/code triggers the problem

## The Tracing Process

### 1. Observe the Symptom
```
Error: field mapping failed for column 'member_id'
```

### 2. Find Immediate Cause
**What code directly causes this?**

### 3. Ask: What Called This?
Trace up through the call stack -- what function called this with the bad value?

### 4. Keep Tracing Up
**What value was passed?** Follow the data back through each layer.

### 5. Find Original Trigger
Where did the bad value originate? Fix there, not at the symptom.

## Adding Stack Traces

When you can't trace manually, add instrumentation:

```python
import traceback
# Before the problematic operation
print(f"DEBUG: value={value}, caller={traceback.format_stack()[-3]}")
```

**Critical:** Use `print()` or `logger.error()` in debugging -- log level may suppress debug messages.

## Key Principle

**NEVER fix just where the error appears.** Trace back to find the original trigger.

After fixing at source, consider adding defense-in-depth validation at each layer (see `defense-in-depth.md`).
