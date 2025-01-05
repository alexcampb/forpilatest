# OpenWake + Continuous

A voice-activated assistant using OpenWakeWord for wake word detection.

## System Requirements

### Linux
- PipeWire (recommended) or system default audio
- ALSA development libraries
```bash
# For Debian/Ubuntu-based systems:
sudo apt-get install pipewire pipewire-pulse
```

### macOS
- Default system audio (no additional requirements)

### Windows
- Default system audio (no additional requirements)

## Installation

1. Install Python dependencies:
```bash
python3 -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
pip install openwakeword pyaudio numpy soundfile
```

2. Install Node.js dependencies:
```bash
npm install
```

## Running the Application

1. Activate the Python virtual environment:
```bash
source venv/bin/activate  # On Windows: .\venv\Scripts\activate
```

2. Start the application:
```bash
npm start
```

## Troubleshooting

### Audio Issues on Linux
- Make sure PipeWire is properly installed and running
- If using PulseAudio, you may need to migrate to PipeWire
- Check audio input devices: `pw-cli ls | grep -i source`
