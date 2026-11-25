
import numpy as np
import sounddevice as sd
from scipy.signal import find_peaks

SAMPLE_RATE = 44100
NUM_CLICKS = 10
CLICK_INTERVAL = 1.0
CLICK_DURATION = 0.02
CLICK_FREQUENCY = 1000

# Generate a short, clearly identifiable click
def make_click():
    t = np.arange(int(CLICK_DURATION * SAMPLE_RATE)) / SAMPLE_RATE
    click = np.sin(2 * np.pi * CLICK_FREQUENCY * t)
    click *= np.hanning(len(click))
    return click * 0.5


def main():
    print("Available audio devices:")
    print(sd.query_devices())
    print("\nDefault devices:", sd.default.device)
    print("\nDevice information:")

    for i, device in enumerate(sd.query_devices()):
        print(
            f"{i}: {device['name']} | "
            f"Inputs: {device['max_input_channels']} | "
            f"Outputs: {device['max_output_channels']} | "
            f"Default low latency: {device['default_low_input_latency']:.3f}s / "
            f"{device['default_low_output_latency']:.3f}s"
        )

    input("Press Enter when ready to calibrate...")

    click = make_click()

    # Leave a little silence before the first click
    duration = 2 + NUM_CLICKS * CLICK_INTERVAL
    output = np.zeros(int(duration * SAMPLE_RATE))

    scheduled_times = []

    for i in range(NUM_CLICKS):
        start_time = 1.0 + i * CLICK_INTERVAL
        start_sample = int(start_time * SAMPLE_RATE)
        output[start_sample:start_sample + len(click)] += click
        scheduled_times.append(start_time)

    print("Playing clicks and recording...")

    recording = sd.playrec(
        output,
        samplerate=SAMPLE_RATE,
        channels=1,
        device=(3, 3),
        blocking=True
    )

    recording = recording.flatten()

    # Detect each click in a window around its scheduled time
    detected_times = []

    for scheduled_time in scheduled_times:
        start = int((scheduled_time - 0.1) * SAMPLE_RATE)
        end = int((scheduled_time + 0.5) * SAMPLE_RATE)

        segment = recording[start:end]

        # Estimate background noise from the first 50 ms
        noise = np.max(np.abs(segment[:int(0.05 * SAMPLE_RATE)]))

        # Find the first sample significantly above background
        threshold = max(noise * 5, 0.005)

        indices = np.where(np.abs(segment) > threshold)[0]

        if len(indices) == 0:
            print(f"No click detected near {scheduled_time}s")
            continue

        detected_sample = start + indices[0]
        detected_times.append(detected_sample / SAMPLE_RATE)

    detected_times = np.array(detected_times)

    print("\nScheduled clicks:", len(scheduled_times))
    print("Detected clicks:", len(detected_times))

    if len(detected_times) != NUM_CLICKS:
        print("\nUnexpected number of detections.")
        print("Detected times:", detected_times)
        print("Check your input gain and connections.")
        return

    latencies = (
        np.array(detected_times) - np.array(scheduled_times)
    ) * 1000

    print("\nLATENCY RESULTS")
    print("----------------")
    print(f"Mean latency:   {np.mean(latencies):.2f} ms")
    print(f"Median latency: {np.median(latencies):.2f} ms")
    print(f"Std deviation:  {np.std(latencies):.2f} ms")
    print(f"Min latency:    {np.min(latencies):.2f} ms")
    print(f"Max latency:    {np.max(latencies):.2f} ms")

    print("\nIndividual measurements:")
    for i, latency in enumerate(latencies):
        print(f"Click {i + 1}: {latency:.2f} ms")


if __name__ == "__main__":
    main()
