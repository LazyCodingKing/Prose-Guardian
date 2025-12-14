# 🛡️ Prose Guardian

**Proactive AI Writing Enhancement for SillyTavern**

Version 2.0.0 - Evolved from AI-SlopFixer with superior architecture

---

## What It Does

Prose Guardian transforms AI roleplay from reactive fixing to **proactive prevention**:

- **Module A (Static Fixer):** Instant regex replacements (< 5ms, zero tokens)
- **Module B (Passive Watcher):** Background n-gram analysis learns patterns automatically  
- **Module C (Proactive Injector):** Prevents slop before generation by injecting dynamic instructions

**Result:** Clean, immersive prose without post-generation rewrites.

---

## Key Features

✅ **Instant Cleanup** - 51 ProsePolisher regex patterns replace clichés in < 5ms  
✅ **Zero API Cost** - Fast Mode uses zero tokens
✅ **Smart Learning** - Automatically detects overused phrases across 20 messages  
✅ **Proactive Prevention** - Injects anti-slop directives before AI generates  
✅ **Quality Mode** - AI rewrites with CoT removed (23s → 5s latency)  
✅ **User Protection** - Never allows AI to control user character  
✅ **Constraint Enforcement** - Word count, paragraphs, dialogue, perspective  

---

## Quick Start

1. Copy to `SillyTavern/public/scripts/extensions/third-party/Prose-Guardian`
2. Reload SillyTavern
3. Open Extension Settings → Find "🛡️ Prose Guardian"
4. Enable Fast Mode + Quality Mode
5. Chat normally - Guardian works automatically!

---

## Architecture

```
Message Received
     ↓
Module A: Static Fixer (regex, < 5ms)
     ↓
Module B: Passive Watcher (learn patterns)
     ↓
Message Updated

Before Next Generation:
Module B → detects overused phrases
Module C → injects prevention
     ↓
AI generates clean prose automatically!
```

---

## Performance

| Metric | Old (AI-SlopFixer) | New (Prose Guardian) |
|--------|-------------------|---------------------|
| Fast Mode Speed | ~100ms | < 5ms (**20x faster**) |
| API Calls | 1 per message | 0 (**zero**) |
| Quality Mode Latency | 23s | 5s (**78% faster**) |

---

## What's New in 2.0

- ✅ Integrated ProsePolisher's efficient modules
- ✅ Removed 280 lines of dead code
- ✅ Session flags prevent infinite loops
- ✅ Only process latest message (instant startup)
- ✅ CoT removed for 78% faster rewrites
- ✅ Proactive injection prevents slop before generation

---

## Credits

- **Original Concept:** AI-SlopFixer by Raja
- **Module Architecture:** Ported from ProsePolisher
- **Development:** Enhanced by Antigravity AI
- **Version:** 2.0.0 (Major Upgrade)

---

## License

MIT - Free to use and modify!
