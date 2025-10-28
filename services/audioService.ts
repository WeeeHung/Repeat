// Helper to decode base64 string to Uint8Array
function decodeBase64(base64: string): Uint8Array {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Helper to decode raw PCM audio data into an AudioBuffer
async function decodePcmData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


class AudioService {
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private isUnlocked = false;

    private init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
        }
    }

    // This method MUST be called from within a user gesture handler (e.g., a click event)
    public unlockAudio() {
        if (this.isUnlocked || typeof window === 'undefined') return;
        this.init();

        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                console.log("AudioContext resumed successfully.");
                this.isUnlocked = true;
                
                // Play a tiny silent sound to "prime" the audio context, especially for iOS.
                if (this.audioContext) {
                    const buffer = this.audioContext.createBuffer(1, 1, 22050);
                    const source = this.audioContext.createBufferSource();
                    source.buffer = buffer;
                    source.connect(this.audioContext.destination);
                    source.start(0);
                }

            }).catch(e => console.error("Error resuming AudioContext:", e));
        } else if (this.audioContext) {
             this.isUnlocked = true;
        }
    }

    public async playTTS(base64Audio: string): Promise<void> {
        this.init();
        if (!this.audioContext || !this.gainNode) return;

        // Resume AudioContext if it's suspended (required for mobile browsers)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        try {
            const audioBytes = decodeBase64(base64Audio);
            const audioBuffer = await decodePcmData(audioBytes, this.audioContext, 24000, 1);
            
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.gainNode);
            source.start();

            return new Promise(resolve => {
                source.onended = () => resolve();
            });

        } catch (error) {
            console.error("Failed to play TTS audio:", error);
        }
    }
}

export const audioService = new AudioService();