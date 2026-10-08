// Voice Splitter - Max for Live
// Takes the selected MIDI clip and explodes its voices onto one track per voice.
//
// Messages: init, split
// Settings are read straight off the device's own Live parameters at split time,
// so there is no init-order dance between the UI objects and this script.

autowatch = 1;
inlets = 1;
outlets = 1;

var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

var MODE_PITCH = 0;
var MODE_POLY = 1;
var MODE_PERNOTE = 2;

// filled in by readSettings()
var gMode = MODE_PITCH;
var gOrder = 0;      // 0 = highest voice on the first track, 1 = lowest first
var gMaxTracks = 8;
var gTol = 0.125;    // chord grouping window, in beats
var gCopyInst = 1;

function nop() {}

function status(s) {
	outlet(0, s);
}

function init() {
	status("Select a MIDI clip, then hit SPLIT");
}

// ---------------------------------------------------------------- utilities

// LiveAPI.get() hands back a one-element array for scalars.
function g1(api, prop) {
	var v = api.get(prop);
	if (v instanceof Array) return v[0];
	return v;
}

function isValid(api) {
	return api && api.id && api.id != 0 && api.id != "0";
}

// Ableton note naming: C3 = 60.
function noteName(p) {
	return NOTE_NAMES[p % 12] + (Math.floor(p / 12) - 2);
}

// Live object references get passed as "id <n>" in most builds, but fall back
// to the two-atom form if that is rejected.
function callWithObj(api, fn, objId, extra) {
	try {
		if (extra === undefined) return api.call(fn, "id " + objId);
		return api.call(fn, "id " + objId, extra);
	} catch (e) {
		if (extra === undefined) return api.call(fn, "id", objId);
		return api.call(fn, "id", objId, extra);
	}
}

function readSettings() {
	var dev = new LiveAPI(nop, "this_device");
	var count = dev.getcount("parameters");
	for (var i = 0; i < count; i++) {
		var p = new LiveAPI(nop, "this_device parameters " + i);
		var name = String(g1(p, "name"));
		var val = g1(p, "value");
		if (name == "Mode") gMode = Math.round(val);
		else if (name == "Order") gOrder = Math.round(val);
		else if (name == "Tracks") gMaxTracks = Math.max(2, Math.min(16, Math.round(val)));
		else if (name == "Tol") gTol = Math.max(0, val);
		else if (name == "CopyInst") gCopyInst = Math.round(val);
	}
}

// ------------------------------------------------------------- source clip

function getSourceClip() {
	var c = new LiveAPI(nop, "live_set view detail_clip");
	if (isValid(c)) return c;
	var slot = new LiveAPI(nop, "live_set view highlighted_clip_slot");
	if (isValid(slot) && g1(slot, "has_clip") == 1) {
		return new LiveAPI(nop, "live_set view highlighted_clip_slot clip");
	}
	return null;
}

function readNotes(clip, span) {
	var raw;
	try {
		raw = clip.call("get_all_notes_extended");
	} catch (e) {
		raw = clip.call("get_notes_extended", 0, 128, 0, span);
	}
	if (raw === undefined || raw === null) return [];
	// Max may hand the JSON back split across atoms; JSON ignores the extra
	// whitespace that rejoining introduces.
	if (raw instanceof Array) raw = raw.join(" ");
	var parsed = JSON.parse(String(raw));
	return parsed.notes || [];
}

// ------------------------------------------------------------ voice splitting

function byStartThenPitch(a, b) {
	if (a.start_time != b.start_time) return a.start_time - b.start_time;
	return b.pitch - a.pitch;
}

function pitchCmp(a, b) {
	return gOrder === 0 ? b.pitch - a.pitch : a.pitch - b.pitch;
}

// Group notes that start together, then hand out the chord tones top-down.
function splitPitchOrder(notes) {
	notes.sort(byStartThenPitch);
	var voices = [];
	var i = 0;
	while (i < notes.length) {
		var t0 = notes[i].start_time;
		var chord = [];
		while (i < notes.length && notes[i].start_time - t0 <= gTol + 1e-9) {
			chord.push(notes[i]);
			i++;
		}
		chord.sort(pitchCmp);
		for (var k = 0; k < chord.length; k++) {
			var v = Math.min(k, gMaxTracks - 1);
			if (!voices[v]) voices[v] = [];
			voices[v].push(chord[k]);
		}
	}
	return { voices: voices, names: null, overflow: 0 };
}

function avgPitch(arr) {
	var s = 0;
	for (var i = 0; i < arr.length; i++) s += arr[i].pitch;
	return s / arr.length;
}

// Classic voice allocation: each note goes to a free voice, preferring the one
// whose last note was closest in pitch so melodic lines stay together.
function splitPoly(notes) {
	notes.sort(byStartThenPitch);
	var voices = [];
	for (var i = 0; i < notes.length; i++) {
		var n = notes[i];
		var best = -1;
		var bestDist = 1e9;
		for (var v = 0; v < voices.length; v++) {
			if (voices[v].end <= n.start_time + 1e-6) {
				var d = Math.abs(voices[v].last - n.pitch);
				if (d < bestDist) { bestDist = d; best = v; }
			}
		}
		if (best < 0) {
			if (voices.length < gMaxTracks) {
				voices.push({ end: 0, last: n.pitch, notes: [] });
				best = voices.length - 1;
			} else {
				best = 0;
				for (var w = 1; w < voices.length; w++) {
					if (voices[w].end < voices[best].end) best = w;
				}
			}
		}
		voices[best].notes.push(n);
		voices[best].end = n.start_time + n.duration;
		voices[best].last = n.pitch;
	}
	var out = [];
	for (var j = 0; j < voices.length; j++) out.push(voices[j].notes);
	out.sort(function (a, b) {
		return gOrder === 0 ? avgPitch(b) - avgPitch(a) : avgPitch(a) - avgPitch(b);
	});
	return { voices: out, names: null, overflow: 0 };
}

// One track per distinct pitch - the drum-rack splitter.
function splitPerNote(notes) {
	var map = {};
	var pitches = [];
	for (var i = 0; i < notes.length; i++) {
		var p = notes[i].pitch;
		if (!map[p]) { map[p] = []; pitches.push(p); }
		map[p].push(notes[i]);
	}
	pitches.sort(function (a, b) { return gOrder === 0 ? b - a : a - b; });
	var out = [];
	var names = [];
	for (var k = 0; k < pitches.length; k++) {
		if (k < gMaxTracks) {
			out.push(map[pitches[k]]);
			names.push(noteName(pitches[k]));
		} else {
			out[gMaxTracks - 1] = out[gMaxTracks - 1].concat(map[pitches[k]]);
		}
	}
	return { voices: out, names: names, overflow: Math.max(0, pitches.length - gMaxTracks) };
}

// ------------------------------------------------------------- writing clips

function writeNotes(clipApi, notes) {
	var arr = [];
	for (var i = 0; i < notes.length; i++) {
		var s = notes[i];
		var o = {
			pitch: s.pitch,
			start_time: s.start_time,
			duration: s.duration,
			velocity: (s.velocity === undefined ? 100 : s.velocity),
			mute: (s.mute === undefined ? 0 : s.mute)
		};
		if (s.probability !== undefined) o.probability = s.probability;
		if (s.velocity_deviation !== undefined) o.velocity_deviation = s.velocity_deviation;
		if (s.release_velocity !== undefined) o.release_velocity = s.release_velocity;
		arr.push(o);
	}

	var d = null;
	try {
		d = new Dict();
		d.parse(JSON.stringify({ notes: arr }));
		clipApi.call("add_new_notes", d);
	} catch (e) {
		post("Voice Splitter: add_new_notes failed (" + e + ")\n");
	}
	if (d) { try { d.freepeer(); } catch (e1) {} }

	// Verify, and fall back to the legacy note API if nothing landed.
	var written = 0;
	try { written = readNotes(clipApi, 1e6).length; } catch (e2) {}
	if (written >= arr.length) return true;

	try {
		clipApi.call("set_notes");
		clipApi.call("notes", arr.length);
		for (var j = 0; j < arr.length; j++) {
			clipApi.call("note", arr[j].pitch, arr[j].start_time,
				arr[j].duration, arr[j].velocity, arr[j].mute);
		}
		clipApi.call("done");
		return true;
	} catch (e3) {
		post("Voice Splitter: legacy set_notes also failed (" + e3 + ")\n");
		return false;
	}
}

function applyClipProps(clipApi, p) {
	// Widen the loop before narrowing it, otherwise Live clamps loop_start.
	try {
		clipApi.set("looping", 1);
		clipApi.set("loop_end", p.loopEnd);
		clipApi.set("loop_start", p.loopStart);
		clipApi.set("end_marker", p.endMarker);
		clipApi.set("start_marker", p.startMarker);
		clipApi.set("looping", p.looping);
		clipApi.set("signature_numerator", p.sigNum);
		clipApi.set("signature_denominator", p.sigDen);
	} catch (e) {}
}

function firstEmptySlot(trackIdx) {
	var t = new LiveAPI(nop, "live_set tracks " + trackIdx);
	var n = t.getcount("clip_slots");
	for (var s = 0; s < n; s++) {
		var cs = new LiveAPI(nop, "live_set tracks " + trackIdx + " clip_slots " + s);
		if (g1(cs, "has_clip") != 1) return s;
	}
	return 0;
}

// Strip a freshly duplicated track back to just its instrument chain.
function cleanTrack(trackIdx, selfDeviceIdx) {
	var t = new LiveAPI(nop, "live_set tracks " + trackIdx);
	if (selfDeviceIdx >= 0) {
		try { t.call("delete_device", selfDeviceIdx); } catch (e) {}
	}
	var n = t.getcount("clip_slots");
	for (var s = 0; s < n; s++) {
		var cs = new LiveAPI(nop, "live_set tracks " + trackIdx + " clip_slots " + s);
		if (g1(cs, "has_clip") == 1) cs.call("delete_clip");
	}
	var ac = t.get("arrangement_clips");
	if (ac instanceof Array) {
		for (var k = 1; k < ac.length; k += 2) {
			try { callWithObj(t, "delete_clip", ac[k]); } catch (e2) {}
		}
	}
}

// ------------------------------------------------------------------- main

function split() {
	try {
		doSplit();
	} catch (e) {
		status("Error: " + e);
		post("Voice Splitter: " + e + "\n");
	}
}

function doSplit() {
	readSettings();

	var live = new LiveAPI(nop, "live_set");

	var clip = getSourceClip();
	if (!clip) { status("No clip selected - click a MIDI clip first"); return; }
	if (g1(clip, "is_midi_clip") != 1) { status("That clip is audio, not MIDI"); return; }

	var srcPath = clip.unquotedpath;
	var tm = srcPath.match(/tracks (\d+)/);
	if (!tm) { status("Cannot locate the clip's track"); return; }
	var srcTrackIdx = parseInt(tm[1], 10);

	var isArr = g1(clip, "is_arrangement_clip") == 1;
	var slotIdx = 0;
	if (!isArr) {
		var sm = srcPath.match(/clip_slots (\d+)/);
		if (sm) slotIdx = parseInt(sm[1], 10);
	}

	var props = {
		looping: g1(clip, "looping"),
		loopStart: g1(clip, "loop_start"),
		loopEnd: g1(clip, "loop_end"),
		startMarker: g1(clip, "start_marker"),
		endMarker: g1(clip, "end_marker"),
		sigNum: g1(clip, "signature_numerator"),
		sigDen: g1(clip, "signature_denominator")
	};
	var clipName = String(g1(clip, "name"));
	var srcStartTime = isArr ? g1(clip, "start_time") : 0;

	var notes = readNotes(clip, Math.max(props.loopEnd, props.endMarker) + 1);
	if (!notes.length) { status("That clip has no notes"); return; }

	var res;
	if (gMode == MODE_PERNOTE) res = splitPerNote(notes);
	else if (gMode == MODE_POLY) res = splitPoly(notes);
	else res = splitPitchOrder(notes);

	// Drop any gaps left by sparse voice indices.
	var voices = [];
	var names = [];
	for (var i = 0; i < res.voices.length; i++) {
		if (res.voices[i] && res.voices[i].length) {
			voices.push(res.voices[i]);
			if (res.names) names.push(res.names[i]);
		}
	}
	var n = voices.length;
	if (n < 2) { status("Only one voice here - nothing to split"); return; }

	var maxEnd = 0;
	for (var q = 0; q < notes.length; q++) {
		var e = notes[q].start_time + notes[q].duration;
		if (e > maxEnd) maxEnd = e;
	}
	var clipLen = Math.max(props.loopEnd, props.endMarker, maxEnd, 1);

	var srcTrack = new LiveAPI(nop, "live_set tracks " + srcTrackIdx);
	var srcTrackName = String(g1(srcTrack, "name"));

	// If this device sits directly on the source track, the duplicates will
	// carry a copy of it - find its index so we can strip it back off.
	var selfDevIdx = -1;
	var devApi = new LiveAPI(nop, "this_device");
	var dm = String(devApi.unquotedpath).match(/^live_set tracks (\d+) devices (\d+)$/);
	if (dm && parseInt(dm[1], 10) == srcTrackIdx) selfDevIdx = parseInt(dm[2], 10);

	try { live.call("begin_undo_step"); } catch (eu) {}

	var firstNew = srcTrackIdx + 1;
	if (gCopyInst) {
		// Duplicate once, strip it to a bare instrument chain, then clone that.
		live.call("duplicate_track", srcTrackIdx);
		cleanTrack(firstNew, selfDevIdx);
		for (var d = 1; d < n; d++) live.call("duplicate_track", firstNew);
	} else {
		for (var c = 0; c < n; c++) live.call("create_midi_track", firstNew + c);
	}

	for (var v = 0; v < n; v++) {
		var ti = firstNew + v;
		var tApi = new LiveAPI(nop, "live_set tracks " + ti);
		var suffix = names.length ? names[v] : ("V" + (v + 1));
		tApi.set("name", srcTrackName + " " + suffix);

		var targetSlot = isArr ? firstEmptySlot(ti) : slotIdx;
		var slotPath = "live_set tracks " + ti + " clip_slots " + targetSlot;
		var slot = new LiveAPI(nop, slotPath);
		if (g1(slot, "has_clip") == 1) slot.call("delete_clip");
		slot.call("create_clip", clipLen);

		var nc = new LiveAPI(nop, slotPath + " clip");
		nc.set("name", clipName + " " + suffix);
		writeNotes(nc, voices[v]);
		applyClipProps(nc, props);

		if (isArr) {
			callWithObj(tApi, "duplicate_clip_to_arrangement", nc.id, srcStartTime);
			slot.call("delete_clip");
		}
	}

	try { live.call("end_undo_step"); } catch (eu2) {}

	var msg = "Split into " + n + " tracks";
	if (res.overflow) msg += " (" + res.overflow + " extra pitches merged into the last)";
	status(msg);
}
