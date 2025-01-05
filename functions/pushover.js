import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Handles sending notifications via Pushover API
 */
export class PushoverAPI {
  constructor() {
    this.apiToken = process.env.PUSHOVER_APP_TOKEN;
    this.userKey = process.env.PUSHOVER_USER_KEY;
    this.lastMessageTime = 0;  // Track when the last message was sent
    
    if (!this.apiToken || !this.userKey) {
      console.warn('Warning: Pushover credentials not found in environment variables');
    }
  }

  // Helper function to create a delay
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sends a message to Pushover
   * @param {Object} params - Message parameters
   * @param {string} params.message - The message to send (required)
   * @param {string} [params.title] - Message title
   * @param {number} [params.priority] - Message priority (-2 to 2)
   * @param {string} [params.sound] - Sound to play
   * @returns {Promise<Object>} Response from Pushover API
   */
  async sendMessage({ message, title, priority, sound }) {
    if (!this.apiToken || !this.userKey) {
      throw new Error('Pushover credentials not configured');
    }

    // Calculate time since last message
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    
    // If less than 10 seconds have passed, wait for the remaining time
    if (timeSinceLastMessage < 800) {
      await this.delay(800 - timeSinceLastMessage);
    }

    const payload = {
      token: this.apiToken,
      user: this.userKey,
      message,
      ...(title && { title }),
      ...(priority && { priority }),
      ...(sound && { sound })
    };

    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // Update last message time after successful send
    this.lastMessageTime = Date.now();

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.errors?.[0] || 'Failed to send Pushover notification');
    }

    return {
      // Message details
      sent: {
        message: payload.message,
        title: payload.title || '(no title)',
        device: payload.device || '(all devices)',
        priority: payload.priority || 0,
        sound: payload.sound || '(default)',
        timestamp: new Date().toISOString()
      },
      // API Response
      status: data.status,
      request: data.request,
      headers: Object.fromEntries(response.headers),
      remainingCredits: response.headers.get('x-limit-app-remaining'),
      resetDate: response.headers.get('x-limit-app-reset'),
      responseTime: response.headers.get('x-server-time'),
      raw: data
    };
  }
}
