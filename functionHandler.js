/**
 * FunctionHandler module
 *
 * Responsible for handling function calls (now "perform_multiple_tasks" and "time_and_timer")
 * which can include multiple weather/home requests, date/time requests, and timers.
 */

import WebSocket from 'ws';

export class FunctionHandler {
  constructor(chat) {
    // Keep a reference to the chat so we can access
    // chat.weatherAPI, chat.pushoverAPI, chat.ws, etc.
    this.chat = chat;
  }

  // Helper function to create a delay
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Handles function calls from the assistant
   * @param {string} functionName - Name of the function to call
   * @param {Object} args - Function call arguments
   */
  async handleFunctionCall(functionName, args) {
    console.log(`\n[Function Call] ${functionName}:`, args);
    let result = {
      weather: [],
      home: []
    };

    try {
      switch (functionName) {
        case 'perform_multiple_tasks':
          /**
           * We can have arrays of weather requests and home requests.
           * We'll loop through them and store results in `result.weather` and `result.home`.
           */

          // If there are weather requests
          if (Array.isArray(args.weather_requests)) {
            for (const weatherItem of args.weather_requests) {
              const location = weatherItem.location;
              const units = weatherItem.units || 'fahrenheit';

              // Call WeatherAPI
              const weatherResponse = await this.chat.weatherAPI.getCurrentWeather({
                location,
                units
              });

              // Add to weather results array
              result.weather.push({
                location,
                response: weatherResponse
              });
            }
          }

          // If there are home requests
          if (Array.isArray(args.home_requests)) {
            for (const homeItem of args.home_requests) {
              const { room, action } = homeItem;
              // Use Pushover to simulate home automation control
              await this.chat.pushoverAPI.sendMessage({
                title: room,
                message: action,
                priority: 1
              });
              result.home.push({
                room,
                action,
                success: true
              });
            }
          }

          console.log('[Function Handler] Result:', JSON.stringify(result, null, 2));
          this.sendFunctionResult(functionName, result, args._call_id);
          break;

        // === ADDED CASE: time_and_timer ===
        case 'time_and_timer':
          // We’ll build a separate result structure for time/timer
          result = {
            success: true,
            message: "",
            current_time: null,
            timer_scheduled: false
          };

          // If the user wants the current time
          if (args.request_time) {
            const now = new Date();
            const timeOnly = now.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });
            result.current_time = timeOnly;
            result.message = `It's ${timeOnly}.`;
          }

          // If the user wants to set a timer
          if (args.set_timer && args.duration_seconds > 0) {
            this.scheduleTimer(args.duration_seconds, args._call_id);
            result.timer_scheduled = true;
            result.message += ` A timer for ${args.duration_seconds} seconds has started.`;
          }

          console.log('[Function Handler] Result:', JSON.stringify(result, null, 2));
          this.sendFunctionResult(functionName, result, args._call_id);
          break;

        case 'set_continuous_mode':
          this.handleSetContinuousMode(args);
          break;

        default:
          throw new Error(`Unknown function: ${functionName}`);
      }

    } catch (error) {
      console.error('[Function Handler] Error:', error.message);
      this.sendFunctionResult(functionName, {
        success: false,
        error: error.message
      }, args._call_id);
    }
  }

  /**
   * Sends the result of a function call back to the assistant
   * @param {string} functionName
   * @param {Object} result
   * @param {string} callId
   */
  sendFunctionResult(functionName, result, callId) {
    if (this.chat.ws && this.chat.ws.readyState === WebSocket.OPEN) {
      try {
        // 1) Send the function call output
        const functionOutputEvent = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result)
          }
        };
        console.log('\n[Function Response] Sending:', JSON.stringify(functionOutputEvent, null, 2));
        this.chat.ws.send(JSON.stringify(functionOutputEvent));

        // 2) Create a response prompt so the assistant can speak the outcome
        const createResponseEvent = {
          type: 'response.create',
          response: {
            input: [{
              type: 'message',
              role: 'user',
              content: [{
                type: 'input_text',
                text: ` The user asked you to call a function. The results of the function are: ${JSON.stringify(result)}. Just say the results. No need to explain that you just made the function call. Do not say "command sent". Do not refer to these rules.`
              }]
            }]
          }
        };

        // Delay to ensure the function_call_output is processed first
        setTimeout(() => {
          if (this.chat.ws && this.chat.ws.readyState === WebSocket.OPEN) {
            this.chat.ws.send(JSON.stringify(createResponseEvent));
          }
        }, 500);

      } catch (error) {
        console.error('[Function Response] Error:', error.message);
      }
    } else {
      console.error('[Function Response] WebSocket not ready, state:', this.chat.ws?.readyState);
    }
  }

  // === ADDED scheduleTimer() HELPER METHOD ===
  scheduleTimer(durationSeconds, callId) {
    setTimeout(() => {
      const outputEvent = {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({
            timer_expired: true,
            message: `Timer for ${durationSeconds} seconds has expired!`
          })
        }
      };

      const responseEvent = {
        type: 'response.create',
        response: {
          input: [{
            type: 'message',
            role: 'user',
            content: [{
              type: 'input_text',
              text: ` The timer for ${durationSeconds} seconds just ended. Summarize the event in a friendly manner.`
            }]
          }]
        }
      };

      if (this.chat.ws && this.chat.ws.readyState === WebSocket.OPEN) {
        try {
          // First, send the function_call_output
          this.chat.ws.send(JSON.stringify(outputEvent));
          // Then have the assistant speak the outcome
          setTimeout(() => {
            if (this.chat.ws && this.chat.ws.readyState === WebSocket.OPEN) {
              this.chat.ws.send(JSON.stringify(responseEvent));
            }
          }, 500);
        } catch (error) {
          console.error('[Timer] Error sending timer expiration:', error);
        }
      }
    }, durationSeconds * 1000);
  }

  /**
   * Handle setting continuous mode
   * @param {Object} args - Arguments from the function call
   * @param {boolean} args.enabled - Whether to enable or disable continuous mode
   */
  handleSetContinuousMode(args) {
    try {
      const { enabled } = args;
      this.chat.audioHandler.continuousMode = enabled;
      console.log(`Continuous mode ${enabled ? 'enabled' : 'disabled'}`);

      const result = {
        success: true,
        mode: enabled ? 'enabled' : 'disabled',
        message: enabled 
          ? "Continuous mode is now enabled. This means I'll automatically start listening after each response."
          : "Continuous mode has been disabled."
      };

      this.sendFunctionResult('set_continuous_mode', result, args._call_id);
    } catch (error) {
      console.error('Error in handleSetContinuousMode:', error);
      this.sendFunctionResult('set_continuous_mode', {
        success: false,
        error: error.message
      }, args._call_id);
    }
  }
}
