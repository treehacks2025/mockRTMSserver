class SentimentAnalyzer {
    static async analyzeSentiment(imageData) {
        try {
            // Send frame to backend sentiment analysis endpoint
            const response = await fetch('/api/analyze-sentiment', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ imageData })
            });
            
            return await response.json();
        } catch (error) {
            console.error('Sentiment analysis error:', error);
            return null;
        }
    }

    static setupSentimentStream() {
        if (RTMSState.sentimentInterval) {
            clearInterval(RTMSState.sentimentInterval);
        }

        const captureAndAnalyze = async () => {
            if (!RTMSState.mediaStream || !RTMSState.isStreamingEnabled) return;

            // Create canvas for frame capture
            const canvas = document.createElement('canvas');
            const video = document.getElementById('mediaVideo');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Get frame as base64
            const frameData = canvas.toDataURL('image/jpeg', 0.8);
            
            // Analyze sentiment
            const sentiment = await this.analyzeSentiment(frameData);
            
            if (sentiment && RTMSState.mediaSocket?.readyState === WebSocket.OPEN) {
                RTMSState.mediaSocket.send(JSON.stringify({
                    msg_type: "SENTIMENT_DATA",
                    content: {
                        user_id: 0,
                        data: sentiment,
                        timestamp: Date.now()
                    }
                }));
            }
        };

        // Capture and analyze frame every 2 seconds
        RTMSState.sentimentInterval = setInterval(captureAndAnalyze, 2000);
    }

    static cleanup() {
        if (RTMSState.sentimentInterval) {
            clearInterval(RTMSState.sentimentInterval);
            RTMSState.sentimentInterval = null;
        }
    }
} 