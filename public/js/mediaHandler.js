class MediaHandler {
    static async startMediaStream(serverUrl) {
        console.log("Starting media stream with URL:", serverUrl);
        try {
            UIController.addSignalingLog('Starting Media Stream', { serverUrl });
            
            // Initialize conversation manager
            RTMSState.conversationManager = new ConversationManager();
            await RTMSState.conversationManager.initialize();
            
            // If we already have a media stream, reuse it
            if (!RTMSState.mediaStream) {
                RTMSState.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                    video: true, 
                    audio: true 
                });
            }

            UIController.addSignalingLog('Media Stream Acquired');
            await this.setupVideoDisplay();
            await this.setupMediaRecorders();
            await this.setupSpeechRecognition();
            
            // Reset streaming state
            RTMSState.isStreamingEnabled = true;
            RTMSState.sessionState = CONFIG.STATES.ACTIVE;
            
            await WebSocketHandler.setupWebSocket(serverUrl);

        } catch (error) {
            UIController.addSignalingLog('Media Stream Error', { error: error.message });
            console.error("Error starting media stream:", error);
            UIController.showError(`Error starting media stream: ${error.message}`);
        }
    }

    static async setupVideoDisplay() {
        const mediaVideo = document.getElementById('mediaVideo');
        mediaVideo.srcObject = RTMSState.mediaStream;
        await mediaVideo.play().catch(e => console.error("Error playing media video:", e));
        UIController.updateButtonStates(true);
    }

    static async setupMediaRecorders() {
        // Only set up new recorders if they don't exist or are in inactive state
        if (!RTMSState.videoRecorder || RTMSState.videoRecorder.state === 'inactive') {
            const videoTrack = RTMSState.mediaStream.getVideoTracks()[0];
            const audioTrack = RTMSState.mediaStream.getAudioTracks()[0];

            // Log to both console and send to server for debugging
            const logDebug = (msg) => {
                console.log(msg);
                if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                    RTMSState.mediaSocket.send(JSON.stringify({
                        msg_type: "DEBUG_LOG",
                        content: { message: msg }
                    }));
                }
            };

            logDebug('Setting up MediaRecorders');
            logDebug(`Audio track: ${audioTrack?.label}`);
            logDebug(`Audio track enabled: ${audioTrack?.enabled}`);

            const videoStream = new MediaStream([videoTrack]);
            const audioStream = new MediaStream([audioTrack]);

            // Configure for more frequent chunks
            const videoConfig = {
                ...CONFIG.MEDIA.VIDEO_CONFIG,
                timeslice: 200
            };
            
            const audioConfig = {
                ...CONFIG.MEDIA.AUDIO_CONFIG,
                timeslice: 20,
                mimeType: 'audio/webm;codecs=opus'
            };

            RTMSState.videoRecorder = new MediaRecorder(videoStream, videoConfig);
            RTMSState.audioRecorder = new MediaRecorder(audioStream, audioConfig);

            logDebug(`Audio recorder state: ${RTMSState.audioRecorder.state}`);
            logDebug(`Audio recorder mimeType: ${RTMSState.audioRecorder.mimeType}`);

            this.setupRecorderEventHandlers();
        }
    }

    static setupRecorderEventHandlers() {
        const logDebug = (msg) => {
            console.log(msg);
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: msg }
                }));
            }
        };

        logDebug('Setting up recorder event handlers');
        
        RTMSState.videoRecorder.ondataavailable = WebSocketHandler.handleVideoData;
        RTMSState.audioRecorder.ondataavailable = (event) => {
            logDebug(`Audio data available, size: ${event.data.size}`);
            // Send audio data directly without conversion first to verify we're getting data
            if (event.data.size > 0 && RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64data = reader.result.split(',')[1];
                    RTMSState.mediaSocket.send(JSON.stringify({
                        msg_type: "MEDIA_DATA_AUDIO",
                        content: {
                            user_id: 0,
                            data: base64data,
                            timestamp: Date.now()
                        }
                    }));
                };
                reader.readAsDataURL(event.data);
            }
        };
        
        RTMSState.audioRecorder.onstart = () => logDebug('Audio recorder started');
        RTMSState.audioRecorder.onpause = () => logDebug('Audio recorder paused');
        RTMSState.audioRecorder.onresume = () => logDebug('Audio recorder resumed');
        RTMSState.audioRecorder.onstop = () => logDebug('Audio recorder stopped');
        RTMSState.audioRecorder.onerror = (e) => logDebug(`Audio recorder error: ${e.name}`);
    }

    static startRecording() {
        try {
            RTMSState.videoRecorder.start(200);
            RTMSState.audioRecorder.start(20);
            console.log('Started recording');
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: 'Started recording' }
                }));
            }
        } catch (error) {
            console.error('Error starting recording:', error);
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: `Error starting recording: ${error.message}` }
                }));
            }
        }
    }

    static stopRecording() {
        if (RTMSState.videoRecorder?.state !== 'inactive') {
            RTMSState.videoRecorder.stop();
        }
        if (RTMSState.audioRecorder?.state !== 'inactive') {
            RTMSState.audioRecorder.stop();
        }
    }

    static toggleMediaTracks(enabled) {
        if (RTMSState.mediaStream) {
            RTMSState.mediaStream.getTracks().forEach(track => {
                track.enabled = enabled;
                console.log(`Track ${track.kind} ${enabled ? 'enabled' : 'disabled'}`);
            });
        }
    }

    static async setupSpeechRecognition() {
        if (!window.ort) {
            console.error('ONNX Runtime Web is not loaded');
            UIController.addSystemLog('Speech', 'ONNX Runtime Web is not loaded');
            return;
        }

        try {
            console.log('Setting up VAD...');
            UIController.addSystemLog('Speech', 'Setting up VAD...');

            const myvad = await vad.MicVAD.new({
                onSpeechStart: () => {
                    console.log('Speech detection started');
                    UIController.addSystemLog('Speech', 'Speech detection started');
                },
                onSpeechEnd: async (audio) => {
                    console.log('Speech detection ended, audio length:', audio.length);
                    UIController.addSystemLog('Speech', `Speech detection ended, audio length: ${audio.length}`);
                    
                    try {
                        // Convert audio data to WAV format
                        const wavBlob = await this.float32ArrayToWav(audio, 16000);
                        
                        // Create a File object from the Blob
                        const audioFile = new File([wavBlob], 'audio.wav', { type: 'audio/wav' });
                        
                        // Send to Groq API through APIHandler
                        const transcript = await APIHandler.transcribeAudio(audioFile);

                        // Send to Gemini API through APIHandler
                        const emotion = await APIHandler.analyzeEmotion(audioFile);

                        console.log('Received transcript:', transcript);
                        console.log('Received emotion:', emotion);

                        // Process conversation state if conversation manager exists
                        if (RTMSState.conversationManager) {
                            const result = await RTMSState.conversationManager.processTranscript(transcript, emotion);
                            if (result.success) {
                                console.log('Conversation progressed:', result.newState);
                                UIController.addSystemLog('Conversation', `State advanced to: ${result.newState}`);
                            }
                        }
                        
                        // Display transcription result
                        document.getElementById('transcript').innerText = transcript;

                        // Send result via WebSocket if connected
                        if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN && transcript) {
                            RTMSState.mediaSocket.send(JSON.stringify({
                                msg_type: "MEDIA_DATA_TRANSCRIPT",
                                content: {
                                    user_id: 0,
                                    data: transcript,
                                    timestamp: Date.now()
                                }
                            }));
                        }

                    } catch (error) {
                        console.error('Speech recognition error:', error);
                        UIController.addSystemLog('Speech', 'Speech recognition error', { error: error.message });
                    }
                },
                onError: (error) => {
                    console.error('VAD error:', error);
                    UIController.addSystemLog('Speech', 'VAD error', { error: error.message });
                }
            });

            // Save VAD instance to RTMSState
            RTMSState.vad = myvad;
            
            // Remove state check and start VAD immediately
            console.log('Starting VAD...');
            UIController.addSystemLog('Speech', 'Starting VAD...');
            
            try {
                await myvad.start();
                console.log('VAD started successfully');
                UIController.addSystemLog('Speech', 'VAD started successfully');
            } catch (startError) {
                console.error('Failed to start VAD:', startError);
                UIController.addSystemLog('Speech', 'Failed to start VAD', { error: startError.message });
            }

        } catch (error) {
            console.error('Speech recognition setup error:', error);
            UIController.addSystemLog('Speech', 'Setup error', { error: error.message });
        }
    }

    static async float32ArrayToWav(float32Array, sampleRate) {
        const buffer = new ArrayBuffer(44 + float32Array.length * 2);
        const view = new DataView(buffer);

        // WAVヘッダーの書き込み
        const writeString = (view, offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 32 + float32Array.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, float32Array.length * 2, true);

        // 音声データの書き込み
        const volume = 0.5;
        for (let i = 0; i < float32Array.length; i++) {
            const sample = Math.max(-1, Math.min(1, float32Array[i]));
            view.setInt16(44 + i * 2, sample * 0x7FFF * volume, true);
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    static cleanup() {
        if (RTMSState.mediaStream) {
            RTMSState.mediaStream.getTracks().forEach(track => track.stop());
        }
        if (RTMSState.recognition) {
            RTMSState.recognition.stop();
        }
        document.getElementById('mediaVideo').srcObject = null;
    }
} 