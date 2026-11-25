import numpy as np
import soundfile as sf
import matplotlib.pyplot as plt

from scipy.signal import butter, sosfiltfilt, find_peaks
from scipy.ndimage import uniform_filter1d


def detect_onsets(
    audio,
    sample_rate,
    min_interval=0.25,
    sensitivity=0.025,
):
    """
    Detect note attacks using positive changes in the
    amplitude envelope rather than absolute amplitude.
    """

    # Convert stereo to mono
    if audio.ndim == 2:
        audio = np.mean(audio, axis=1)

    # High-pass filter
    sos = butter(
        2,
        80,
        btype="highpass",
        fs=sample_rate,
        output="sos"
    )

    filtered = sosfiltfilt(sos, audio)

    # Calculate RMS envelope
    window_size = int(sample_rate * 0.005)
    hop_size = int(sample_rate * 0.002)

    envelope = []

    for i in range(0, len(filtered) - window_size, hop_size):
        window = filtered[i:i + window_size]
        envelope.append(np.sqrt(np.mean(window ** 2)))

    envelope = np.array(envelope)

    # Smooth envelope slightly
    envelope = uniform_filter1d(envelope, size=3)

    # Calculate positive changes in amplitude
    onset_strength = np.maximum(
        0,
        np.diff(envelope, prepend=envelope[0])
    )

    # Smooth onset strength
    onset_strength = uniform_filter1d(
        onset_strength,
        size=3
    )

    # Detect attack peaks
    noise_level = np.median(onset_strength)
    noise_mad = np.median(
        np.abs(onset_strength - noise_level)
    )

    threshold = noise_level + 2.5 * noise_mad

    prominence = max(
        np.max(onset_strength) * sensitivity,
        noise_mad * 2
    )

    min_distance = int(
        min_interval * sample_rate / hop_size
    )

    peaks, properties = find_peaks(
        onset_strength,
        height=threshold,
        prominence=prominence,
        distance=min_distance
    )

    # Backtrack from the attack peak to its beginning
    onset_indices = []

    for peak in peaks:
        peak_strength = onset_strength[peak]
        cutoff = peak_strength * 0.15

        start = peak

        while start > 0 and onset_strength[start] > cutoff:
            start -= 1

        onset_indices.append(start)

    # Convert to seconds
    onset_times = (
        np.array(onset_indices) * hop_size / sample_rate
    )

    return onset_times, envelope

if __name__ == "__main__":
    # Load recording
    audio, sample_rate = sf.read("test.wav")

    onsets, envelope = detect_onsets(audio, sample_rate)

    print("\nDETECTED NOTE ONSETS")
    for i, onset in enumerate(onsets):
        print(f"Note {i + 1}: {onset:.4f}s")

    # Plot results
    time = np.arange(len(audio)) / sample_rate
    envelope_time = np.arange(len(envelope)) * 0.002

    if audio.ndim == 2:
        audio = np.mean(audio, axis=1)

    fig, axes = plt.subplots(2, 1, figsize=(12, 7))

    axes[0].plot(time, audio, linewidth=0.5)
    axes[0].set_title("Bass Recording")
    axes[0].set_ylabel("Amplitude")

    for onset in onsets:
        axes[0].axvline(onset, color="red", alpha=0.6)

    axes[1].plot(envelope_time, envelope)
    axes[1].set_title("Amplitude Envelope")
    axes[1].set_xlabel("Time (seconds)")
    axes[1].set_ylabel("RMS Amplitude")

    for onset in onsets:
        axes[1].axvline(onset, color="red", alpha=0.6)

    plt.tight_layout()
    plt.show()