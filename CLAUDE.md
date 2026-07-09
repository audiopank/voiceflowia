# VoiceFlow IA

## Pre-deploy check (mandatory)

Before any commit + push to `main` (production auto-deploys via Vercel), always run the `voiceflow-deploy-guard` subagent (`.claude/agents/voiceflow-deploy-guard.md`) first. It builds the project and sweeps for this codebase's known recurring bug patterns (unsafe `response.json()` parsing, state keyed by AI-returned fields instead of index, hidden Fragment children breaking CSS Grid, stale Gemini model IDs, banned slow voices creeping back in, un-converted WhatsApp audio, marketing copy implying video generation, unregistered dev-bridge API routes). Fix anything it flags as safe to auto-fix; surface anything else to the user before shipping.
