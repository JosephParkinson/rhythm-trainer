import sounddevice as sd
import soundfile as sf 
import numpy as np

print("\nAVAILABLE AUDIO DEVICES\n")

for i, device in enumerate(sd.query_devices()):
    print(
        f"{i}: {device['name']}"
        f"| inputs: {device['max_input_channels']}"
        f"| outputs {device['max_output_channels']}"
    )

device_id = int(input("\nEnter your interface's device number: "))

device = sd.query_devices(device_id)

channels = min(2, device['max_input_channels'])
sample_rate = int(device['default_samplerate'])

if channels < 1:
    raise RuntimeError("Selected device has no audio inputs")

duration = 5

print(f"\nrecording for {duration} seconds")

recording = sd.rec(
    int(duration * sample_rate),
    samplerate=sample_rate,
    channels=channels,
    dtype="float32",
    device=device_id
)

sd.wait()

sf.write("test.wav", recording, sample_rate)

print("recording saved")

peak = np.max(np.abs(recording))
rms = np.sqrt(np.mean(recording**2))

print(f"peak amplitude: {peak:.4f}")
print(f"RMS amplitude: {rms:.4f}")