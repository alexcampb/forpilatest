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
Current score: 0.9976
DETECTED! Score: 0.9976
Current score: 0.9961
DETECTED! Score: 0.9961
Current score: 0.9944
DETECTED! Score: 0.9944
Current score: 0.9951
DETECTED! Score: 0.9951
Current score: 0.9908
DETECTED! Score: 0.9908
Current score: 0.9947
DETECTED! Score: 0.9947
Current score: 0.9936
DETECTED! Score: 0.9936
Current score: 0.0000^CStopping...
(base) alexworking@DN51qo52 current copy % 


here is the console output when I run the test-wake command on Raspberry Pi with linux.