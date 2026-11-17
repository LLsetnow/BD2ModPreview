# Skill cutscene audio

Skill assets automatically open in Game cutscene preview when a compatible timeline is available. A manual animation or sequence selected while loading takes priority, and an existing pause is preserved.

Game cutscene preview loads its sound effects and character voices automatically from the configured Asset library. It uses official Timeline clips, including unbound skill timelines selected by matching every Spine animation clip. Ordinary animation and manual sequence audio retain their existing controls.

## Asset layout

- audio/cutscene/timelines/<cutscene-id>.json: timing, event path, language files, volume, stop mode, and visual timeline SHA-256.
- audio/cutscene/sfx/*.wav: complete FMOD event renders, including the event's layers, routing, pitch and internal delays.
- audio/cutscene/ja-JP/<voice-id>/*.wav and ko-KR/<voice-id>/*.wav: decoded programmer samples resolved through the game's FMOD event callbacks.
- index.json: coverage summary; missing-audio.json: unavailable language samples; extraction-manifest.json: source files, sample indexes, hashes and rendering provenance.

Audio is external to the EXE. Missing local skill audio returns 404 immediately through the Asset library protocol.

## Playback

Skill voices and sound effects are enabled by default. Settings → Skill cutscene audio controls them separately. Voice language and volume are shared with portrait voices; sound effects have their own volume. The status line reports the language actually loaded, fallback voices, missing files, and incompatible timeline data.

A per-preview Web Audio scheduler supplies the same clock used to position the cutscene. Sounds can overlap. Pause cancels scheduled nodes, resume restores offsets, and seeking skips historical events. Restart and loop clear the previous pass; playback end clamps tails. Source changes, closing the preview, and hidden documents stop sound. A hidden preview resumes at its held position. Audio loading and language changes use cancellation tokens to discard stale responses.

The visual signature covers animation placement and timing, allowing background-only updates while refusing incompatible animation changes. The signature uses skillTimelineKey in src/utils/skillAudio.ts. FMOD None stop mode keeps the natural sound tail until the preview ends, even when the originating Timeline clip is shorter.

## Current extraction (2026-11-17)

174 matching visual timelines, 538 audio clips, 174 rendered sound effects, 360 Japanese voice WAVs and 310 Korean voice WAVs (844 WAVs total, 382,248,208 bytes). All files passed PCM, non-silence and SHA-256 checks.

51 Korean event references have no sample in the installed Korean banks. 50 can fall back to Japanese. Both languages lack Char004001_Cutscene8, requested by event:/Voices/Common/Char004001/Char004001_Cutscene2 at 3.9666667 seconds. Both the patched bank and cached language bundles were checked; no substitute line is assigned. The missing report retains the exact event and sample names.

## Extraction tools

Under F:/Neowiz/tools, run in this order with native Node and Python:

1. prepare_skill_audio.mjs — locate the latest cached bundles and voice banks.
2. extract_skill_timelines.py — extract all official timelines, including unbound timelines.
3. select_skill_timelines.mjs — require matching animation clips for each supported preview.
4. resolve_skill_events.py — resolve GUIDs and programmer sound names with the game's FMOD 2.03.12 DLL.
5. render_skill_events.py — render full SFX events through FMOD WAVWRITER_NRT with Core STREAM_FROM_UPDATE and a paused pre-roll at timeline zero (48 kHz, stereo, PCM16, 512-frame blocks).
6. extract_skill_voices.mjs — decode the exact samples with vgmstream, validating cached outputs against source hashes.
7. build_skill_audio_catalog.mjs — write runtime manifests and coverage reports.

These tools are configured for this workspace and store intermediate provenance under releases/BD2ModPreview-skill-audio-20261117/work. UnityPy and metadata tooling are isolated in tools/pythonlibs. Game sources are read without modification. The native game libraries execute only inside offline extraction helpers; ModPreview uses decoded WAV files.

## Verification

Node tests cover overlapping sounds, the common clock, pause/resume, seek offsets, tail cancellation and invalid manifests. A browser test using the real Preview component, Spine assets and WAV files covers 13 playback and failure cases. Vue type checking, Vite production build, and the native release build are also required before replacing deployed preview executables.

## Streaming audio repair

The initial offline renders could repeat stream decoder buffers in 30 events because the non-realtime render clock advanced faster than the asynchronous streaming thread. Re-rendering now uses Core STREAM_FROM_UPDATE and a paused pre-roll so streaming sounds are ready before recording starts. All 174 effects were rebuilt and checked against their original FSB samples, preserving FMOD mixing and authored event timing. The 30 streaming effects have source waveform correlation of at least 0.992; the five user-reported examples exceed 0.995 and start at the original sample position. Ordinary compressed samples can differ by 64 encoder priming frames, while authored source offsets are preserved.

The corrected files replace audio/cutscene/sfx in the Asset library; close and reopen a preview to discard its already decoded buffers. The local asset protocol uses Cache-Control: no-store. audio-quality.json records affected costumes and validation, and the previous WAVs are backed up under releases/BD2ModPreview-skill-audio-noise-20261117/before.
