/**
 * AudioHandler module with wake word detection using OpenWakeWord
 *
 * Manages audio settings, speaker setup/cleanup, recording,
 * playback queue, and wake word detection.
 */

import os from 'os';
import { Buffer } from 'buffer';
import recorder from 'node-record-lpcm16';
import Speaker from 'speaker';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// Platform-specific audio settings
const audioSettings = {
  sampleRate: 16000,  // OpenAI expects 16kHz
  channels: 1,
  bitDepth: 16,
  device: os.platform() === 'linux' ? 'pulse' : 'default',
  encoding: os.platform() === 'linux' ? 'signed-integer' : undefined,
  format: 'raw'
};

/**
 * Handles all audio-related functionality for ConsoleChat with wake word support.
 */
export class AudioHandler {
  constructor(chat) {
    this.chat = chat;

    // Audio states
    this.recording = null;
    this.speaker = null;
    this.speakerInitialized = false;
    this.isPlaying = false;
    this.audioQueue = [];
    this.audioBuffer = Buffer.alloc(0);
    this.isCleaningUp = false;
    this.speechDetected = false;
    this.pendingStopRecording = false;

    // Additional modes/flags
    this.continuousMode = false;
    this.isProcessingAudio = false;
    this.isWakeWordReady = false;

    // Wake word detection
    this.wakeWordProcess = null;
    this.wakeWordRecorder = null;
    this.isListeningForWakeWord = false;
    this.lastDetectionTime = 0;
    this.detectionCooldown = 2000; // 2 seconds cooldown
  }

  /**
   * Initialize the audio handler
   */
  async initialize() {
    try {
      // Initialize wake word detection
      await this.initializeWakeWord();
      this.isWakeWordReady = true;
      console.log('\nWake word detection ready!');
    } catch (err) {
      console.error('Failed to initialize wake word detection:', err);
      throw err;
    }
  }

  /**
   * Initialize wake word detection using OpenWakeWord
   * @private
   */
  async initializeWakeWord() {
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
        if (!this.isCleaningUp) {
          setTimeout(() => this.initializeWakeWord(), 1000);
        }
      });

      // Add error handler
      this.wakeWordProcess.on('error', (err) => {
        console.error('Failed to start wake word detector:', err);
        if (!this.isCleaningUp) {
          setTimeout(() => this.initializeWakeWord(), 1000);
        }
      });

      console.log('Wake word detection initialized');
    } catch (error) {
      console.error('Error initializing wake word detection:', error);
      // Attempt to restart
      if (!this.isCleaningUp) {
        setTimeout(() => this.initializeWakeWord(), 1000);
      }
      throw error;
    }
  }

  /**
   * Cleans up the speaker instance and resets audio states
   * @param {Function} [callback] Optional callback after cleanup
   * @private
   */
  cleanupSpeaker(callback) {
    if (this.isCleaningUp) {
      if (callback) callback();
      return;
    }

    if (this.speaker) {
      this.isCleaningUp = true;
      this.isPlaying = false;
      this.audioQueue = [];

      const cleanup = () => {
        this.speaker = null;
        this.speakerInitialized = false;
        this.isCleaningUp = false;
        if (callback) callback();
      };

      try {
        this.speaker.removeAllListeners('error');
        this.speaker.removeAllListeners('close');
        this.speaker.once('close', cleanup);
        this.speaker.once('error', (err) => {
          const ignoredErrors = [
            'buffer underflow',
            'write after end',
            'not running',
            "Didn't have any audio data in callback (buffer underflow)"
          ];
          if (!ignoredErrors.some(msg => err.message.includes(msg))) {
            console.error('Error during speaker cleanup:', err.message);
          }
          cleanup();
        });
        // Force-end
        this.speaker.end();
      } catch (err) {
        const ignoredErrors = [
          'buffer underflow',
          'write after end',
          'not running',
          "Didn't have any audio data in callback (buffer underflow)"
        ];
        if (!ignoredErrors.some(msg => err.message.includes(msg))) {
          console.error('Error ending speaker:', err.message);
        }
        cleanup();
      }
    } else {
      if (callback) callback();
    }
  }

  /**
   * Process audio queue for playback
   * @private
   */
  processAudioQueue() {
    if (!this.isPlaying && !this.isCleaningUp && this.audioQueue.length > 0) {
      if (!this.speakerInitialized) {
        this.initializeSpeaker();
      }

      if (this.speaker) {
        // If we are currently recording, stop before playback
        if (this.recording && !this.isPlaying) {
          console.log('\nPausing recording for audio playback');
          this.finishRecording();
        }

        this.isPlaying = true;

        // Combine small chunks
        let combinedChunks = Buffer.alloc(0);
        const targetSize = 1024 * 256; // Increased target size for larger chunks
        while (this.audioQueue.length > 0 && combinedChunks.length < targetSize) {
          combinedChunks = Buffer.concat([
            combinedChunks,
            this.audioQueue.shift()
          ]);
        }

        // If there's no data, skip
        if (combinedChunks.length === 0) {
          console.log('No audio data to play, skipping playback...');
          this.isPlaying = false;
          if (!this.chat.isWaitingForResponse) {
            this.cleanupSpeaker(() => {
              if (this.continuousMode && !this.recording && !this.isPlaying && !this.speaker) {
                console.log('\nRestarting recording in continuous mode...');
                this.startRecording();
              }
            });
          }
          return;
        }

        try {
          if (!this.isCleaningUp) {
            this.speaker.write(combinedChunks, (err) => {
              const ignoredErrors = [
                'buffer underflow',
                'write after end',
                'not running',
                "Didn't have any audio data in callback (buffer underflow)"
              ];
              if (err && !ignoredErrors.some(msg => err.message.includes(msg))) {
                console.error('Error playing audio:', err.message);
              }

              if (!this.isPlaying || this.isCleaningUp) {
                return;
              }

              this.isPlaying = false;

              if (this.audioQueue.length > 0 && this.speaker && !this.isCleaningUp) {
                // Reduced delay between chunks
                setTimeout(() => this.processAudioQueue(), 10);
              } else if (!this.chat.isWaitingForResponse) {
                this.cleanupSpeaker(() => {
                  if (this.continuousMode && !this.recording && !this.isPlaying && !this.speaker) {
                    console.log('\nRestarting recording in continuous mode...');
                    this.startRecording();
                  }
                });
              }
            });
          }
        } catch (err) {
          const ignoredErrors = [
            'buffer underflow',
            'write after end',
            'not running',
            "Didn't have any audio data in callback (buffer underflow)"
          ];
          if (!ignoredErrors.some(msg => err.message.includes(msg))) {
            console.error('Error in audio processing:', err.message);
          }
          this.cleanupSpeaker();
        }
      }
    }
  }

  /**
   * Initialize speaker for audio playback
   * @private
   */
  initializeSpeaker() {
    if (!this.speakerInitialized && !this.isCleaningUp) {
      try {
        this.speaker = new Speaker({
          channels: 1,
          bitDepth: 16,
          sampleRate: 24000,  // 24kHz for natural playback
          highWaterMark: 1024 * 1024,  // Large buffer for smooth playback
          lowWaterMark: 1024 * 256     // Minimum buffer size
        });

        this.speaker.on('error', (err) => {
          const ignoredErrors = [
            'buffer underflow',
            'write after end',
            'not running',
            "Didn't have any audio data in callback (buffer underflow)"
          ];
          if (!ignoredErrors.some(msg => err.message.includes(msg))) {
            console.error('Speaker error:', err);
          }
        });

        this.speaker.on('close', () => {
          this.speakerInitialized = false;
          this.isPlaying = false;
        });

        this.speakerInitialized = true;
      } catch (err) {
        console.error('Failed to initialize speaker:', err);
        this.speakerInitialized = false;
      }
    }
  }

  /**
   * Handle wake word detection
   * @private
   */
  handleWakeWord() {
    console.log(' Detected: "Hey Jarvis"');
    if (!this.recording && !this.isPlaying && !this.chat.isWaitingForResponse) {
      console.log('Action: Starting recording (single request)');
      this.startRecording();
    }
  }

  /**
   * Start recording audio
   */
  startRecording() {
    if (this.recording) {
      console.log('Already recording');
      return;
    }
    if (this.isPlaying || this.isCleaningUp) {
      console.log('Cannot start recording while audio system is busy');
      return;
    }

    this.speechDetected = false;
    this.pendingStopRecording = false;

    try {
      this.recording = recorder.record(audioSettings);
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
        if (this.chat.ws && this.chat.ws.readyState === 1) {
          this.audioBuffer = Buffer.concat([this.audioBuffer, chunk]);
          // Send after ~1 chunk
          if (this.audioBuffer.length >= audioSettings.sampleRate) {
            this.chat.ws.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: this.audioBuffer.toString('base64')
            }));
            this.audioBuffer = Buffer.alloc(0);
          }
        }
      });

      console.log('Receiving audio data from microphone');
    } catch (err) {
      console.error('Error starting recording:', err.message);
      if (os.platform() === 'linux') {
        console.error('On Linux, make sure you have ALSA and PulseAudio installed:');
        console.error('sudo apt-get install libasound2-dev pulseaudio');
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

    console.log('\nStopped recording');

    if (this.chat.ws && this.chat.ws.readyState === 1 && this.audioBuffer.length > 0) {
      this.chat.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: this.audioBuffer.toString('base64')
      }));
      this.chat.ws.send(JSON.stringify({
        type: 'input_audio_buffer.commit'
      }));
      console.log('Audio committed to server');
    }

    this.recording.stop();
    this.recording = null;
    this.audioBuffer = Buffer.alloc(0);
  }

  /**
   * Toggle continuous conversation mode
   */
  toggleContinuousMode() {
    this.continuousMode = !this.continuousMode;
    if (this.continuousMode) {
      console.log('\nContinuous conversation mode enabled');
      if (!this.recording && !this.chat.isWaitingForResponse && !this.isPlaying) {
        console.log('Starting recording in continuous mode...');
        this.startRecording();
      }
    } else {
      console.log('\nContinuous conversation mode disabled');
    }
  }

  /**
   * Immediately interrupt: discard audio, end speaker, cancel assistant
   */
  interruptPlayback() {
    // If audio is playing or the assistant is responding
    if (this.isPlaying || this.chat.isWaitingForResponse) {
      console.log('\nInterrupting assistant...');

      // Clear queued audio
      this.audioQueue = [];

      // Immediately force speaker to stop playback if it exists
      if (this.speaker && !this.isCleaningUp) {
        try {
          this.speaker.end(); 
          // This forcibly ends mpg123 so you don't hear leftover speech
        } catch (err) {
          console.error('Error forcing speaker to end:', err.message);
        }
      }

      // Cancel the current response
      this.chat.isWaitingForResponse = false;
      this.chat.responseId = null;
      this.chat.currentFunctionArgs = '';

      if (this.chat.ws && this.chat.ws.readyState === 1) {
        try {
          this.chat.ws.send(JSON.stringify({ type: 'response.cancel' }));
        } catch (err) {
          console.error('Error sending cancel signal:', err.message);
        }
      }

      // If we are currently recording, stop it
      if (this.recording) {
        this.stopRecording();
      }

      // Cleanup the speaker, then start new recording immediately
      this.cleanupSpeaker(() => {
        console.log('Immediately starting recording after interrupt...');
        this.startRecording();
      });
    }
  }

  /**
   * Finalize recording and send the last audio
   * @private
   */
  finishRecording() {
    if (!this.recording) return;

    console.log('\nStopped recording');

    if (this.chat.ws && this.chat.ws.readyState === 1 && this.audioBuffer.length > 0) {
      try {
        this.chat.ws.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: this.audioBuffer.toString('base64')
        }));
        this.chat.ws.send(JSON.stringify({
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
    this.isCleaningUp = true;

    // Stop wake word detection
    if (this.wakeWordProcess) {
      this.wakeWordProcess.kill();
      this.wakeWordProcess = null;
    }

    // Stop recording if active
    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }

    // Clear audio buffer
    this.audioBuffer = Buffer.alloc(0);

    // Clean up speaker
    this.cleanupSpeaker();

    // Clear audio queue
    this.audioQueue = [];
  }

  /**
   * Handle keyboard input
   * @param {Buffer} key - Key press data
   */
  handleKeyPress(key) {
    // 'r' - Toggle recording
    if (key[0] === 114) {
      if (this.recording) {
        this.stopRecording();
      } else if (!this.chat.isWaitingForResponse && !this.isPlaying) {
        this.startRecording();
      } else {
        console.log('\nWaiting for assistant to finish responding...');
      }
    }
    // 'x' - Toggle continuous mode
    else if (key[0] === 120) {
      this.continuousMode = !this.continuousMode;
      if (this.continuousMode) {
        console.log('\nContinuous conversation mode enabled');
        if (!this.recording && !this.chat.isWaitingForResponse && !this.isPlaying) {
          console.log('Starting recording in continuous mode...');
          this.startRecording();
        }
      } else {
        console.log('\nContinuous conversation mode disabled');
      }
    }
    // 'i' - Interrupt
    else if (key[0] === 105) {
      this.interruptPlayback();
    }
    // 'q' or Ctrl+C - Quit
    else if (key[0] === 113 || key[0] === 3) {
      this.cleanup();
      process.exit(0);
    }
  }

  /**
   * Handles finishing recording
   */
  finishRecording() {
    if (this.recording) {
      this.stopRecording();
      this.pendingStopRecording = false;
    }
  }
}
