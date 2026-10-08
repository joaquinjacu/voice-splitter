# Voice Splitter

A Max for Live MIDI effect for Ableton Live that splits the selected MIDI clip into its
voices, one new track per voice.

## Why

A transcribed or recorded piano part arrives as one clip holding every voice at once.
To study the voicings, or to give each line its own sound, you want each voice on its own
track. Doing that by hand means duplicating the clip and deleting notes, once per voice.
Joaquín Jacubowicz wrote this device to do it in one step.

## Install

Copy **both** `Voice Splitter.amxd` and `voicesplit.js` into one folder that Live can
browse, for example `~/Music/Ableton/User Library/Voice Splitter/`. The device is not
frozen; it loads `voicesplit.js` from its own folder, so the two files must stay together.

Or build and install it (Python 3, standard library only):

```
python3 build_device.py            # writes both files to <User Library>/Voice Splitter/
python3 build_device.py OUT_DIR    # or to any folder
```

The User Library defaults to `~/Music/Ableton/User Library`; set `ABLETON_USER_LIBRARY` to
use another one. The `Voice Splitter.amxd` in this repository is exactly what
`build_device.py` produces.

## Use

1. Drop **Voice Splitter** on the MIDI track that holds the clip.
2. Click the clip you want to split, so it is the one showing in the detail view.
3. Set the options and press **SPLIT**.

New tracks are inserted directly below the source track and named `<Track> V1`, `V2`, and
so on (in Note mode, by pitch: `<Track> C3`). The whole split is one undo step. The source
clip is not changed.

| Control | What it does |
|---|---|
| **MODE: Pitch** | Groups notes that start together into chords and deals out the chord tones from the top down. For block chords and pad voicings. |
| **MODE: Poly** | Voice allocation: each note goes to a free voice, preferring the one whose last note was nearest in pitch. For overlapping, independent lines. |
| **MODE: Note** | One track per distinct pitch, for splitting drums. |
| **ORDER** | Whether the highest or the lowest voice goes on the first new track. |
| **TRACKS** | Maximum number of tracks to create (2 to 16). Overflow goes into the last track. |
| **SPREAD** | Chord window in beats (Pitch mode only). Notes starting within this distance of each other count as one chord. Raise it for humanised or strummed input. Default 0.125 (a 1/32 note). |
| **COPY INSTRUMENT** | On: each voice track is a duplicate of the source track, with its instrument and mixer settings (this device and the source clips are removed from the copies). Off: plain empty MIDI tracks. |

It works on Session and Arrangement clips. It keeps velocity, note probability, velocity
deviation, release velocity, loop and marker positions, and the time signature.

**SPLIT** is a device parameter, so it can be MIDI-mapped. It always loads at 0, so opening
a set never triggers a split.

## How it works

- `voicesplit.js` runs in Max's `js` object (ES5) and does all the work through the Live
  Object Model. It reads its settings from the device's own Live parameters at split
  time, so there is no ordering problem between the UI objects and the script.
- It finds the clip in the detail view (`live_set view detail_clip`, falling back to the
  highlighted clip slot) and reads its notes with `get_all_notes_extended`.
- With Copy Instrument on, it duplicates the source track once, strips the copy back to
  its device chain (removes this device and every clip), and duplicates that cleaned track
  for the remaining voices.
- Notes are written with `add_new_notes`. If nothing lands, it falls back to the legacy
  `set_notes` calls. For an arrangement clip, the voice clip is built in a session slot,
  copied into the arrangement at the source clip's position with
  `duplicate_clip_to_arrangement`, and the session copy is deleted.
- `build_device.py` generates the `.amxd` from scratch, so no Max editor session is
  needed. An unfrozen device is three little-endian chunks: `ampf` (device type, `mmmm` for
  a MIDI effect), `meta`, and `ptch` holding the patcher JSON. The script defines the UI
  (`live.tab`, `live.numbox`, `live.text`) and the wiring in Python.

## Limitations

- Built for Live 12.1 with its bundled Max (`get_all_notes_extended` and `add_new_notes`
  need Live 11 or later).
- It is an offline clip operation. A Max for Live device cannot route MIDI to other tracks
  in real time. For live playing, put a filter device on each destination track and set
  its **MIDI From** to the source track instead.
- If `add_new_notes` fails, the legacy fallback writes pitch, time, duration, velocity and
  mute only.
- Errors are shown in the device's status line and in Live's Max window.

## Licence and credits

Built with [Claude Code](https://claude.com/claude-code): the author designed the device, directed the agent and tested the results.

Written by Joaquín Jacubowicz. No licence has been chosen yet; until one is added, the
default copyright applies. The repository contains no third-party code.

Ableton and Live are trademarks of Ableton AG. Max is a trademark of Cycling '74. This
project is not affiliated with or endorsed by either.
