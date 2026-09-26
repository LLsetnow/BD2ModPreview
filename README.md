# BD2ModPreview

A **minimal Spine animation viewer** used internally by [**BD2ModManager**](https://github.com/bruhnn/BD2ModManager).

---

## Overview

**BD2ModPreview** is a lightweight, standalone `.exe` for previewing Spine mod animations.  
It is designed specifically for use with **BD2ModManager** and is **not** a full-featured Spine viewer.

---

## Usage

While this tool is normally launched by **BD2ModManager**, you can run it manually:

```bash
BD2ModPreview.exe <path-to-mod-folder>
```
The mod folder must include:

- .skel or .json file
- .atlas file
- Corresponding .png texture(s)

### Skill animation and audio preview

Choose **Play Full Skill** in the animation list to play the cut animations in natural name order. Turn off **Loop Animation** to play the sequence once.

To add audio, choose a folder containing extracted `.ogg`, `.mp3`, or `.wav` clips. In automatic mode, clips are matched to Spine event audio paths or animation names. Selecting a clip in **Full-sequence audio** plays that clip from the start of the full sequence.

Audio clips are not included with the Spine mod files. FMOD/FSB game banks must be extracted to a supported audio format before selecting them here.

## Spine Runtime License

This project uses the official Spine runtimes provided by [Esoteric Software](http://esotericsoftware.com/).  
These runtimes are licensed under their own terms, and **you must have a valid Spine license** to use or distribute projects built with them.

[Spine Runtimes License](http://esotericsoftware.com/spine-runtimes-license)

> **Note:** This previewer is for **educational and debugging purposes only**. It is not affiliated with or endorsed by Esoteric Software.

---

## Related Project

- [**BD2ModManager**](https://github.com/bruhnn/BD2ModManager) – Mod manager with built-in support for mod previews using BD2ModPreview.

---

## License

Licensed under the [MIT License](LICENSE).
