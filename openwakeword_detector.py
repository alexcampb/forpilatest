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
import time

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

def get_supported_sample_rate(p, device_index, preferred_rate=16000):
    """Get a supported sample rate for the device"""
    try:
        # Try the preferred rate first
        p.is_format_supported(
            preferred_rate,
            input_device=device_index,
            input_channels=1,
            input_format=pyaudio.paInt16
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
                    input_channels=1,
                    input_format=pyaudio.paInt16
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

# Initialize wake word detection
logger.info("Initializing wake word detection...")
try:
    logger.info("Step 1: Downloading models...")
    download_models(["hey_jarvis"])
    logger.info("Models downloaded successfully")

    # Choose inference framework based on platform and availability
    inference_framework = "onnx"  # Default to ONNX
    try:
        if platform.system() == 'Linux' and platform.machine() in ['aarch64', 'armv7l']:
            import tflite_runtime
            inference_framework = "tflite"
            logger.info("Using TensorFlow Lite for ARM processor")
    except ImportError as e:
        logger.info(f"TensorFlow Lite not available ({str(e)}), using ONNX framework")

    logger.info(f"Step 2: Creating model with framework: {inference_framework}")
    model = openwakeword.Model(
        wakeword_models=["hey_jarvis"],
        inference_framework=inference_framework
    )
    logger.info("Model created successfully")

    # Find audio input device
    logger.info("Step 3: Finding audio input device...")
    device_index, device_info = find_input_device()
    if device_index is None:
        raise RuntimeError("No audio input device found")
    logger.info(f"Found audio device: {device_info['name'] if device_info else 'Unknown'}")

    # Initialize audio
    logger.info("Step 4: Initializing audio...")
    p = pyaudio.PyAudio()
    try:
        # Get supported sample rate
        sample_rate = get_supported_sample_rate(p, device_index)
        if sample_rate is None:
            raise RuntimeError("Could not find a supported sample rate for the device")
        
        logger.info(f"Opening audio stream with sample rate: {sample_rate} Hz")
        stream = p.open(
            format=pyaudio.paInt16,
            channels=1,
            rate=sample_rate,
            input=True,
            input_device_index=device_index,
            frames_per_buffer=4096
        )
        logger.info("Audio stream opened successfully")

        logger.info("\nReady! Say 'Hey Jarvis' to test wake word detection")
        logger.info("(Audio samples will be saved to the debug_audio folder)")

        # Main detection loop
        logger.info("Starting main detection loop...")
        audio_buffer = []
        collecting = False
        cooldown_counter = 0
        last_score_print_time = time.time()
        high_score_count = 0
        
        # Print initial message without clearing screen
        print("\nListening for 'Hey Jarvis'... (Press Ctrl+C to exit)")
        print("-" * 50)
        
        # Create a dedicated line for score display
        print("Current Score: ", end='', flush=True)
        
        while True:
            try:
                # Read audio data
                data = stream.read(4096, exception_on_overflow=False)
                audio_block = np.frombuffer(data, dtype=np.int16)
                
                # Resample to 16000 Hz if needed (model expects this rate)
                if sample_rate != 16000:
                    audio_block = resample_audio(audio_block, sample_rate, 16000)
                
                # Get prediction
                prediction = model.predict(audio_block)
                current_score = prediction['hey_jarvis']
                
                # Update score display every 100ms
                current_time = time.time()
                if current_time - last_score_print_time > 0.1:
                    # Clear just the score number, keeping "Current Score: " label
                    print(f"\r{' ' * 40}\rCurrent Score: {current_score:.3f}", end='', flush=True)
                    last_score_print_time = current_time
                
                # Handle detection with improved reliability
                if current_score > 0.65:
                    if not collecting:
                        collecting = True
                        audio_buffer = [audio_block]
                        high_score_count = 1
                    else:
                        high_score_count += 1
                        
                    # Trigger detection if we see high scores consistently
                    if high_score_count >= 2 and cooldown_counter == 0:
                        print("\n" + "-" * 50)  # Add separator line
                        print(f"DETECTED! Score: {current_score:.3f}")
                        print("-" * 50)
                        print("Current Score: ", end='', flush=True)  # Reset score display line
                        
                        # Release the audio stream temporarily
                        stream.stop_stream()
                        time.sleep(0.1)  # Give a moment for the device to be released
                        
                        # Save audio if we were collecting
                        if audio_buffer:
                            timestamp = datetime.now().strftime("%H-%M-%S")
                            buffer_audio = np.concatenate(audio_buffer)
                            filename = f"debug_audio/detection_{timestamp}_{current_score:.3f}.wav"
                            sf.write(filename, buffer_audio.astype(np.float32) / 32768.0, 16000)
                        
                        # Reset collection state
                        collecting = False
                        audio_buffer = []
                        high_score_count = 0
                        cooldown_counter = 10  # Reduced cooldown period
                        
                        # Restart the stream after a short delay
                        time.sleep(0.2)  # Give time for the other process to start
                        stream.start_stream()
                else:
                    high_score_count = 0
                
                # Collect audio around potential detections
                if current_score > 0.4:
                    if not collecting:
                        collecting = True
                        audio_buffer = [audio_block]
                    else:
                        audio_buffer.append(audio_block)
                elif collecting:
                    audio_buffer.append(audio_block)
                    if len(audio_buffer) > 10:  # Limit buffer size
                        collecting = False
                        audio_buffer = []
                
                # Update cooldown
                if cooldown_counter > 0:
                    cooldown_counter -= 1

            except KeyboardInterrupt:
                print("\n\nStopping...")
                break
            except Exception as e:
                logger.error(f"Error in detection loop: {str(e)}")
                continue

    except Exception as e:
        logger.error(f"Error setting up audio: {str(e)}")
        if 'stream' in locals():
            stream.stop_stream()
            stream.close()
        p.terminate()
        sys.exit(1)

except Exception as e:
    logger.error(f"Error during initialization: {str(e)}")
    import traceback
    logger.error(traceback.format_exc())
    sys.exit(1)
