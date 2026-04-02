# [PRD-AI-02] SPLICE AI: Live Transcription (Whisper)

## 1. 🎯 Objective
Integrate a speech-to-text service to transcribe incoming audio chunks into high-accuracy text in near real-time.

## 2. 🧱 Architecture
- **Inference Engine**: Using OpenAI Whisper (Local or API via FastAPI).
- **Audio Buffer**: Temporary buffering to handle overlapping chunks.
- **WebSocket (FastAPI)**: Send text transcripts back to Electron.

## 3. 🧪 Core Features (Phase 2)
- **Transcription**:
    - Convert audio data to text strings.
    - Low-latency processing (< 1.5s).
- **Text Streaming**:
    - Push live transcripts (partial and final) to the UI.
- **Error Handling**:
    - Gracious handling of noise/silence.
- **Language Support**:
    - Primary support for English (Technical vocabulary).

## 4. 📈 Success Metrics
- Latency between capture and transcript display < 2s.
- WER (Word Error Rate) < 10% on technical terms.

## 5. 🛡️ Security
- Transient storage only during transcription.
- Optional: Configurable data redaction.
