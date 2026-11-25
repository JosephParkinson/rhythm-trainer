/** Note-on from any connected MIDI input. `timeStamp` shares performance.now()'s clock. */
export type NoteHandler = (note: number, velocity: number, timeStamp: number) => void;

/** Listens to every MIDI input, including ones plugged in later. Resolves false if unavailable. */
export async function initMidi(onNote: NoteHandler, onDevices: (names: string[]) => void): Promise<boolean> {
  if (!navigator.requestMIDIAccess) return false;
  let access: MIDIAccess;
  try {
    access = await navigator.requestMIDIAccess();
  } catch {
    return false;
  }

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
