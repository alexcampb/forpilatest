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

annot connect to server socket err = No such file or directory
Cannot connect to server request channel
jack server is not running or cannot be started
JackShmReadWritePtr::~JackShmReadWritePtr - Init not done for -1, skipping unlock
JackShmReadWritePtr::~JackShmReadWritePtr - Init not done for -1, skipping unlock
Cannot connect to server socket err = No such file or directory
Cannot connect to server request channel
jack server is not running or cannot be started
JackShmReadWritePtr::~JackShmReadWritePtr - Init not done for -1, skipping unlock
JackShmReadWritePtr::~JackShmReadWritePtr - Init not done for -1, skipping unlock
ALSA lib pcm_oss.c:397:(_snd_pcm_oss_open) Cannot open device /dev/dsp
ALSA lib pcm_oss.c:397:(_snd_pcm_oss_open) Cannot open device /dev/dsp
ALSA lib pcm_a52.c:1001:(_snd_pcm_a52_open) a52 is only for playback
ALSA lib conf.c:5670:(snd_config_expand) Unknown parameters {AES0 0x6 AES1 0x82 AES2 0x0 AES3 0x2 CARD 0}
ALSA lib pcm.c:2666:(snd_pcm_open_noupdate) Unknown PCM iec958:{AES0 0x6 AES1 0x82 AES2 0x0 AES3 0x2 CARD 0}
ALSA lib pcm_plug.c:835:(snd_pcm_plug_hw_refine_schange) Unable to find an usable slave format for 'plug:hw'
ALSA lib pcm_plug.c:839:(snd_pcm_plug_hw_refine_schange) Format: S16_LE
ALSA lib pcm_plug.c:844:(snd_pcm_plug_hw_refine_schange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:924:(snd_pcm_plug_hw_refine_cchange) Unable to find an usable client format
ALSA lib pcm_plug.c:928:(snd_pcm_plug_hw_refine_cchange) Format: S16_LE
ALSA lib pcm_plug.c:933:(snd_pcm_plug_hw_refine_cchange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:835:(snd_pcm_plug_hw_refine_schange) Unable to find an usable slave format for 'plug:hw'
ALSA lib pcm_plug.c:839:(snd_pcm_plug_hw_refine_schange) Format: S16_LE
ALSA lib pcm_plug.c:844:(snd_pcm_plug_hw_refine_schange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:924:(snd_pcm_plug_hw_refine_cchange) Unable to find an usable client format
ALSA lib pcm_plug.c:928:(snd_pcm_plug_hw_refine_cchange) Format: S16_LE
ALSA lib pcm_plug.c:933:(snd_pcm_plug_hw_refine_cchange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:835:(snd_pcm_plug_hw_refine_schange) Unable to find an usable slave format for 'plug:hw'
ALSA lib pcm_plug.c:839:(snd_pcm_plug_hw_refine_schange) Format: S16_LE
ALSA lib pcm_plug.c:844:(snd_pcm_plug_hw_refine_schange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:924:(snd_pcm_plug_hw_refine_cchange) Unable to find an usable client format
ALSA lib pcm_plug.c:928:(snd_pcm_plug_hw_refine_cchange) Format: S16_LE
ALSA lib pcm_plug.c:933:(snd_pcm_plug_hw_refine_cchange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:835:(snd_pcm_plug_hw_refine_schange) Unable to find an usable slave format for 'plug:hw'
ALSA lib pcm_plug.c:839:(snd_pcm_plug_hw_refine_schange) Format: S16_LE
ALSA lib pcm_plug.c:844:(snd_pcm_plug_hw_refine_schange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:924:(snd_pcm_plug_hw_refine_cchange) Unable to find an usable client format
ALSA lib pcm_plug.c:928:(snd_pcm_plug_hw_refine_cchange) Format: S16_LE
ALSA lib pcm_plug.c:933:(snd_pcm_plug_hw_refine_cchange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:835:(snd_pcm_plug_hw_refine_schange) Unable to find an usable slave format for 'plug:hw'
ALSA lib pcm_plug.c:839:(snd_pcm_plug_hw_refine_schange) Format: S16_LE
ALSA lib pcm_plug.c:844:(snd_pcm_plug_hw_refine_schange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:924:(snd_pcm_plug_hw_refine_cchange) Unable to find an usable client format
ALSA lib pcm_plug.c:928:(snd_pcm_plug_hw_refine_cchange) Format: S16_LE
ALSA lib pcm_plug.c:933:(snd_pcm_plug_hw_refine_cchange) Slave format: IEC958_SUBFRAME_LE
ALSA lib pcm_plug.c:933:(snd_pcm_plug_hw_refine_cchange) Slave format: IEC958_SUBFRAME_LE
ALSA lib confmisc.c:160:(snd_config_get_card) Invalid field card
ALSA lib pcm_usb_stream.c:482:(_snd_pcm_usb_stream_open) Invalid card 'card'
ALSA lib confmisc.c:160:(snd_config_get_card) Invalid field card
ALSA lib pcm_usb_stream.c:482:(_snd_pcm_usb_stream_open) Invalid card 'card'
ALSA lib pcm_direct.c:1258:(snd1_pcm_direct_initialize_slave) requested or auto-format is not available
ALSA lib pcm_dmix.c:1011:(snd_pcm_dmix_open) unable to initialize slave
ALSA lib ../pipewire-alsa/alsa-plugins/pcm_pipewire.c:1406:(_snd_pcm_pipewire_open) Unknown field playback
ALSA lib ../pipewire-alsa/alsa-plugins/pcm_pipewire.c:1406:(_snd_pcm_pipewire_open) Unknown field playback
Cannot connect to server socket err = No such file or directory
Cannot connect to server request channel
jack server is not running or cannot be started
JackShmReadWritePtr::~JackShmReadWritePtr - Init not done for -1, skipping unlock
JackShmReadWritePtr::~JackShmReadWritePtr - Init not done for -1, skipping unlock

Available audio input devices:
Input Device id 3 - pipewire
Selected PipeWire device: pipewire

Starting audio stream...
##################################################
Listening for wake word 'Hey Jarvis'...
##################################################
Note: When speaking, try to:
1. Speak clearly and at a normal volume
2. Be in a quiet environment
3. Say 'Hey Jarvis' naturally
Any detected audio will be saved to the 'debug_audio' folder
Current score: 0.0000^CStopping...

jarvis@raspberrypi:~/forpilatest $ 
