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
import platform

# Completely suppress ALSA errors
os.environ['PYTHONWARNINGS'] = 'ignore::RuntimeWarning'
if platform.system() == 'Linux':
    # Redirect all error output to devnull
    devnull = os.open(os.devnull, os.O_WRONLY)
    os.dup2(devnull, 2)
    os.close(devnull)
    
    # Prevent JACK from starting
    os.environ['JACK_NO_START_SERVER'] = '1'
    os.environ['JACK_NO_AUDIO_RESERVATION'] = '1'

# Configure minimal logging
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

# Create directory for audio samples
os.makedirs("debug_audio", exist_ok=True)

# Initialize wake word detection
logger.info("Initializing wake word detection...")
download_models(["hey_jarvis"])
model = openwakeword.Model(
    wakeword_models=["hey_jarvis"],
    inference_framework="onnx"
)

# Audio parameters
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 1280

def find_input_device():
    """Find available audio input device"""
    p = pyaudio.PyAudio()
    try:
        # Try to find PipeWire first on Linux
        if platform.system() == 'Linux':
            for i in range(p.get_device_count()):
                dev_info = p.get_device_info_by_index(i)
                if dev_info.get('maxInputChannels') > 0 and 'pipewire' in dev_info.get('name', '').lower():
                    return dev_info['index'], dev_info
        
        # Otherwise get default input device
        info = p.get_default_input_device_info()
        return info['index'], info
    except:
        return None, None
    finally:
        p.terminate()

# Find audio input device
device_index, device_info = find_input_device()
if device_index is None:
    logger.error("\nNo audio input device found")
    if platform.system() == 'Linux':
        logger.error("Please connect a microphone and ensure PipeWire is running:")
        logger.error("1. Connect a USB microphone or audio HAT")
        logger.error("2. Run: sudo apt install pipewire")
        logger.error("3. Run: systemctl --user start pipewire")
    else:
        logger.error("Please connect a microphone to your device")
    sys.exit(1)

# Initialize audio
p = pyaudio.PyAudio()
try:
    logger.info("\nStarting audio capture...")
    logger.info(f"Using audio device: {device_info['name']}")
    stream = p.open(
        format=FORMAT,
        channels=CHANNELS,
        rate=RATE,
        input=True,
        input_device_index=device_index,
        frames_per_buffer=CHUNK
    )

    logger.info("Ready! Say 'Hey Jarvis' to test wake word detection")
    logger.info("(Audio samples will be saved to the debug_audio folder)")

    logger.info("#" * 50)
    logger.info("Listening for wake word 'Hey Jarvis'...")
    logger.info("#" * 50)
    logger.info("Note: When speaking, try to:")
    logger.info("1. Speak clearly and at a normal volume")
    logger.info("2. Be in a quiet environment")
    logger.info("3. Say 'Hey Jarvis' naturally")
    logger.info("Any detected audio will be saved to the 'debug_audio' folder")

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
