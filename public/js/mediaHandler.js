class MediaHandler {
    static async startMediaStream(serverUrl) {
        console.log("Starting media stream with URL:", serverUrl);
        try {
            UIController.addSignalingLog('Starting Media Stream', { serverUrl });
            
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
        const logDebug = (msg) => {
            console.log(`[Speech Recognition] ${msg}`);
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: `[Speech Recognition] ${msg}` }
                }));
            }
        };

        logDebug('Setting up Speech Recognition');
        
        if ('webkitSpeechRecognition' in window) {
            RTMSState.recognition = new webkitSpeechRecognition();
            RTMSState.recognition.continuous = true;
            RTMSState.recognition.interimResults = true;
            RTMSState.recognition.lang = 'en-US';

            // 各種イベントハンドラーの追加
            RTMSState.recognition.onstart = () => logDebug('Recognition started');
            RTMSState.recognition.onend = () => {
                // 終了理由をより詳しく調査
                const audioTracks = RTMSState.mediaStream?.getAudioTracks() || [];
                logDebug('Recognition ended. Debugging info:');
                logDebug(`- Audio tracks: ${audioTracks.length}`);
                audioTracks.forEach((track, index) => {
                    logDebug(`- Track ${index}: enabled=${track.enabled}, muted=${track.muted}, readyState=${track.readyState}`);
                });
                logDebug(`- Network status: ${navigator.onLine ? 'online' : 'offline'}`);

                if (RTMSState.sessionState === CONFIG.STATES.ACTIVE && RTMSState.isStreamingEnabled) {
                    setTimeout(() => {
                        try {
                            RTMSState.recognition.start();
                            logDebug('Recognition restarted');
                        } catch (error) {
                            logDebug(`Failed to restart recognition: ${error.message}`);
                        }
                    }, 1000);
                }
            };
            RTMSState.recognition.onerror = (event) => {
                logDebug(`Recognition error: ${event.error}`);
                logDebug(`Error details: ${JSON.stringify({
                    error: event.error,
                    message: event.message,
                    timestamp: new Date().toISOString()
                })}`);
            };
            RTMSState.recognition.onnomatch = () => logDebug('No speech was recognized');

            RTMSState.recognition.onresult = (event) => {
                let transcript = '';
                logDebug(`Processing ${event.results.length} results`);
                
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        transcript += event.results[i][0].transcript;
                        logDebug(`Final transcript: ${transcript}`);
                    } else {
                        logDebug(`Interim result: ${event.results[i][0].transcript}`);
                    }
                }
                
                // Update UI
                document.getElementById('transcript').innerText = transcript;

                // Send transcript through WebSocket
                if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN && transcript) {
                    logDebug('Sending transcript to server');
                    RTMSState.mediaSocket.send(JSON.stringify({
                        msg_type: "MEDIA_DATA_TRANSCRIPT",
                        content: {
                            user_id: 0,
                            data: transcript,
                            timestamp: Date.now()
                        }
                    }));
                }
            };

            try {
                RTMSState.recognition.start();
                logDebug('Recognition start command issued');
            } catch (error) {
                logDebug(`Failed to start recognition: ${error.message}`);
            }
        } else {
            logDebug('Speech Recognition API not supported in this browser');
        }
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