export interface NoteEvent {
  /** note-on (true) or note-off (false) */
  on: boolean;
  note: number;
  /** 0–15 */
  channel: number;
  /** 0–1; 0 for note-off */
  vel: number;
  /** shares performance.now()'s clock */
  timeStamp: number;
}

/** The access currently listened to; replaced (and detached) on rescan so notes never arrive twice. */
let current: MIDIAccess | null = null;

function detach(access: MIDIAccess) {
  access.onstatechange = null;
  access.inputs.forEach((input) => (input.onmidimessage = null));
}

/**
 * Listens to every MIDI input, including ones plugged in later. Calling it
 * again rescans from scratch. Resolves false if MIDI is unavailable or refused.
 */
export async function initMidi(onNote: (e: NoteEvent) => void, onDevices: (names: string[]) => void): Promise<boolean> {
  if (!navigator.requestMIDIAccess) return false;
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return false;
  }
  if (current) detach(current);
  current = access;

  const onMessage = (e: MIDIMessageEvent) => {
    const d = e.data;
    if (!d || d.length < 3) return;
    const type = d[0] & 0xf0;
    const channel = d[0] & 0x0f;
    // Note-on with velocity 0 is a note-off.
    if (type === 0x90 && d[2] > 0) onNote({ on: true, note: d[1], channel, vel: d[2] / 127, timeStamp: e.timeStamp });
    else if (type === 0x80 || type === 0x90) onNote({ on: false, note: d[1], channel, vel: 0, timeStamp: e.timeStamp });
  };

  const attach = () => {
    const names: string[] = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      if (input.state === 'connected') names.push(input.name || 'MIDI');
    });
    onDevices(names);
  };

  access.onstatechange = attach;
  attach();
  return true;
}
