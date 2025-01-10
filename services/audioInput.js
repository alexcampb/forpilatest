import os from 'os';
import { Buffer } from 'buffer';
import recorder from 'node-record-lpcm16';
import { spawn } from 'child_process';
import { execSync } from 'child_process';

// Function to get default audio device info
function getDefaultAudioDevice() {
  try {
    if (os.platform() === 'linux') {
      // Try to find P10S device first
      try {
        const arecordOutput = execSync('arecord -l').toString();
        if (arecordOutput.includes('P10S')) {
          return 'P10S USB Audio Device';
        }
      } catch (e) {
        console.error('Error checking for P10S device:', e);
      }

      // Then try PipeWire
      try {
        const wpctlOutput = execSync('wpctl status | grep "Sources:" -A 1').toString();
        const match = wpctlOutput.match(/\*\s+\d+\.\s+(.*?)\s+\[/);
        if (match) return `PipeWire Default Source: ${match[1]}`;
      } catch (e) {
        // wpctl failed, try arecord
        try {
          const arecordOutput = execSync('arecord -L | grep -A1 "^default"').toString();
          return `ALSA Default Device: ${arecordOutput.split('\n')[1].trim()}`;
        } catch (err) {
          console.error('Error getting ALSA device:', err);
        }
      }
    }
    return 'Default system device';
  } catch (err) {
    console.error('Error getting audio device:', err);
    return 'Could not determine default device';
  }
}

// Platform-specific audio settings
export const audioSettings = {
  sampleRate: 16000,  // OpenAI expects 16kHz
  channels: 1,
  bitDepth: 16,
  device: os.platform() === 'linux' ? 'plughw:3,0' : 'default',  // Use P10S device on Linux
  encoding: 'signed-integer',
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

  async startRecording() {
    if (this.recording) return;
    
    this.isListeningForWakeWord = false;
    this.speechDetected = false;
    this.pendingStopRecording = false;

    // Add retry logic
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        const defaultDevice = getDefaultAudioDevice();
        console.log('Initializing audio device:', defaultDevice);
        
        // On Linux, verify the device exists before trying to use it
        if (os.platform() === 'linux') {
          try {
            const devices = execSync('arecord -l').toString();
            if (!devices.includes('P10S')) {
              throw new Error('P10S device not found');
            }
            console.log('Found P10S device, proceeding with recording');
          } catch (err) {
            console.error('Error checking audio device:', err);
            throw new Error('Could not verify audio device');
          }
        }

        // Wait a moment before trying to access the device
        await new Promise(resolve => setTimeout(resolve, 200));

        this.recording = recorder.record({
          ...audioSettings,
          device: os.platform() === 'linux' ? 'plughw:3,0' : 'default',
          channels: 1,
          sampleRate: 16000,
          threshold: 0.5,
          keepSilence: true,
          endOnSilence: false
        });

        console.log('Recording started with settings:', {
          ...audioSettings,
          device: os.platform() === 'linux' ? 'plughw:3,0' : 'default'
        });

        this.audioBuffer = Buffer.alloc(0);
        let totalBytesProcessed = 0;

        this.recording.stream()
          .on('error', this._handleRecordingError.bind(this))
          .on('data', this._handleAudioData.bind(this));

        console.log('Audio recording initialized with device:', audioSettings.device);
        break; // Success, exit retry loop
      } catch (err) {
        console.error(`Attempt ${retryCount + 1} failed:`, err.message);
        if (this.recording) {
          this.recording.stop();
          this.recording = null;
        }
        this.audioBuffer = Buffer.alloc(0);
        
        retryCount++;
        if (retryCount < maxRetries) {
          console.log(`Retrying in ${retryCount * 500}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryCount * 500));
        } else {
          console.error('Failed to start recording after multiple attempts');
          if (os.platform() === 'linux') {
            console.error('Audio device error. Please check:');
            console.error('1. P10S device is properly connected');
            console.error('2. ALSA/PipeWire is properly configured');
            console.error('3. User has proper permissions (audio group)');
          }
        }
      }
    }
  }

  _handleRecordingError(err) {
    console.error('Recording error:', err.message);
    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }
    this.audioBuffer = Buffer.alloc(0);
  }

  _handleAudioData(chunk) {
    if (this.handler.chat.ws && this.handler.chat.ws.readyState === 1) {
      this.audioBuffer = Buffer.concat([this.audioBuffer, chunk]);
      let totalBytesProcessed = 0;
      totalBytesProcessed += chunk.length;
      console.log(`Audio buffer size: ${this.audioBuffer.length} bytes (Total processed: ${totalBytesProcessed} bytes)`);
      
      if (this.audioBuffer.length >= audioSettings.sampleRate) {
        console.log('Sending audio buffer to server...');
        try {
          this.handler.chat.ws.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: this.audioBuffer.toString('base64')
          }));
          console.log('Successfully sent audio buffer');
        } catch (err) {
          console.error('Error sending audio buffer:', err);
        }
        this.audioBuffer = Buffer.alloc(0);
      }
    } else {
      console.log('WebSocket state:', this.handler.chat.ws ? this.handler.chat.ws.readyState : 'no websocket');
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
