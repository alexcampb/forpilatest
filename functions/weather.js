import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Handles weather-related API calls to OpenWeather API
 * @see {@link https://openweathermap.org/current OpenWeather API Documentation}
 */
export class WeatherAPI {
  /**
   * Creates a new WeatherAPI instance
   */
  constructor() {
    /**
     * OpenWeather API key
     * @type {string}
     */
    this.apiKey = process.env.OPENWEATHER_API_KEY;
    if (!this.apiKey) {
      console.warn('Warning: OPENWEATHER_API_KEY not found in environment variables');
    }
  }

  /**
   * Retrieves current weather information for a specified location
   * @param {Object} params - Weather query parameters
   * @param {string} params.location - City name or location
   * @param {string} [params.units='fahrenheit'] - Temperature units ('celsius' or 'fahrenheit')
   * @returns {Promise<Object>} Weather data including temperature, humidity, and conditions
   * @throws {Error} If the API request fails or location is not found
   */
  async getCurrentWeather(params) {
    console.log('\n[WeatherAPI] getCurrentWeather called with params:', JSON.stringify(params, null, 2));
    const { location, units = 'fahrenheit' } = params;
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(location)}&appid=${this.apiKey}&units=${units === 'celsius' ? 'metric' : 'imperial'}`;
      console.log('[WeatherAPI] Fetching from URL:', url.replace(this.apiKey, 'API_KEY'));
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Weather API error: ${response.statusText}`);
      }

      const data = await response.json();
      console.log('[WeatherAPI] Raw response:', JSON.stringify(data, null, 2));
      
      const result = {
        success: true,
        weather: {
          temperature: Math.round(data.main.temp),
          units: units,
          condition: data.weather[0].description,
          humidity: data.main.humidity,
          wind_speed: Math.round(data.wind.speed)
        }
      };
      
      console.log('[WeatherAPI] Formatted response:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error('[WeatherAPI] Error:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}