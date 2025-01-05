#!/usr/bin/env python3
"""
OpenWakeWord detector for "Hey Jarvis" wake word.
This script should be run from within the virtual environment.
"""

import openwakeword
import pyaudio
import numpy as np
import soundfile as sf
from openwakeword.utils import download_models
import logging
import os
from datetime import datetime

# Enable logging
logging.basicConfig(level=logging.INFO)

# Create directory for audio samples
os.makedirs("debug_audio", exist_ok=True)

# Download required models first
print("Downloading models...")
download_models(["hey_jarvis"])

# Initialize wake word model with explicit ONNX model
print("Initializing model...")
model = openwakeword.Model(
    wakeword_models=["hey_jarvis"],
    inference_framework="onnx"
)

# Set up audio parameters
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000  # Required by OpenWakeWord
CHUNK = 1280  # Optimal for OpenWakeWord

# Initialize PyAudio
p = pyaudio.PyAudio()

# List available audio devices
print("Available audio devices:")
for i in range(p.get_device_count()):
    dev = p.get_device_info_by_index(i)
    print(f"{i}: {dev['name']} (in: {dev['maxInputChannels']}, out: {dev['maxOutputChannels']})")

# Set default input device (use PipeWire on Linux)
if os.name == 'posix' and os.uname().sysname == 'Linux':
    # Try to find PipeWire device
    pipewire_device = None
    for i in range(p.get_device_count()):
        dev = p.get_device_info_by_index(i)
        if 'pipewire' in dev['name'].lower():
            pipewire_device = i
            break
    
    if pipewire_device is not None:
        print(f"Using PipeWire device: {p.get_device_info_by_index(pipewire_device)['name']}")
        default_device = pipewire_device
    else:
        print("PipeWire device not found, using system default")
        default_device = p.get_default_input_device_info()['index']
else:
    default_device = p.get_default_input_device_info()['index']

# Keep a buffer of recent audio for debugging
audio_buffer = []
BUFFER_CHUNKS = 20  # Keep about 1.6 seconds of audio

try:
    # Start audio stream
    print("Starting audio stream...")
    stream = p.open(
        format=FORMAT,
        channels=CHANNELS,
        rate=RATE,
        input=True,
        input_device_index=default_device,
        frames_per_buffer=CHUNK
    )

    print("#"*50)
    print("Listening for wake word 'Hey Jarvis'...")
    print("#"*50)
    print("Note: When speaking, try to:")
    print("1. Speak clearly and at a normal volume")
    print("2. Be in a quiet environment")
    print("3. Say 'Hey Jarvis' naturally")
    print("Any detected audio will be saved to the 'debug_audio' folder")

    while True:
        # Get audio
        audio_data = np.frombuffer(stream.read(CHUNK), dtype=np.int16)
        
        # Get prediction scores from the model
        prediction = model.predict(audio_data)
        
        # Get the scores from the prediction buffer
        scores = list(model.prediction_buffer["hey_jarvis"])
        current_score = scores[-1]  # Get the latest score
        
        # Clear line and update score (improved formatting)
        print(f"\rCurrent score: {current_score:.4f}", flush=True, end='')
        if current_score > 0.55:
            print(f"\nDETECTED! Score: {current_score:.4f}", flush=True)
        
        # If we detect something, save the audio for debugging
        if current_score > 0.1:
            # Update audio buffer
            audio_buffer.append(audio_data.copy())
            if len(audio_buffer) > BUFFER_CHUNKS:
                audio_buffer.pop(0)
                
            # Save the audio buffer if detection is strong
            if current_score > 0.5:
                timestamp = datetime.now().strftime("%H-%M-%S")
                buffer_audio = np.concatenate(audio_buffer)
                filename = f"debug_audio/detection_{timestamp}_{current_score:.3f}.wav"
                sf.write(filename, buffer_audio.astype(np.float32) / 32768.0, RATE)
            
except KeyboardInterrupt:
    print("Stopping...")
except Exception as e:
    print(f"Error: {e}")
finally:
    # Clean up
    if 'stream' in locals():
        stream.stop_stream()
        stream.close()
    p.terminate()
