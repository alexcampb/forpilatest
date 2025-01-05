import { Buffer } from 'buffer';
import Speaker from 'speaker';

/**
 * Handles audio output functionality including speaker management and playback
 */
export class AudioOutput {
  constructor(handler) {
    this.handler = handler;
    
    // Audio output states
    this.speaker = null;
    this.speakerInitialized = false;
    this.isPlaying = false;
    this.audioQueue = [];
    this.isCleaningUp = false;
    
    // Audio buffering settings
    this.minBufferSize = 1024 * 128;  // Increased from 64KB to 128KB
    this.chunkSize = 1024 * 64;       // Increased from 32KB to 64KB
    this.preBuffering = true;         // Re-enabled prebuffering
    this.endDelay = 200;              // Increased from 100ms to 200ms
    this.pendingEnd = false;          // Track if we're waiting to end
    this.dynamicBufferThreshold = 1024 * 256; // 256KB max buffer
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
          highWaterMark: 1024 * 256,  // Increased from 128KB to 256KB
          lowWaterMark: 1024 * 64,    // Increased from 32KB to 64KB
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
          this.cleanupSpeaker();
        });

        this.speaker.on('close', () => {
          this.speakerInitialized = false;
          this.isPlaying = false;
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
   * Process audio queue for playback
   */
  processAudioQueue() {
    if (!this.isPlaying && !this.isCleaningUp && this.audioQueue.length > 0) {
      if (!this.speakerInitialized) {
        this.initializeSpeaker();
      }

      if (this.speaker) {
        if (this.handler.audioInput.recording && !this.isPlaying) {
          console.log('\nPausing recording for audio playback');
          this.handler.audioInput.finishRecording();
        }

        this.isPlaying = true;
        const totalBuffered = this.audioQueue.reduce((sum, chunk) => sum + chunk.length, 0);

        // Dynamic buffering strategy
        if (this.preBuffering && totalBuffered < this.minBufferSize && this.handler.chat.isWaitingForResponse) {
          this.isPlaying = false;
          setTimeout(() => this.processAudioQueue(), 20); // Reduced from 50ms to 20ms
          return;
        }

        // Stop prebuffering if we have enough data
        if (totalBuffered >= this.dynamicBufferThreshold) {
          this.preBuffering = false;
        }

        let chunk;
        if (totalBuffered >= this.chunkSize) {
          chunk = Buffer.alloc(0);
          while (chunk.length < this.chunkSize && this.audioQueue.length > 0) {
            chunk = Buffer.concat([chunk, this.audioQueue.shift()]);
          }
        } else {
          chunk = Buffer.concat(this.audioQueue);
          this.audioQueue = [];
        }

        if (chunk.length === 0) {
          this.isPlaying = false;
          if (!this.handler.chat.isWaitingForResponse) {
            if (this.speaker && !this.isCleaningUp) {
              // Wait for any remaining audio to finish playing
              if (this.speaker.writableLength > 0) {
                this.speaker.once('drain', () => {
                  this.speaker.end();
                });
              } else {
                this.speaker.end();
              }
              
              // Listen for the finish event to do cleanup
              this.speaker.once('finish', () => {
                if (!this.handler.chat.isWaitingForResponse && 
                    this.audioQueue.length === 0 && 
                    !this.isPlaying) {
                  this.cleanupSpeaker(() => {
                    if (this.handler.continuousMode && 
                        !this.handler.audioInput.recording && 
                        !this.isPlaying && 
                        !this.speaker) {
                      console.log('\nRestarting recording in continuous mode...');
                      this.handler.audioInput.startRecording();
                    }
                  });
                }
              });
            }
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
                this.isPlaying = false;
                
                if (this.audioQueue.length > 0 && !this.isCleaningUp) {
                  this.processAudioQueue();
                } else if (!this.handler.chat.isWaitingForResponse) {
                  // Wait for any remaining audio to finish playing
                  if (this.speaker.writableLength > 0) {
                    this.speaker.once('drain', () => {
                      this.speaker.once('finish', () => {
                        this.cleanupSpeaker(() => {
                          if (this.handler.continuousMode && !this.handler.audioInput.recording && !this.isPlaying && !this.speaker) {
                            console.log('\nRestarting recording in continuous mode...');
                            this.handler.audioInput.startRecording();
                          }
                        });
                      });
                      this.speaker.end();
                    });
                  } else {
                    this.speaker.once('finish', () => {
                      this.cleanupSpeaker(() => {
                        if (this.handler.continuousMode && !this.handler.audioInput.recording && !this.isPlaying && !this.speaker) {
                          console.log('\nRestarting recording in continuous mode...');
                          this.handler.audioInput.startRecording();
                        }
                      });
                    });
                    this.speaker.end();
                  }
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
            // Only cleanup if it's a non-ignorable error
            if (!ignoredErrors.some(msg => err.message?.includes(msg))) {
              this.cleanupSpeaker();
            }
          }
        };

        playChunk();
      }
    }
  }

  /**
   * Cleans up the speaker instance and resets audio states
   * @param {Function} [callback] Optional callback after cleanup
   */
  cleanupSpeaker(callback) {
    if (this.isCleaningUp) {
      if (callback) callback();
      return;
    }

    if (this.speaker) {
      this.isCleaningUp = true;
      this.isPlaying = false;

      // Keep the audio queue intact until we're sure everything is played
      const remainingAudio = this.audioQueue;
      
      const finishCleanup = () => {
        if (this.speaker) {
          this.speaker.removeAllListeners();
          this.speaker.close(() => {
            this.speaker = null;
            this.speakerInitialized = false;
            this.isCleaningUp = false;
            this.audioQueue = [];
            if (callback) callback();
          });
        } else {
          this.speakerInitialized = false;
          this.isCleaningUp = false;
          this.audioQueue = [];
          if (callback) callback();
        }
      };

      // If there's remaining audio in the queue, play it first
      if (remainingAudio.length > 0) {
        const finalChunk = Buffer.concat(remainingAudio);
        if (finalChunk.length > 0) {
          this.speaker.write(finalChunk);
        }
      }

      // Wait for both drain and finish events
      if (this.speaker.writableLength > 0) {
        this.speaker.once('drain', () => {
          this.speaker.once('finish', finishCleanup);
          this.speaker.end();
        });
      } else {
        this.speaker.once('finish', finishCleanup);
        this.speaker.end();
      }
    } else {
      this.speakerInitialized = false;
      this.isCleaningUp = false;
      this.audioQueue = [];
      if (callback) callback();
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.isCleaningUp = true;
    if (this.speaker) {
      this.cleanupSpeaker();
    }
  }
}
