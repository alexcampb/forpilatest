Here is the console output when i run the test-wake command on Mac.

(base) alexworking@DN51qo52 current copy % npm run test-wake

> openai-realtime-chat@1.0.0 test-wake
> source venv/bin/activate && python3 openwakeword_detector.py

Downloading models...
Initializing model...

Available audio input devices:
Input Device id 1 - oscars iphone Microphone
Input Device id 2 - MacBook Air Microphone
Using first available device: oscars iphone Microphone

Starting audio stream...
##################################################
Listening for wake word 'Hey Jarvis'...
##################################################
Note: When speaking, try to:
1. Speak clearly and at a normal volume
2. Be in a quiet environment
3. Say 'Hey Jarvis' naturally
Any detected audio will be saved to the 'debug_audio' folder
Current score: 0.6799
DETECTED! Score: 0.6799
Current score: 0.9195
DETECTED! Score: 0.9195
Current score: 0.8975
DETECTED! Score: 0.8975
Current score: 0.9411
DETECTED! Score: 0.9411
Current score: 0.9195
DETECTED! Score: 0.9195
Current score: 0.8380
DETECTED! Score: 0.8380
Current score: 0.6841
DETECTED! Score: 0.6841
Current score: 0.6404
DETECTED! Score: 0.6404
Current score: 0.5870
DETECTED! Score: 0.5870
Current score: 0.9549
DETECTED! Score: 0.9549
Current score: 0.9425
DETECTED! Score: 0.9425
Current score: 0.0000^CStopping...
(base) alexworking@DN51qo52 current copy % 


Here is the console output when i run the test-wake command on Linux/Raspberry Pi.

