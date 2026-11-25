
import numpy as np
import sounddevice as sd
import soundfile as sf

# -----------------------------
# CONFIGURATION
# -----------------------------

BPM = 80
BEATS_PER_BAR = 4
COUNT_IN_BARS = 2
EXERCISE_BARS = 4

SAMPLE_RATE = 44100

# -----------------------------
# FIND AUDIO INTERFACE
# -----------------------------

print("\nAVAILABLE DEVICES")

for i, d in enumerate(sd.query_devices()):
    print(
        f"{i}: {d['name']} "
        f"(in: {d['max_input_channels']}, "
        f"out: {d['max_output_channels']})"
    )

device_id = int(input("\nSelect Komplete Audio 1: "))

# -----------------------------
# GENERATE METRONOME
# -----------------------------

beat_duration = 60 / BPM
total_bars = COUNT_IN_BARS + EXERCISE_BARS
total_beats = total_bars * BEATS_PER_BAR

duration = total_beats * beat_duration + 2

num_samples = int(duration * SAMPLE_RATE)

click_track = np.zeros((num_samples, 2), dtype=np.float32)

def add_click(position, frequency=1000, volume=0.5):
    start = int(position * SAMPLE_RATE)
    length = int(0.025 * SAMPLE_RATE)

    t = np.arange(length) / SAMPLE_RATE

    click = volume * np.sin(2 * np.pi * frequency * t)
    click *= np.exp(-t * 120)

    end = min(start + length, num_samples)

    click_track[start:end, 0] += click[:end-start]
    click_track[start:end, 1] += click[:end-start]


# Schedule quarter-note clicks
for beat in range(total_beats):

    position = beat * beat_duration

    # Stronger click on the first beat of each bar
    if beat % BEATS_PER_BAR == 0:
        add_click(position, frequency=1500, volume=0.6)
    else:
        add_click(position, frequency=1000, volume=0.35)


# -----------------------------
# RECORD BASS + PLAY CLICK
# -----------------------------

print("\nGet ready!")

print(f"Tempo: {BPM} BPM")
print(f"Count-in: {COUNT_IN_BARS} bars")
print(f"Exercise: {EXERCISE_BARS} bars of eighth notes")

input("\nPress ENTER to start...")

print("\nRecording! Play eighth notes after the count-in.")

recording = sd.playrec(
    click_track,
    samplerate=SAMPLE_RATE,
    channels=1,
    dtype="float32",
    device=(device_id, device_id),
    input_mapping=[2],
    output_mapping=[1, 2],
    blocking=True
)

sf.write("rhythm_test.wav", recording, SAMPLE_RATE)

print("\nRecording complete!")
print("Saved rhythm_test.wav")
