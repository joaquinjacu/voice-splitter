#!/usr/bin/env python3
"""Build "Voice Splitter.amxd" (a Max for Live MIDI effect) from scratch.

An .amxd is just three little-endian chunks wrapped around a Max patcher:
    'ampf' <len> 'mmmm'      device type: mmmm = MIDI effect
    'meta' <len> <4 zero bytes>
    'ptch' <len> <patcher JSON>

    python3 build_device.py               # installs into the Ableton User Library
    python3 build_device.py OUT_DIR       # or writes both files to OUT_DIR

The User Library defaults to ~/Music/Ableton/User Library; set
ABLETON_USER_LIBRARY to use another one.
"""

import json
import os
import shutil
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.environ.get("ABLETON_USER_LIBRARY") or os.path.expanduser("~/Music/Ableton/User Library")
DEST = sys.argv[1] if len(sys.argv) > 1 else os.path.join(LIB, "Voice Splitter")

# device body geometry (presentation coordinates)
W = 264

_next_id = [0]


def nid():
    _next_id[0] += 1
    return "obj-%d" % _next_id[0]


boxes = []
lines = []


def add(box):
    boxes.append({"box": box})
    return box["id"]


def connect(src, outlet, dst, inlet=0):
    lines.append({"patchline": {"destination": [dst, inlet], "source": [src, outlet]}})


def param(longname, ptype, mmin, mmax, initial, enum=None, unitstyle=0):
    v = {
        "parameter_longname": longname,
        "parameter_shortname": longname,
        "parameter_type": ptype,
        "parameter_mmin": mmin,
        "parameter_mmax": mmax,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_unitstyle": unitstyle,
    }
    if enum is not None:
        v["parameter_enum"] = enum
    return {"valueof": v}


def label(text, x, y, w, patch_y):
    return add({
        "id": nid(),
        "maxclass": "live.comment",
        "numinlets": 1,
        "numoutlets": 0,
        "fontsize": 9.0,
        "patching_rect": [20.0, float(patch_y), float(w), 18.0],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), 18.0],
        "text": text,
        "textjustification": 0,
    })


# ----------------------------------------------------------------- controls

label("MODE", 8, 4, 46, 20)
tab_mode = add({
    "id": nid(),
    "maxclass": "live.tab",
    "numinlets": 1,
    "numoutlets": 3,
    "outlettype": ["", "", "float"],
    "num_lines_patching": 1,
    "num_lines_presentation": 1,
    "parameter_enable": 1,
    "hint": "Pitch: split each chord top-down. Poly: follow overlapping lines. "
            "Note: one track per pitch.",
    "patching_rect": [20.0, 42.0, 150.0, 18.0],
    "presentation": 1,
    "presentation_rect": [8.0, 20.0, 150.0, 18.0],
    "saved_attribute_attributes": param("Mode", 2, 0, 2, 0,
                                        ["Pitch", "Poly", "Note"], unitstyle=9),
    "varname": "Mode",
})

label("ORDER", 166, 4, 50, 64)
tab_order = add({
    "id": nid(),
    "maxclass": "live.tab",
    "numinlets": 1,
    "numoutlets": 3,
    "outlettype": ["", "", "float"],
    "num_lines_patching": 1,
    "num_lines_presentation": 1,
    "parameter_enable": 1,
    "hint": "Which voice lands on the first new track.",
    "patching_rect": [20.0, 86.0, 90.0, 18.0],
    "presentation": 1,
    "presentation_rect": [166.0, 20.0, 90.0, 18.0],
    "saved_attribute_attributes": param("Order", 2, 0, 1, 0,
                                        ["High", "Low"], unitstyle=9),
    "varname": "Order",
})

label("TRACKS", 8, 48, 50, 108)
num_tracks = add({
    "id": nid(),
    "maxclass": "live.numbox",
    "numinlets": 1,
    "numoutlets": 2,
    "outlettype": ["", "float"],
    "parameter_enable": 1,
    "hint": "Maximum number of tracks to create.",
    "patching_rect": [20.0, 130.0, 44.0, 15.0],
    "presentation": 1,
    "presentation_rect": [60.0, 49.0, 44.0, 15.0],
    "saved_attribute_attributes": param("Tracks", 1, 2, 16, 8),
    "varname": "Tracks",
})

label("SPREAD", 116, 48, 54, 152)
num_tol = add({
    "id": nid(),
    "maxclass": "live.numbox",
    "numinlets": 1,
    "numoutlets": 2,
    "outlettype": ["", "float"],
    "parameter_enable": 1,
    "hint": "Chord window in beats: notes starting within this of each other "
            "count as one chord (Pitch mode).",
    "patching_rect": [20.0, 174.0, 44.0, 15.0],
    "presentation": 1,
    "presentation_rect": [172.0, 49.0, 44.0, 15.0],
    # unitstyle 1 = Float. With 0 (Int) Live rounds the display and the value to 0.
    "saved_attribute_attributes": param("Tol", 0, 0.0, 1.0, 0.125, unitstyle=1),
    "varname": "Tol",
})

toggle_inst = add({
    "id": nid(),
    "maxclass": "live.text",
    "numinlets": 1,
    "numoutlets": 2,
    "outlettype": ["", ""],
    "mode": 1,
    "parameter_enable": 1,
    "text": "No Instrument",
    "texton": "Copy Instrument",
    "hint": "On: each voice track is a duplicate of the source track, "
            "instrument and all.",
    "patching_rect": [20.0, 218.0, 120.0, 18.0],
    "presentation": 1,
    "presentation_rect": [8.0, 74.0, 120.0, 18.0],
    "saved_attribute_attributes": param("CopyInst", 1, 0, 1, 1, ["Off", "On"]),
    "varname": "CopyInst",
})

btn_split = add({
    "id": nid(),
    "maxclass": "live.text",
    "numinlets": 1,
    "numoutlets": 2,
    "outlettype": ["", ""],
    "mode": 0,
    "parameter_enable": 1,
    "text": "SPLIT",
    "texton": "SPLIT",
    "hint": "Explode the selected MIDI clip onto one track per voice.",
    "patching_rect": [180.0, 218.0, 120.0, 18.0],
    "presentation": 1,
    "presentation_rect": [136.0, 74.0, 120.0, 18.0],
    # A real parameter so it can be MIDI-mapped; always loads at 0 so opening a
    # set never fires a split.
    "saved_attribute_attributes": param("Split", 1, 0, 1, 0, ["Off", "On"]),
    "varname": "Split",
})

status = add({
    "id": nid(),
    "maxclass": "comment",
    "numinlets": 1,
    "numoutlets": 0,
    "fontname": "Ableton Sans Medium Regular",
    "fontsize": 10.0,
    "linecount": 2,
    "patching_rect": [20.0, 340.0, 248.0, 33.0],
    "presentation": 1,
    "presentation_rect": [8.0, 100.0, 248.0, 33.0],
    "text": "Select a MIDI clip, then hit SPLIT",
    "varname": "status",
})

# --------------------------------------------------------------- plumbing

sel1 = add({
    "id": nid(), "maxclass": "newobj", "numinlets": 2, "numoutlets": 2,
    "outlettype": ["bang", ""],
    "patching_rect": [180.0, 250.0, 40.0, 22.0], "text": "sel 1",
})
defer_split = add({
    "id": nid(), "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
    "outlettype": [""],
    "patching_rect": [180.0, 280.0, 60.0, 22.0], "text": "deferlow",
})
msg_split = add({
    "id": nid(), "maxclass": "message", "numinlets": 2, "numoutlets": 1,
    "outlettype": [""],
    "patching_rect": [180.0, 310.0, 40.0, 22.0], "text": "split",
})

thisdevice = add({
    "id": nid(), "maxclass": "newobj", "numinlets": 1, "numoutlets": 3,
    "outlettype": ["bang", "bang", ""],
    "patching_rect": [340.0, 250.0, 90.0, 22.0], "text": "live.thisdevice",
})
defer_init = add({
    "id": nid(), "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
    "outlettype": [""],
    "patching_rect": [340.0, 280.0, 60.0, 22.0], "text": "deferlow",
})
msg_init = add({
    "id": nid(), "maxclass": "message", "numinlets": 2, "numoutlets": 1,
    "outlettype": [""],
    "patching_rect": [340.0, 310.0, 40.0, 22.0], "text": "init",
})

js = add({
    "id": nid(), "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
    "outlettype": [""],
    "patching_rect": [180.0, 400.0, 130.0, 22.0], "text": "js voicesplit.js",
    "saved_object_attributes": {"filename": "voicesplit.js", "parameter_enable": 0},
})
prepend_set = add({
    "id": nid(), "maxclass": "newobj", "numinlets": 2, "numoutlets": 1,
    "outlettype": [""],
    "patching_rect": [180.0, 430.0, 80.0, 22.0], "text": "prepend set",
})

# MIDI passthrough - a MIDI effect that does not wire these swallows the notes.
midiin = add({
    "id": nid(), "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
    "outlettype": ["int"],
    "patching_rect": [500.0, 250.0, 45.0, 22.0], "text": "midiin",
})
midiout = add({
    "id": nid(), "maxclass": "newobj", "numinlets": 1, "numoutlets": 0,
    "patching_rect": [500.0, 320.0, 52.0, 22.0], "text": "midiout",
})

connect(btn_split, 0, sel1)
connect(sel1, 0, defer_split)
connect(defer_split, 0, msg_split)
connect(msg_split, 0, js)
connect(thisdevice, 0, defer_init)
connect(defer_init, 0, msg_init)
connect(msg_init, 0, js)
connect(js, 0, prepend_set)
connect(prepend_set, 0, status)
connect(midiin, 0, midiout)

# ------------------------------------------------------------------ patcher

patcher = {
    "patcher": {
        "fileversion": 1,
        "appversion": {
            "major": 8, "minor": 1, "revision": 2,
            "architecture": "x64", "modernui": 1,
        },
        "classnamespace": "box",
        "rect": [65.0, 100.0, 700.0, 560.0],
        "openrect": [0.0, 0.0, float(W), 145.0],
        "bglocked": 0,
        "openinpresentation": 1,
        "default_fontsize": 12.0,
        "default_fontface": 0,
        "default_fontname": "Arial",
        "gridonopen": 1,
        "gridsize": [8.0, 8.0],
        "gridsnaponopen": 1,
        "objectsnaponopen": 1,
        "statusbarvisible": 2,
        "toolbarvisible": 1,
        "lefttoolbarpinned": 0,
        "toptoolbarpinned": 0,
        "righttoolbarpinned": 0,
        "bottomtoolbarpinned": 0,
        "toolbars_unpinned_last_save": 0,
        "tallnewobj": 0,
        "boxanimatetime": 500,
        "enablehscroll": 1,
        "enablevscroll": 1,
        "devicewidth": float(W),
        "description": "Explodes the selected MIDI clip's voices onto one track each.",
        "digest": "Voice Splitter",
        "tags": "midi utility",
        "style": "",
        "subpatcher_template": "",
        "title": "Voice Splitter",
        "boxes": boxes,
        "lines": lines,
        "dependency_cache": [{
            "name": "voicesplit.js",
            "bootpath": "~/Music/Ableton/User Library/Voice Splitter",
            "patcherrelativepath": ".",
            "type": "TEXT",
            "implicit": 1,
        }],
        "autosave": 0,
        "project": {
            "version": 1,
            "creationdate": 3590052786,
            "modificationdate": 3590052786,
            "viewrect": [0.0, 0.0, 300.0, 500.0],
            "autoorganize": 1,
            "hideprojectwindow": 1,
            "showdependencies": 1,
            "autolocalize": 0,
            "contents": {"patchers": {}},
            "layout": {},
            "searchpath": {},
            "detailsvisible": 0,
            "amxdtype": 1835887981,   # 'mmmm' - MIDI effect
            "readonly": 0,
            "devpathtype": 0,
            "devpath": ".",
            "sortmode": 0,
            "viewmode": 0,
        },
    }
}


def chunk(tag, payload):
    return tag.encode("ascii") + struct.pack("<I", len(payload)) + payload


def main():
    body = json.dumps(patcher, indent=1).encode("utf-8")
    data = chunk("ampf", b"mmmm") + chunk("meta", b"\x00\x00\x00\x00") + chunk("ptch", body)

    os.makedirs(DEST, exist_ok=True)
    amxd = os.path.join(DEST, "Voice Splitter.amxd")
    with open(amxd, "wb") as f:
        f.write(data)
    js_src, js_dst = os.path.join(HERE, "voicesplit.js"), os.path.join(DEST, "voicesplit.js")
    if os.path.abspath(js_src) != os.path.abspath(js_dst):   # building into this folder
        shutil.copy2(js_src, js_dst)

    print("wrote %s (%d bytes)" % (amxd, len(data)))
    print("wrote %s" % os.path.join(DEST, "voicesplit.js"))


if __name__ == "__main__":
    main()
