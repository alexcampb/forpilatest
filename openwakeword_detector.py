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

# Audio settings
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000  # Default rate
CHUNK = 4096  # Increased buffer size for higher sample rates

def get_supported_sample_rate(p, device_index, preferred_rate=16000):
    """Get a supported sample rate for the device"""
    try:
        # Try the preferred rate first
        p.is_format_supported(
            preferred_rate,
            input_device=device_index,
            input_channels=CHANNELS,
            input_format=FORMAT
        )
        return preferred_rate
    except:
        # If preferred rate fails, try common rates
        common_rates = [44100, 48000, 32000, 22050, 16000, 8000]
        for rate in common_rates:
            try:
                p.is_format_supported(
                    rate,
                    input_device=device_index,
                    input_channels=CHANNELS,
                    input_format=FORMAT
                )
                logger.info(f"Using alternative sample rate: {rate} Hz")
                return rate
            except:
                continue
    return None

def find_input_device():
    """Find available audio input device"""
    p = pyaudio.PyAudio()
    try:
        # First try to find P10S USB device
        for i in range(p.get_device_count()):
            dev_info = p.get_device_info_by_index(i)
            if dev_info.get('maxInputChannels') > 0:
                name = dev_info.get('name', '').lower()
                if 'monitor' not in name:  # Skip monitor devices
                    if 'p10s' in name:  # Look for P10S device
                        logger.info(f"Found P10S USB audio device: {dev_info['name']}")
                        return dev_info['index'], dev_info
        
        # Then try to find PipeWire on Linux
        if platform.system() == 'Linux':
            for i in range(p.get_device_count()):
                dev_info = p.get_device_info_by_index(i)
                if dev_info.get('maxInputChannels') > 0:
                    name = dev_info.get('name', '').lower()
                    if 'monitor' not in name:
                        if 'pipewire' in name:
                            logger.info(f"Found PipeWire device: {dev_info['name']}")
                            return dev_info['index'], dev_info
        
        # Finally fall back to default input device
        info = p.get_default_input_device_info()
        if info and info.get('maxInputChannels') > 0 and 'monitor' not in info.get('name', '').lower():
            logger.info(f"Using default input device: {info['name']}")
            return info['index'], info
        
        logger.error("No suitable audio input device found")
    except Exception as e:
        logger.error(f"Error finding audio input device: {str(e)}")
    finally:
        p.terminate()
    return None, None

def resample_audio(audio_data, from_rate, to_rate):
    """Resample audio data to target rate"""
    if from_rate == to_rate:
        return audio_data
    duration = len(audio_data) / from_rate
    target_length = int(duration * to_rate)
    return np.interp(
        np.linspace(0, len(audio_data), target_length, endpoint=False),
        np.arange(len(audio_data)),
        audio_data
    )

# Find audio input device
device_index, device_info = find_input_device()
if device_index is None:
    logger.error("\nNo audio input device found")
    if platform.system() == 'Linux':
        logger.error("Please connect a microphone (USB microphone or audio HAT)")
        logger.error("Recommended options:")
        logger.error("1. USB microphone")
        logger.error("2. ReSpeaker HAT")
        logger.error("3. USB sound card with microphone input")
    else:
        logger.error("Please connect a microphone to your device")
    sys.exit(1)

# Initialize audio
p = pyaudio.PyAudio()
try:
    logger.info("\nStarting audio capture...")
    if device_info:
        logger.info(f"Using audio device: {device_info['name']}")
    
    # Get supported sample rate
    sample_rate = get_supported_sample_rate(p, device_index)
    if sample_rate is None:
        logger.error("Could not find a supported sample rate for the device")
        sys.exit(1)
    
    stream = p.open(
        format=FORMAT,
        channels=CHANNELS,
        rate=sample_rate,
        input=True,
        input_device_index=device_index,
        frames_per_buffer=CHUNK
    )

    logger.info("Ready! Say 'Hey Jarvis' to test wake word detection")
    logger.info("(Audio samples will be saved to the debug_audio folder)")
    print("#" * 50)
    logger.info("Listening for wake word 'Hey Jarvis'...")
    print("#" * 50)
    
    logger.info("Note: When speaking, try to:")
    logger.info("1. Speak clearly and at a normal volume")
    logger.info("2. Be in a quiet environment")
    logger.info("3. Say 'Hey Jarvis' naturally")
    logger.info("Any detected audio will be saved to the 'debug_audio' folder")

    audio_buffer = []
    collecting = False
    while True:
        try:
            # Read audio data
            data = stream.read(CHUNK, exception_on_overflow=False)
            audio_block = np.frombuffer(data, dtype=np.int16)
            
            # Resample to 16000 Hz if needed (model expects this rate)
            if sample_rate != 16000:
                audio_block = resample_audio(audio_block, sample_rate, 16000)
            
            # Get prediction
            prediction = model.predict(audio_block)
            current_score = prediction['hey_jarvis']
            
            # Print score without newline
            print(f"\rCurrent score: {current_score:.4f}", end='', flush=True)
            
            # Print detection message when score is high enough
            if current_score > 0.5:
                print(f"\nDETECTED! Score: {current_score:.4f}")
            
            # Start collecting audio if score is high
            if current_score > 0.4:
                collecting = True
                audio_buffer = [audio_block]  # Start with current block
            elif collecting:
                audio_buffer.append(audio_block)
                
                # Save if we've collected enough or score drops
                if len(audio_buffer) > 10 or current_score < 0.2:
                    collecting = False
                    if len(audio_buffer) > 2:  # Only save if we have enough audio
                        timestamp = datetime.now().strftime("%H-%M-%S")
                        buffer_audio = np.concatenate(audio_buffer)
                        filename = f"debug_audio/detection_{timestamp}_{current_score:.3f}.wav"
                        sf.write(filename, buffer_audio.astype(np.float32) / 32768.0, 16000)  # Always save at 16000 Hz
        except Exception as e:
            print(f"Error: {e}")
except KeyboardInterrupt:
    print("Stopping...")
finally:
    # Clean up
    if 'stream' in locals():
        stream.stop_stream()
        stream.close()
    p.terminate()
