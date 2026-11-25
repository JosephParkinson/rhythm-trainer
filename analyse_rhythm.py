
import numpy as np
import soundfile as sf
import matplotlib.pyplot as plt

from note_onset_detector import detect_onsets

# -----------------------------
# CONFIGURATION
# -----------------------------

BPM = 80
BEATS_PER_BAR = 4
COUNT_IN_BARS = 2
EXERCISE_BARS = 4

NOTES_PER_BEAT = 2  # Eighth notes
TOLERANCE = 0.15     # Maximum matching error, seconds

CALIBRATION_LATENCY = 0.29847

# -----------------------------
# LOAD RECORDING
# -----------------------------

audio, sr = sf.read("rhythm_test.wav")

onsets, envelope = detect_onsets(audio, sr)

# Correct for measured audio round-trip latency
onsets = onsets - CALIBRATION_LATENCY

if audio.ndim == 2:
    audio = audio.mean(axis=1)

# -----------------------------
# GENERATE EXPECTED POSITIONS
# -----------------------------

beat_duration = 60 / BPM
subdivision = beat_duration / NOTES_PER_BEAT

exercise_start = COUNT_IN_BARS * BEATS_PER_BAR * beat_duration

num_notes = (
    EXERCISE_BARS
    * BEATS_PER_BAR
    * NOTES_PER_BEAT
)

expected = (
    exercise_start
    + np.arange(num_notes) * subdivision
)

# -----------------------------
# MATCH DETECTED NOTES
# -----------------------------

available = list(enumerate(onsets))

matches = []
missed = []
extras = []

cursor = 0

for note_index, target in enumerate(expected):

    # Discard detections that are too early to match
    while (
        cursor < len(available)
        and available[cursor][1] < target - TOLERANCE
    ):
        extras.append(available[cursor])
        cursor += 1

    # Find detections within the matching window
    candidates = []

    j = cursor

    while (
        j < len(available)
        and available[j][1] <= target + TOLERANCE
    ):
        candidates.append(j)
        j += 1

    if not candidates:
        missed.append(note_index)
        continue

    # Choose the closest detection
    best = min(
        candidates,
        key=lambda k: abs(available[k][1] - target)
    )

    # Any earlier candidates are unmatched extras
    extras.extend(available[cursor:best])

    detection_index, actual = available[best]

    matches.append({
        "note": note_index + 1,
        "expected": target,
        "actual": actual,
        "error": actual - target,
        "detection_index": detection_index
    })

    cursor = best + 1

# Remaining detections are extras
extras.extend(available[cursor:])

# -----------------------------
# CALCULATE STATISTICS
# -----------------------------

errors = np.array([
    m["error"] for m in matches
])

print("\n" + "=" * 35)
print("       RHYTHM ANALYSIS")
print("=" * 35)

print(f"Tempo:             {BPM} BPM")
print(f"Subdivision:       8th notes")
print(f"Expected notes:    {num_notes}")
print(f"Detected matches:  {len(matches)}")
print(f"Missed notes:      {len(missed)}")
print(f"Extra detections:  {len(extras)}")

if len(errors):

    print("\nTIMING STATISTICS")

    print(
        f"Mean absolute error: "
        f"{np.mean(np.abs(errors))*1000:.1f} ms"
    )

    print(
        f"Mean timing bias:    "
        f"{np.mean(errors)*1000:+.1f} ms"
    )

    print(
        f"Median timing bias:  "
        f"{np.median(errors)*1000:+.1f} ms"
    )

    print(
        f"Timing standard dev: "
        f"{np.std(errors)*1000:.1f} ms"
    )

    print(
        f"90th percentile:     "
        f"{np.percentile(np.abs(errors), 90)*1000:.1f} ms"
    )

# -----------------------------
# INDIVIDUAL NOTE RESULTS
# -----------------------------

print("\nINDIVIDUAL NOTES")
print("-" * 35)

matched_by_note = {
    m["note"]: m for m in matches
}

for i in range(num_notes):

    if i + 1 in matched_by_note:
        m = matched_by_note[i + 1]

        print(
            f"Note {i+1:02d}: "
            f"{m['error']*1000:+7.1f} ms"
        )
    else:
        print(f"Note {i+1:02d}: MISSED")

# -----------------------------
# VISUALISATION
# -----------------------------

fig, axes = plt.subplots(
    2, 1,
    figsize=(13, 8),
    gridspec_kw={"height_ratios": [2, 1]}
)

# Waveform and detected attacks
time = np.arange(len(audio)) / sr

axes[0].plot(time, audio, linewidth=0.4, color="steelblue")

for onset in onsets:
    axes[0].axvline(
        onset,
        color="grey",
        alpha=0.4,
        linewidth=0.8
    )

for target in expected:
    axes[0].axvline(
        target,
        color="green",
        alpha=0.5,
        linestyle="--"
    )

axes[0].set_title("Recording: Detected vs Expected")
axes[0].set_xlabel("Time (seconds)")
axes[0].set_ylabel("Amplitude")

# Timing error plot
note_numbers = [m["note"] for m in matches]
errors_ms = [m["error"] * 1000 for m in matches]

axes[1].axhline(0, color="black", linewidth=1)
axes[1].axhline(20, color="grey", linestyle="--", alpha=0.5)
axes[1].axhline(-20, color="grey", linestyle="--", alpha=0.5)

axes[1].scatter(
    note_numbers,
    errors_ms,
    s=35
)

for note in missed:
    axes[1].scatter(
        note + 1,
        0,
        marker="x",
        color="red",
        s=70
    )

axes[1].set_title("Timing Error Per Note")
axes[1].set_xlabel("Note number")
axes[1].set_ylabel("Error (ms)")

axes[1].set_xticks(range(1, num_notes + 1))
axes[1].grid(alpha=0.2)

plt.tight_layout()
plt.show()
