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
            await this.setupVideoProcessor();
            
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
        if (!RTMSState.videoRecorder || RTMSState.videoRecorder.state === 'inactive') {
            const videoTrack = RTMSState.mediaStream.getVideoTracks()[0];
            const audioTrack = RTMSState.mediaStream.getAudioTracks()[0];

            const videoStream = new MediaStream([videoTrack]);
            const audioStream = new MediaStream([audioTrack]);

            // Configure video recorder to output frames directly
            const videoConfig = {
                ...CONFIG.MEDIA.VIDEO_CONFIG,
                mimeType: 'video/webm;codecs=vp8',  // Use VP8 for better browser support
                videoBitsPerSecond: 1000000,        // 1 Mbps
                timeslice: 100                      // Capture frame every 100ms
            };
            
            const audioConfig = {
                ...CONFIG.MEDIA.AUDIO_CONFIG,
                timeslice: 20,
                mimeType: 'audio/webm;codecs=opus'
            };

            RTMSState.videoRecorder = new MediaRecorder(videoStream, videoConfig);
            RTMSState.audioRecorder = new MediaRecorder(audioStream, audioConfig);

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

    static async setupVideoProcessor() {
        const logDebug = (msg) => {
            console.log(`[Video Processor] ${msg}`);
            if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "DEBUG_LOG",
                    content: { message: `[Video Processor] ${msg}` }
                }));
            }
        };

        logDebug('Setting up Video Processor');
        
        if (!RTMSState.videoRecorder) {
            logDebug('Video recorder not initialized');
            return;
        }

        RTMSState.videoRecorder.ondataavailable = async (event) => {
            logDebug(`Frame received: ${event.data.size} bytes`);
            
            if (event.data.size > 0) {
                try {
                    // Create an image capture from the video track
                    const videoTrack = RTMSState.mediaStream.getVideoTracks()[0];
                    const imageCapture = new ImageCapture(videoTrack);
                    
                    // Capture a frame as a Blob
                    const bitmap = await imageCapture.grabFrame();
                    
                    // Create canvas and draw the frame
                    const canvas = document.createElement('canvas');
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(bitmap, 0, 0);
                    
                    // Convert to PNG base64
                    const pngBase64 = canvas.toDataURL('image/png').split(',')[1];
                    
                    if (RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                        RTMSState.mediaSocket.send(JSON.stringify({
                            msg_type: "MEDIA_DATA_VIDEO",
                            content: {
                                user_id: 0,
                                data: pngBase64,
                                timestamp: Date.now(),
                                format: 'png'
                            }
                        }));
                    }

                    // Cleanup
                    canvas.remove();
                    
                } catch (error) {
                    logDebug(`Error processing frame: ${error.message}`);
                    logDebug(`Blob type: ${event.data.type}`);
                    logDebug(`Blob size: ${event.data.size}`);
                }
            }
        };

        // Keep the existing event handlers
        RTMSState.videoRecorder.onstart = () => logDebug('Video recorder started');
        RTMSState.videoRecorder.onstop = () => logDebug('Video recorder stopped');
        RTMSState.videoRecorder.onpause = () => logDebug('Video recorder paused');
        RTMSState.videoRecorder.onresume = () => logDebug('Video recorder resumed');
        RTMSState.videoRecorder.onerror = (error) => {
            logDebug(`Video recorder error: ${JSON.stringify({
                error: error.name,
                message: error.message,
                timestamp: new Date().toISOString()
            })}`);
        };
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

