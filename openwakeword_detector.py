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
import sys
from datetime import datetime
import warnings
import ctypes
import ctypes.util

# Suppress ALSA errors
try:
    # Find the ALSA library
    asound = ctypes.CDLL(ctypes.util.find_library('asound'))
    # Set error handler to ignore errors
    error_handler = ctypes.c_void_p()
    asound.snd_lib_error_set_handler(error_handler)
except:
    # If we can't load ALSA, redirect stderr
    devnull = os.open(os.devnull, os.O_WRONLY)
    old_stderr = os.dup(2)
    sys.stderr.flush()
    os.dup2(devnull, 2)
    os.close(devnull)

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

def check_audio_input():
    """Check if any audio input devices are available"""
    p = pyaudio.PyAudio()
    input_devices = []
    
    try:
        for i in range(p.get_device_count()):
            dev_info = p.get_device_info_by_index(i)
            if dev_info.get('maxInputChannels') > 0:
                input_devices.append(dev_info)
    finally:
        p.terminate()
    
    return input_devices

# Check for audio input devices first
input_devices = check_audio_input()
if not input_devices:
    print("\nError: No audio input devices found!")
    print("Please check that:")
    print("1. A microphone is properly connected to your device")
    print("2. The microphone is recognized by your system (try 'arecord -l')")
    print("3. You have the necessary permissions to access audio devices")
    sys.exit(1)

# Initialize PyAudio
p = pyaudio.PyAudio()

# List and select audio device
print("\nAvailable audio input devices:")
selected_device_index = None

for device in input_devices:
    print(f"Input Device id {device['index']} - {device['name']}")
    # Prefer PipeWire, then Pulse, then default
    if 'pipewire' in device['name'].lower():
        selected_device_index = device['index']
        print(f"Selected PipeWire device: {device['name']}")
        break
    elif 'pulse' in device['name'].lower() and selected_device_index is None:
        selected_device_index = device['index']
        print(f"Selected Pulse device: {device['name']}")

if selected_device_index is None and input_devices:
    selected_device_index = input_devices[0]['index']
    print(f"Using first available device: {input_devices[0]['name']}")

try:
    # Start audio stream
    print("\nStarting audio stream...")
    stream = p.open(
        format=FORMAT,
        channels=CHANNELS,
        rate=RATE,
        input=True,
        input_device_index=selected_device_index,
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

    # Keep a buffer of recent audio for debugging
    audio_buffer = []
    BUFFER_CHUNKS = 20  # Keep about 1.6 seconds of audio

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
