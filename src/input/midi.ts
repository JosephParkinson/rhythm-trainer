/** Note-on from any connected MIDI input. `timeStamp` shares performance.now()'s clock. */
export type NoteHandler = (note: number, velocity: number, timeStamp: number) => void;

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
export async function initMidi(onNote: NoteHandler, onDevices: (names: string[]) => void): Promise<boolean> {
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
    // Note-on with velocity 0 is a note-off.
    if ((d[0] & 0xf0) === 0x90 && d[2] > 0) onNote(d[1], d[2] / 127, e.timeStamp);
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
