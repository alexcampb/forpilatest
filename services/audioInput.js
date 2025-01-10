import os from 'os';
import { Buffer } from 'buffer';
import recorder from 'node-record-lpcm16';
import { spawn } from 'child_process';
import { execSync } from 'child_process';

// Function to get default audio device info
function getDefaultAudioDevice() {
  try {
    if (os.platform() === 'linux') {
      // Try to find P10S USB device first
      try {
        const arecordOutput = execSync('arecord -L').toString();
        const lines = arecordOutput.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes('p10s')) {
            return `P10S USB Device: ${line.trim()}`;
          }
        }
      } catch (e) {
        // Ignore errors and continue to next option
      }

      // Try wpctl (PipeWire) next
      try {
        const wpctlOutput = execSync('wpctl status | grep "Sources:" -A 1').toString();
        const match = wpctlOutput.match(/\*\s+\d+\.\s+(.*?)\s+\[/);
        if (match) return `PipeWire Device: ${match[1]}`;
      } catch (e) {
        // Ignore errors and continue to next option
      }

      // Finally try arecord default device
      try {
        const arecordOutput = execSync('arecord -L | grep -A1 "^default"').toString();
        return `ALSA Device: ${arecordOutput.split('\n')[1].trim()}`;
      } catch (e) {
        console.error('Error getting ALSA device:', e);
      }
    }
    return 'Default system device';
  } catch (err) {
    return 'Could not determine default device';
  }
}

// Platform-specific audio settings
export const audioSettings = {
  sampleRate: 16000,  // OpenAI expects 16kHz
  channels: 1,
  bitDepth: 16,
  device: os.platform() === 'linux' ? 'plughw:P10S,0' : 'default',  // Try P10S device on Linux
  encoding: os.platform() === 'linux' ? 'signed-integer' : undefined,
  format: 'raw'
};

/**
 * Handles audio input functionality including recording and wake word detection
 */
export class AudioInput {
  constructor(handler) {
    this.handler = handler;
    
    // Recording states
    this.recording = null;
    this.audioBuffer = Buffer.alloc(0);
    this.speechDetected = false;
    this.pendingStopRecording = false;
    
    // Wake word detection
    this.wakeWordProcess = null;
    this.wakeWordRecorder = null;
    this.isListeningForWakeWord = false;
    this.lastDetectionTime = 0;
    this.detectionCooldown = 2000; // 2 seconds cooldown
    this.isWakeWordReady = false;
  }

  /**
   * Initialize wake word detection using OpenWakeWord
   */
  async initialize() {
    try {
      console.log('Initializing wake word detection...');

      // Start the Python process
      this.wakeWordProcess = spawn('python3', ['openwakeword_detector.py'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Handle process output
      this.wakeWordProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        
        // Check for wake word detection
        if (output.includes('DETECTED!')) {
          // Extract score from the output
          const scoreMatch = output.match(/Score: (\d+\.\d+)/);
          const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
          
          if (score > 0.5) {  // Threshold for detection
            const now = Date.now();
            // Only trigger if enough time has passed since last detection
            if (now - this.lastDetectionTime > this.detectionCooldown) {
              console.log('\nWake word detected!');
              this.lastDetectionTime = now;
              this.handleWakeWord();
            }
          }
        }
      });

      // Handle errors
      this.wakeWordProcess.stderr.on('data', (data) => {
        const error = data.toString();
        // Only log serious errors, ignore routine messages
        if (!error.includes('Downloading') && !error.includes('Initializing') && !error.includes('Listening')) {
          console.error('Wake word detector error:', error);
        }
      });

      this.wakeWordProcess.on('close', (code) => {
        console.log('Wake word detector process ended with code:', code);
        // Attempt to restart if not intentionally closed
        if (!this.handler.isCleaningUp) {
          setTimeout(() => this.initialize(), 1000);
        }
      });

      // Add error handler
      this.wakeWordProcess.on('error', (err) => {
        console.error('Failed to start wake word detector:', err);
        if (!this.handler.isCleaningUp) {
          setTimeout(() => this.initialize(), 1000);
        }
      });

      this.isWakeWordReady = true;
      console.log('Wake word detection initialized');
    } catch (error) {
      console.error('Error initializing wake word detection:', error);
      // Attempt to restart
      if (!this.handler.isCleaningUp) {
        setTimeout(() => this.initialize(), 1000);
      }
      throw error;
    }
  }

  /**
   * Handle wake word detection
   * @private
   */
  handleWakeWord() {
    console.log(' Detected: "Hey Jarvis"');
    if (!this.recording && !this.handler.isPlaying && !this.handler.chat.isWaitingForResponse) {
      console.log('Action: Starting recording (single request)');
      this.startRecording();
    }
  }

  /**
   * Start recording audio
   */
  startRecording() {
    // Don't start recording if speaker is playing or we're processing a function
    if (this.handler.audioOutput.isPlaying || this.handler.chat.isWaitingForResponse) {
      console.log('\nCannot start recording while speaker is playing or processing a function');
      return;
    }

    if (this.recording) return;
    
    this.isListeningForWakeWord = false;
    this.speechDetected = false;
    this.pendingStopRecording = false;

    try {
      const defaultDevice = getDefaultAudioDevice();
      this.recording = recorder.record(audioSettings);
      console.log('Default audio device:', defaultDevice);
      console.log('Recording started with settings:', audioSettings);

      this.audioBuffer = Buffer.alloc(0);
      this.recording.stream().on('error', (err) => {
        console.error('Recording error:', err.message);
        if (this.recording) {
          this.recording.stop();
          this.recording = null;
        }
        this.audioBuffer = Buffer.alloc(0);
      });

      this.recording.stream().on('data', (chunk) => {
        if (this.handler.chat.ws && this.handler.chat.ws.readyState === 1) {
          this.audioBuffer = Buffer.concat([this.audioBuffer, chunk]);
          console.log('Audio buffer size:', this.audioBuffer.length, 'bytes');
          if (this.audioBuffer.length >= audioSettings.sampleRate) {
            console.log('Sending audio buffer to server...');
            this.handler.chat.ws.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: this.audioBuffer.toString('base64')
            }));
            this.audioBuffer = Buffer.alloc(0);
          }
        } else {
          console.log('WebSocket state:', this.handler.chat.ws ? this.handler.chat.ws.readyState : 'no websocket');
        }
      });

      console.log('Receiving audio data from microphone');
    } catch (err) {
      console.error('Error starting recording:', err.message);
      if (os.platform() === 'linux') {
        console.error('On Linux, make sure you have PipeWire installed:');
        console.error('sudo apt-get install pipewire');
      }
      if (this.recording) {
        this.recording.stop();
        this.recording = null;
      }
      this.audioBuffer = Buffer.alloc(0);
    }
  }

  /**
   * Stop recording audio
   */
  stopRecording() {
    if (!this.recording) return;
    
    this.pendingStopRecording = true;
    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }

    if (!this.handler.continuousMode) {
      this.isListeningForWakeWord = true;
    }
  }

  /**
   * Finalize recording and send the last audio
   */
  finishRecording() {
    if (!this.recording) return;

    console.log('\nStopped recording');

    if (this.handler.chat.ws && this.handler.chat.ws.readyState === 1 && this.audioBuffer.length > 0) {
      try {
        this.handler.chat.ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: this.audioBuffer.toString('base64')
        }));
        this.handler.chat.ws.send(JSON.stringify({
          type: 'input_audio_buffer.commit'
        }));
        console.log('Audio committed to server');
      } catch (err) {
        console.error('Error sending final audio:', err.message);
      }
    }

    this.recording.stop();
    this.recording = null;
    this.audioBuffer = Buffer.alloc(0);
    this.pendingStopRecording = false;
    this.speechDetected = false;
  }

  /**
   * Clean up resources
   */
  cleanup() {
    if (this.wakeWordProcess) {
      this.wakeWordProcess.kill();
      this.wakeWordProcess = null;
    }

    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }

    this.isListeningForWakeWord = true;
  }
}
