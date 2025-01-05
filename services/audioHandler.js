import { AudioInput } from './audioInput.js';
import { AudioOutput } from './audioOutput.js';

/**
 * Coordinates audio input and output functionality
 */
export class AudioHandler {
  constructor(chat) {
    this.chat = chat;
    this.continuousMode = false;
    this.isCleaningUp = false;

    // Initialize input and output handlers
    this.audioInput = new AudioInput(this);
    this.audioOutput = new AudioOutput(this);
  }

  /**
   * Initialize the audio handler
   */
  async initialize() {
    try {
      // Initialize wake word detection
      await this.audioInput.initialize();
      console.log('\nWake word detection ready!');
    } catch (err) {
      console.error('Failed to initialize wake word detection:', err);
      throw err;
    }
  }

  /**
   * Start recording audio
   */
  startRecording() {
    this.audioInput.startRecording();
  }

  /**
   * Stop recording audio
   */
  stopRecording() {
    this.audioInput.stopRecording();
  }

  /**
   * Toggle continuous conversation mode
   */
  toggleContinuousMode() {
    this.continuousMode = !this.continuousMode;
    if (this.continuousMode) {
      console.log('\nContinuous conversation mode enabled');
      this.audioInput.isListeningForWakeWord = false;
      // Only start recording if speaker is not playing and no function is being processed
      if (!this.audioOutput.isPlaying && !this.chat.isWaitingForResponse) {
        this.audioInput.startRecording();
      }
    } else {
      console.log('\nContinuous conversation mode disabled');
      this.audioInput.isListeningForWakeWord = true;
      if (this.audioInput.recording) {
        this.audioInput.stopRecording();
      }
    }
  }

  /**
   * Immediately interrupt: discard audio, end speaker, cancel assistant
   */
  interruptPlayback() {
    if (this.audioOutput.isPlaying || this.chat.isWaitingForResponse) {
      console.log('\nInterrupting assistant...');

      this.audioOutput.audioQueue = [];

      if (this.audioOutput.speaker && !this.audioOutput.isCleaningUp) {
        try {
          this.audioOutput.speaker.end(); 
        } catch (err) {
          console.error('Error forcing speaker to end:', err.message);
        }
      }

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

      if (this.audioInput.recording) {
        this.audioInput.stopRecording();
      }

      this.audioOutput.cleanupSpeaker(() => {
        console.log('Immediately starting recording after interrupt...');
        this.audioInput.startRecording();
      });
    }
  }

  /**
   * Handle keyboard input
   * @param {Buffer} key - Key press data
   */
  handleKeyPress(key) {
    if (key[0] === 114) {  // 'r' key
      if (this.audioInput.recording) {
        this.audioInput.stopRecording();
      } else if (!this.chat.isWaitingForResponse && !this.audioOutput.isPlaying) {
        this.audioInput.startRecording();
      } else {
        console.log('\nWaiting for assistant to finish responding...');
      }
    }
    else if (key[0] === 120) {  // 'x' key
      this.toggleContinuousMode();
    }
    else if (key[0] === 105) {  // 'i' key
      this.interruptPlayback();
    }
    else if (key[0] === 113 || key[0] === 3) {  // 'q' or Ctrl+C
      this.cleanup();
      process.exit(0);
    }
  }

  /**
   * Clean up resources
   */
  cleanup() {
    this.isCleaningUp = true;
    this.continuousMode = false;
    this.audioInput.cleanup();
    this.audioOutput.cleanup();
  }

  // Proxy properties for backward compatibility
  get isPlaying() {
    return this.audioOutput.isPlaying;
  }

  get isWakeWordReady() {
    return this.audioInput.isWakeWordReady;
  }
}
