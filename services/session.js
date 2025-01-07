import fetch from 'node-fetch';

/**
 * Handles OpenAI session management
 *
 * Includes extensive examples illustrating how the assistant should respond
 * and which function to call based on user requests.
 */

export class SessionManager {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('Warning: OPENAI_API_KEY not found in environment variables');
    }
  }

  /**
   * Creates a new session with OpenAI's API.
   *
   * Rules & Examples:
   * 1) set_continuous_mode({ enabled: true }) to enable multi-turn conversation.
   * 2) set_continuous_mode({ enabled: false }) to disable multi-turn conversation.
   * 3) perform_multiple_tasks to handle weather or home device actions.
   *    - Default weather location: "San Francisco"
   *    - Default home control room: "Family Room"
   * 4) time_and_timer to provide current time or set a timer.
   *
   * More Examples:
   *   - "Can we keep chatting without me saying 'Hey Assistant' all the time?"
   *       => set_continuous_mode({ enabled: true })
   *
   *   - "I'm done talking, stop listening automatically."
   *       => set_continuous_mode({ enabled: false })
   *
   *   - "What's the temperature in London in Celsius?"
   *       => perform_multiple_tasks({
   *            weather_requests: [
   *              { location: "London, UK", units: "celsius" }
   *            ]
   *          })
   *
   *   - "Turn on the lights in the Living Room and play music in the Family Room."
   *       => perform_multiple_tasks({
   *            home_requests: [
   *              { room: "Living Room", action: "Lights On" },
   *              { room: "Family Room", action: "Play Music" }
   *            ]
   *          })
   *
   *   - "What time is it right now?"
   *       => time_and_timer({ request_time: true })
   *
   *   - "Set a timer for 90 seconds."
   *       => time_and_timer({ set_timer: true, duration_seconds: 90 })
   *
   *   - "Check the weather in Paris, and then turn off the lights in the Family Room."
   *       => perform_multiple_tasks({
   *            weather_requests: [
   *              { location: "Paris, France" }
   *            ],
   *            home_requests: [
   *              { room: "Family Room", action: "Lights Off" }
   *            ]
   *          })
   *
   *   - "Please turn on continuous mode and also let me know the temperature in New York."
   *       => First call set_continuous_mode({ enabled: true })
   *       => Then call perform_multiple_tasks({
   *            weather_requests: [
   *              { location: "New York" }
   *            ]
   *          })
   */

  async createSession() {
    try {
      const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-realtime-preview-2024-12-17",
          temperature: 0.8,
          max_response_output_tokens: 4096,
          modalities: ["audio", "text"],
          voice: "ash",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          turn_detection: {
            type: "server_vad",
            threshold: 0.8,
            silence_duration_ms: 1500,
            prefix_padding_ms: 300,
            create_response: true
          },
          input_audio_transcription: {
            model: "whisper-1"
          },
          tools: [
            {
              type: "function",
              name: "perform_multiple_tasks",
              description: `
                Perform multiple tasks:
                1) Retrieve weather info (defaults to 'San Francisco' if location isn't specified).
                2) Control home devices (defaults to 'Family Room' if room isn't specified).
                
                Example calls:
                  perform_multiple_tasks({
                    weather_requests: [{ location: "New York", units: "fahrenheit" }],
                    home_requests: [{ room: "Living Room", action: "Lights On" }]
                  })
              `,
              parameters: {
                type: "object",
                properties: {
                  weather_requests: {
                    type: "array",
                    description: "List of weather requests. If empty, no weather action is performed.",
                    items: {
                      type: "object",
                      properties: {
                        location: {
                          type: "string",
                          description: "Location for weather info (e.g., 'San Francisco')."
                        },
                        units: {
                          type: "string",
                          enum: ["fahrenheit", "celsius"],
                          description: "Temperature unit preference."
                        }
                      },
                      required: ["location"]
                    }
                  },
                  home_requests: {
                    type: "array",
                    description: "List of home control actions (room + action). If empty, no home action is performed. If we want to do All rooms must send action to all rooms individually.",
                    items: {
                      type: "object",
                      properties: {
                        room: {
                          type: "string",
                          enum: ["Living Room", "Family Room", "Master Bedroom", "Master Bathroom", "Alex"],
                          description: "Room to target. Default to 'Family Room' if not provided."
                        },
                        action: {
                          type: "string",
                          enum: [
                            "Lights On",
                            "Lights Off",
                            "Chill",
                            "Play Music",
                            "Vol Up",
                            "Vol Dn",
                            "Shades Up",
                            "Shades Dn",
                            "Brighten",
                            "Dim"
                          ],
                          description: "Action to perform (lights on/off. Play music and turn up and down music volume, Chill turns on chill scene, Brighten and Dim turn up and down the brightness of lights. Shades up and down to open and close the shades .We Only have shades in Alex and the Master Bedroom)."
                        }
                      },
                      required: ["action"]
                    }
                  }
                },
                required: []
              }
            },
            {
              type: "function",
              name: "time_and_timer",
              description: `
                Fetch current time (HH:MM) or set a timer with a specified duration.
                
                Example calls:
                  time_and_timer({ request_time: true })
                  time_and_timer({ set_timer: true, duration_seconds: 45 })
              `,
              parameters: {
                type: "object",
                properties: {
                  request_time: {
                    type: "boolean",
                    description: "If true, return current time (HH:MM)."
                  },
                  set_timer: {
                    type: "boolean",
                    description: "If true, set a timer for duration_seconds."
                  },
                  duration_seconds: {
                    type: "number",
                    description: "Seconds until timer expires. Required if set_timer=true."
                  }
                },
                required: []
              }
            },
            {
              type: "function",
              name: "set_continuous_mode",
              description: `
                Enable or disable continuous conversation mode (no wake word needed each time).
                
                Example calls:
                  set_continuous_mode({ enabled: true })
                  set_continuous_mode({ enabled: false })
              `,
              parameters: {
                type: "object",
                properties: {
                  enabled: {
                    type: "boolean",
                    description: "True => continuous mode on, false => continuous mode off."
                  }
                },
                required: ["enabled"]
              }
            }
          ],
          instructions: `
You are name is Jarvis. You are an AI assistant in the Family Room of my home in San Francisco (knowledge cutoff: 2023-10). You give great advice and have the knowledge of an expert in many fields. You are funny charasmatic annd witty. Some would say brilliant. You are very helpful and always respond with relevant information. You are an amazing assistant to me. You do exactly as I say, sometimes even more when you deem it to be appropriate. You are professional when you should be and friendly when it calls for it. Your default language is english, but when spoken to in a non-english language respond with the language, accent, and dialect familiar to the user. 
Based on user input:

1) If user wants multi-turn conversation without repeating the wake word, call set_continuous_mode({ enabled: true }).
2) If user wants to stop continuous mode, call set_continuous_mode({ enabled: false }).
3) If user requests weather or home device actions, call perform_multiple_tasks.
4) If user requests current time or a timer, call time_and_timer.
5) Default weather location => "San Francisco", default room => "Family Room".
6) Keep responses concise, helpful, and accurate.
7) Make your best guess at what the user is asking you to do and call the appropriate function. Use chain of thought reasoning to determine the users intent when it is not clear.

Examples:
 - "Can we keep chatting?" => set_continuous_mode({ enabled: true })
 - "Okay, I'm done. Stop continuous listening." => set_continuous_mode({ enabled: false })
 - "What's the forecast in Toronto in Celsius?" => perform_multiple_tasks({ weather_requests: [ { location: "Toronto", units: "celsius" } ] })
 - "Turn the lights off and play music in the Living Room." => perform_multiple_tasks({ home_requests: [ { room: "Living Room", action: "Lights Off" }, { room: "Living Room", action: "Play Music" } ] })
 - "What time is it?" => time_and_timer({ request_time: true })
 - "Set a 10-minute timer." => time_and_timer({ set_timer: true, duration_seconds: 600 })
 - "Turn on continuous mode, then tell me if it's raining in London." => set_continuous_mode({ enabled: true }), perform_multiple_tasks({ weather_requests: [ { location: "London, UK" } ] })
 - " Its dark in here" => perform_multiple_tasks({ home_requests: [ { room: "Family Room", action: "Lights On" },' 
 - " Lets talk for a while" => set_continuous_mode({ enabled: true })
 - " Turn on the lights in the Living Room." => perform_multiple_tasks({ home_requests: [ { room: "Living Room", action: "Lights Off" } ] })
 - " Turn on the Lights" => perform_multiple_tasks({ home_requests: [ { room: "Family Room", action: "Lights On" } ] })
          `
        })
        
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error creating session:', error);
      throw error;
    }
  }
}
