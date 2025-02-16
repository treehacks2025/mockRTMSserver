require('dotenv').config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const cors = require('cors');
const https = require('https');
const fetch = require('node-fetch');
const CredentialsManager = require('../utils/credentialsManager');
const FormData = require('form-data');
const OpenAI = require('openai');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const router = express.Router();

// Add middleware
router.use(cors());
router.use(express.json());

// Add middleware for audio/wav files
router.use('/transcribe', express.raw({ 
    type: 'audio/wav',
    limit: '10mb'
}));

// Add middleware for audio/wav files
router.use('/analyze-emotion', express.raw({ 
    type: 'audio/wav',
    limit: '10mb'
}));

// Create a custom HTTPS agent that ignores SSL certificate validation
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Add webhook validation endpoint
router.post("/validate-webhook", async (req, res) => {
    console.log("Received validation request for webhook URL:", req.body.webhookUrl);
    const { webhookUrl } = req.body;
    const credentials = CredentialsManager.loadCredentials();
    const plainToken = crypto.randomBytes(16).toString("base64");

    try {
        console.log("Attempting to validate webhook at URL:", webhookUrl);
        const validationResponse = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                event: "endpoint.url_validation",
                payload: {
                    plainToken: plainToken,
                },
                event_ts: Date.now(),
            }),
            agent: httpsAgent,
            timeout: 5000
        });

        console.log("Validation response status:", validationResponse.status);

        if (!validationResponse.ok) {
            console.log("Validation failed with status:", validationResponse.status);
            return res.json({
                success: false,
                error: `Webhook endpoint returned error ${validationResponse.status}`,
            });
        }

        const data = await validationResponse.json();
        console.log("Validation response data:", data);

        // Verify the response
        const expectedHash = crypto
            .createHmac("sha256", credentials.webhookToken)
            .update(plainToken)
            .digest("hex");

        if (data.plainToken === plainToken && data.encryptedToken === expectedHash) {
            console.log("Validation successful");
            res.json({ success: true });
        } else {
            console.log("Invalid validation response");
            res.json({ success: false, error: "Invalid validation response" });
        }
    } catch (error) {
        console.error("Validation error:", error);
        res.json({ 
            success: false, 
            error: error.message,
            details: error.cause ? error.cause.message : 'No additional details'
        });
    }
});

router.post("/send-webhook", async (req, res) => {
    const { webhookUrl, isNewMeeting, existingPayload } = req.body;
    
    try {
        let payload;
        if (isNewMeeting || !existingPayload) {
            // Generate new payload for new meetings
            const credentials = CredentialsManager.loadCredentials();
            const credential = getRandomEntry(credentials.auth_credentials);
            const meetingInfo = getRandomEntry(credentials.stream_meeting_info);

            payload = {
                eventType: "meeting.rtms.started",
                eventTime: Date.now(),
                clientId: credential.client_id,
                userId: credential.userID,
                accountId: credential.accountId,
                payload: {
                    event: "meeting.rtms.started",
                    event_ts: Date.now(),
                    payload: {
                        operator_id: credential.userID,
                        object: {
                            meeting_uuid: meetingInfo.meeting_uuid,
                            rtms_stream_id: meetingInfo.rtms_stream_id,
                            server_urls: "ws://0.0.0.0:9092",
                        },
                    },
                },
            };
        } else {
            // Use existing payload for RTMS restart
            payload = existingPayload;
        }

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
            agent: httpsAgent,
            timeout: 5000
        });

        let responseData;
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }

        res.json({
            success: response.ok,
            status: response.status,
            sent: payload,
            response: responseData,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.cause ? error.cause.message : 'No additional details',
            attempted_payload: payload,
        });
    }
});

router.post('/transcribe', async (req, res) => {
    try {
        const model = req.query.model || 'whisper-large-v3-turbo';
        const responseFormat = req.query.response_format || 'json';
        
        if (!req.body || !Buffer.isBuffer(req.body)) {
            throw new Error('Invalid audio data received');
        }

        const tempFilePath = '/tmp/audio.wav';
        fs.writeFileSync(tempFilePath, req.body);

        const form = new FormData();
        form.append('file', fs.createReadStream(tempFilePath));
        form.append('model', model);
        form.append('response_format', responseFormat);

        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                ...form.getHeaders() // FormDataのヘッダーを追加
            },
            body: form
        });

        fs.unlinkSync(tempFilePath);

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Groq API error: ${response.status} - ${errorData}`);
        }

        const result = await response.json();
        res.json(result);
    } catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/text-to-speech', async (req, res) => {
    try {
        const { text, voiceId = "JBFqnCBsd6RMkjVDRZzb" } = req.body;
        
        if (!text) {
            throw new Error('Text is required');
        }

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVENLABS_API_KEY
            },
            body: JSON.stringify({
                text,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.5
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`ElevenLabs API Error: ${response.status} - ${errorData}`);
        }

        // Get audio data as buffer
        const audioBuffer = await response.arrayBuffer();

        console.log('audioBuffer', audioBuffer);
        
        // Save as temporary file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `speech_${timestamp}.mp3`;
        const filePath = path.join('/tmp', filename);
        
        fs.writeFileSync(filePath, Buffer.from(audioBuffer));

        // Send file as response
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        
        // Use streaming to send the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);
        
        // Delete temporary file after streaming is complete
        fileStream.on('end', () => {
            fs.unlinkSync(filePath);
        });

        // Handle stream errors
        fileStream.on('error', (error) => {
            console.error('File stream error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'File streaming error' });
            }
        });

    } catch (error) {
        console.error('Text-to-Speech Error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

router.post('/analyze-expression', async (req, res) => {
    try {
        const { imageUrl, query } = req.body;

        if (!imageUrl || !query) {
            throw new Error('Image URL and query are required');
        }

        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: "You are an expression analyzer. Analyze the facial expression in the image and respond with a JSON object containing whether the expression matches the query and provide explanation. For confidence, use a scale of 0 to 1 where 1 means complete confidence in a match and 0 means complete confidence in no match. Response should be in format: {matches: boolean, confidence: number, explanation: string}"
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: `Does this person's expression show ${query}?` },
                        {
                            type: "image_url",
                            image_url: {
                                url: imageUrl
                            }
                        }
                    ]
                }
            ],
            response_format: { type: "json_object" },
            max_tokens: 500
        });

        if (response.choices[0].finish_reason === "length") {
            throw new Error("Response was truncated due to length");
        }

        if (response.choices[0].finish_reason === "content_filter") {
            throw new Error("Response was filtered due to content restrictions");
        }

        const result = JSON.parse(response.choices[0].message.content);
        res.json(result);

    } catch (error) {
        console.error('Expression Analysis Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.cause ? error.cause.message : 'No additional details'
        });
    }
});

router.post('/analyze-emotion', async (req, res) => {
    try {
        if (!req.body || !Buffer.isBuffer(req.body)) {
            throw new Error('Invalid audio data received');
        }

        // Save audio data to temporary file
        const tempFilePath = '/tmp/audio_analysis.wav';
        fs.writeFileSync(tempFilePath, req.body);

        // Initialize Gemini AI
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

        // Convert audio to base64
        const audioData = {
            inlineData: {
                data: Buffer.from(fs.readFileSync(tempFilePath)).toString("base64"),
                mimeType: "audio/wav"
            },
        };

        const prompt = "Analyze the emotions of the person speaking from the given audio. I will use this analysis to understand how much stress the user is experiencing, so please focus on that aspect and summarize your findings.";

        // Generate content
        const result = await model.generateContent([prompt, audioData]);
        const response = await result.response;

        // Clean up temporary file
        fs.unlinkSync(tempFilePath);

        res.json({
            success: true,
            analysis: response.text(),
        });

    } catch (error) {
        console.error('Emotion Analysis Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.cause ? error.cause.message : 'No additional details'
        });
    }
});

router.post('/analyze-session', async (req, res) => {
    try {
        const { emotionHistory, expressionHistory } = req.body;

        if (!emotionHistory || !expressionHistory) {
            throw new Error('Both emotion and expression history are required');
        }

        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // Organize timeline data
        const timelineData = {
            emotions: emotionHistory.map(entry => ({
                timestamp: new Date(entry.timestamp).toISOString(),
                emotion: entry.emotion
            })),
            expressions: Object.entries(expressionHistory).map(([type, data]) => ({
                type,
                data: data.map(entry => ({
                    timestamp: new Date(entry.timestamp).toISOString(),
                    matches: entry.matches,
                    confidence: entry.confidence,
                    explanation: entry.explanation
                }))
            }))
        };

        const prompt = `
Please analyze the meditation session data provided below. The data includes emotional states and facial expressions tracked throughout the session.

Emotion History:
${JSON.stringify(timelineData.emotions, null, 2)}

Expression History:
${JSON.stringify(timelineData.expressions, null, 2)}

Focus your analysis on:
1. Overall emotional journey throughout the session
2. Progression of relaxation states
3. Key moments or significant changes
4. Recommendations for improvement

Please provide your analysis in the following JSON format:
{
    "emotionalJourney": "Summary of emotional changes",
    "relaxationLevel": "Analysis of relaxation progression",
    "keyMoments": ["List of significant moments"],
    "recommendations": ["List of improvement suggestions"]
}`;

        const response = await openai.chat.completions.create({
            model: "o3-mini",
            messages: [
                {
                    role: "system",
                    content: "You are an AI meditation session analyst specializing in emotional and facial expression analysis."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            response_format: { type: "json_object" },
        });

        const analysis = JSON.parse(response.choices[0].message.content);
        console.log('analysis', analysis);

        res.json({
            success: true,
            analysis
        });

    } catch (error) {
        console.error('Session Analysis Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: error.cause ? error.cause.message : 'No additional details'
        });
    }
});

function getRandomEntry(array) {
    return array[Math.floor(Math.random() * array.length)];
}

module.exports = router;
