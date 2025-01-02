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
    
    // Audio buffering settings
    this.minBufferSize = 1024 * 256;  // Minimum size before starting playback
    this.chunkSize = 1024 * 64;       // Size of chunks to write
    this.preBuffering = true;         // Start in pre-buffering state
    this.endDelay = 500;              // Delay before ending stream (ms)
    this.pendingEnd = false;          // Track if we're waiting to end

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
        if (this.speaker) {
          // Wait for the speaker to finish naturally
          this.speaker.on('finish', () => {
            this.speaker.removeAllListeners();
            this.speaker.close(() => {
              this.speaker = null;
              this.speakerInitialized = false;
              this.isCleaningUp = false;
              if (callback) callback();
            });
          });
          
          // End the stream to trigger 'finish' event
          this.speaker.end();
        } else {
          this.speakerInitialized = false;
          this.isCleaningUp = false;
          if (callback) callback();
        }
      };

      // If there's data still being written, wait for it to drain
      if (this.speaker.writableLength > 0) {
        this.speaker.once('drain', cleanup);
      } else {
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

        // Calculate total buffered data
        const totalBuffered = this.audioQueue.reduce((sum, chunk) => sum + chunk.length, 0);

        // If in pre-buffering mode, wait until we have enough data
        if (this.preBuffering && totalBuffered < this.minBufferSize && this.chat.isWaitingForResponse) {
          this.isPlaying = false;
          setTimeout(() => this.processAudioQueue(), 50);
          return;
        }
        this.preBuffering = false;

        // Process chunks in smaller sizes
        let chunk;
        if (totalBuffered > this.chunkSize) {
          chunk = Buffer.alloc(0);
          while (chunk.length < this.chunkSize && this.audioQueue.length > 0) {
            chunk = Buffer.concat([chunk, this.audioQueue.shift()]);
          }
        } else if (!this.chat.isWaitingForResponse) {
          // Final message, use all remaining data
          chunk = Buffer.concat(this.audioQueue);
          this.audioQueue = [];
        } else {
          // Not enough data and still waiting for more
          this.isPlaying = false;
          setTimeout(() => this.processAudioQueue(), 50);
          return;
        }

        if (chunk.length === 0) {
          this.isPlaying = false;
          if (!this.chat.isWaitingForResponse) {
            // Wait for the speaker to finish naturally
            this.speaker.on('finish', () => {
              this.cleanupSpeaker(() => {
                if (this.continuousMode && !this.recording && !this.isPlaying && !this.speaker) {
                  console.log('\nRestarting recording in continuous mode...');
                  this.startRecording();
                }
              });
            });
            
            // End the stream to trigger 'finish' event
            this.speaker.end();
          }
          return;
        }

        const playChunk = () => {
          try {
            if (!this.isCleaningUp && this.speaker) {
              const canWrite = this.speaker.write(chunk, (err) => {
                if (err) {
                  const ignoredErrors = [
                    'buffer underflow',
                    'write after end',
                    'not running',
                    "Didn't have any audio data in callback (buffer underflow)"
                  ];
                  if (!ignoredErrors.some(msg => err.message?.includes(msg))) {
                    console.error('Error playing audio:', err);
                  }
                }

                if (!this.isPlaying || this.isCleaningUp) return;

                // Reset pre-buffering state when response is complete
                if (!this.chat.isWaitingForResponse) {
                  this.preBuffering = true;
                }

                this.isPlaying = false;
                
                if (this.audioQueue.length > 0 && !this.isCleaningUp) {
                  setTimeout(() => this.processAudioQueue(), 10);
                } else if (!this.chat.isWaitingForResponse) {
                  // Wait for the speaker to finish naturally
                  this.speaker.on('finish', () => {
                    this.cleanupSpeaker(() => {
                      if (this.continuousMode && !this.recording && !this.isPlaying && !this.speaker) {
                        console.log('\nRestarting recording in continuous mode...');
                        this.startRecording();
                      } else {
                        // Re-enable wake word detection if not in continuous mode
                        this.isListeningForWakeWord = !this.continuousMode;
                      }
                    });
                  });
                  
                  // End the stream to trigger 'finish' event
                  this.speaker.end();
                }
              });

              if (!canWrite) {
                this.speaker.once('drain', playChunk);
              }
            }
          } catch (err) {
            const ignoredErrors = [
              'buffer underflow',
              'write after end',
              'not running',
              "Didn't have any audio data in callback (buffer underflow)"
            ];
            if (!ignoredErrors.some(msg => err.message?.includes(msg))) {
              console.error('Error in audio processing:', err);
            }
            this.cleanupSpeaker();
          }
        };

        playChunk();
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
        if (this.speaker) {
          this.cleanupSpeaker();
        }

        this.speaker = new Speaker({
          channels: 1,
          bitDepth: 16,
          sampleRate: 24000,
          highWaterMark: 1024 * 512,  // Balanced buffer size
          lowWaterMark: 1024 * 256,   // Increased minimum threshold
          deviceId: 'default',         // Explicitly use default device
          format: 'S16LE',            // Explicit format for better compatibility
          signed: true                // Ensure signed audio data
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
          // Always cleanup on error to prevent hanging
          this.cleanupSpeaker();
        });

        this.speaker.on('close', () => {
          this.speakerInitialized = false;
          this.isPlaying = false;
          // Reset the speaker instance
          this.speaker = null;
        });

        this.speakerInitialized = true;
      } catch (err) {
        console.error('Failed to initialize speaker:', err);
        this.speakerInitialized = false;
        this.speaker = null;
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

    // Disable wake word detection while recording
    this.isListeningForWakeWord = false;
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
    
    this.pendingStopRecording = true;
    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }

    // Re-enable wake word detection unless in continuous mode
    if (!this.continuousMode) {
      this.isListeningForWakeWord = true;
    }
  }

  /**
   * Toggle continuous conversation mode
   */
  toggleContinuousMode() {
    this.continuousMode = !this.continuousMode;
    if (this.continuousMode) {
      console.log('\nContinuous conversation mode enabled');
      // Disable wake word detection in continuous mode
      this.isListeningForWakeWord = false;
      if (!this.recording && !this.isPlaying) {
        this.startRecording();
      }
    } else {
      console.log('\nContinuous conversation mode disabled');
      // Re-enable wake word detection when exiting continuous mode
      this.isListeningForWakeWord = true;
      if (this.recording) {
        this.stopRecording();
      }
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

    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }

    // Re-enable wake word detection when cleaning up
    this.isListeningForWakeWord = true;
    this.continuousMode = false;
    
    if (this.speaker) {
      this.cleanupSpeaker();
    }
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
