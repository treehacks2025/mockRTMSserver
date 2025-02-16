class APIHandler {
    static async validateWebhook() {
        try {
            const webhookUrl = document.getElementById("webhookUrl").value;
            UIController.addSystemLog('Webhook', 'Validation request sent', { url: webhookUrl });

            const response = await fetch("/api/validate-webhook", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ webhookUrl }),
            });

            const data = await response.json();

            if (data.success) {
                UIController.addSystemLog('Webhook', 'Validation successful');
                // Enable the start meeting button
                document.getElementById("sendBtn").disabled = false;
                // Store the validated URL for later use
                window.validatedWebhookUrl = webhookUrl;
            } else {
                UIController.addSystemLog('Webhook', 'Validation failed', { error: data.error });
                document.getElementById("sendBtn").disabled = true;
                window.validatedWebhookUrl = null;
            }
        } catch (error) {
            console.error("Validation error:", error);
            UIController.addSystemLog('Webhook', 'Validation error', { error: error.message });
            document.getElementById("sendBtn").disabled = true;
            window.validatedWebhookUrl = null;
        }
    }

    static async sendWebhook(isNewMeeting = true) {
        try {
            const webhookUrl = window.validatedWebhookUrl || document.getElementById("webhookUrl").value;
            UIController.addSignalingLog('Sending Meeting Start Request', { webhookUrl });

            // Always send through our server endpoint
            const response = await fetch("/api/send-webhook", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ 
                    webhookUrl,
                    isNewMeeting,
                    existingPayload: isNewMeeting ? null : window.lastWebhookPayload 
                }),
            });

            const data = await response.json();
            
            if (data.success) {
                if (isNewMeeting) {
                    // Store the successful payload for future RTMS starts
                    window.lastWebhookPayload = data.sent;
                }
                await this.handleWebhookResponse(data, webhookUrl);
            } else {
                throw new Error(data.error || "Failed to get webhook payload");
            }
        } catch (error) {
            UIController.addSignalingLog('Meeting Start Error', { error: error.message });
            console.error("Send webhook error:", error);
            document.getElementById("sendBtn").disabled = true;
        }
    }

    static async handleWebhookResponse(payload, webhookUrl) {
        if (payload.success && payload.sent?.payload?.payload?.object?.server_urls) {
            UIController.addSignalingLog('Meeting Start Success', {
                server_urls: payload.sent.payload.payload.object.server_urls
            });
            await MediaHandler.startMediaStream(payload.sent.payload.payload.object.server_urls);
        } else {
            UIController.addSignalingLog('Meeting Start Failed', payload);
            document.getElementById("sendBtn").disabled = true;
        }
    }

    static async transcribeAudio(audioBlob) {
        try {
            UIController.addSystemLog('Groq', 'Sending transcription request');
            
            const url = new URL('/api/transcribe', window.location.origin);
            url.searchParams.append('model', 'whisper-large-v3-turbo');
            url.searchParams.append('response_format', 'json');
    
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'audio/wav'
                },
                body: audioBlob
            });
    
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
    
            const result = await response.json();
            UIController.addSystemLog('Groq', 'Transcription successful');
            
            return result.text;
        } catch (error) {
            console.error("Transcription error:", error);
            UIController.addSystemLog('Groq', 'Transcription error', { error: error.message });
            throw error;
        }
    }

    static async textToSpeech(text, voiceId = "JBFqnCBsd6RMkjVDRZzb") {
        try {
            UIController.addSystemLog('ElevenLabs', 'Sending text-to-speech request');
            
            const response = await fetch("/api/text-to-speech", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ text, voiceId })
            });
    
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error: ${response.status} - ${errorText}`);
            }

            // Verify content type
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('audio/mpeg')) {
                throw new Error('Invalid response content type');
            }

            const audioBlob = await response.blob();
            if (audioBlob.size === 0) {
                throw new Error('Received empty audio response');
            }

            UIController.addSystemLog('ElevenLabs', 'Text-to-speech conversion successful');
            
            return audioBlob;
        } catch (error) {
            console.error("Text-to-speech error:", error);
            UIController.addSystemLog('ElevenLabs', 'Text-to-speech error', { error: error.message });
            throw error;
        }
    }

    static async analyzeEmotion(audioBlob) {
        try {
            UIController.addSystemLog('Gemini', 'Sending emotion analysis request');
            
            const response = await fetch('/api/analyze-emotion', {
                method: 'POST',
                headers: {
                    'Content-Type': 'audio/wav'
                },
                body: audioBlob
            });
    
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
    
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Emotion analysis failed');
            }

            UIController.addSystemLog('Gemini', 'Emotion analysis completed');
            
            return result.analysis;
        } catch (error) {
            console.error("Emotion analysis error:", error);
            UIController.addSystemLog('Gemini', 'Emotion analysis error', { error: error.message });
            throw error;
        }
    }
}
