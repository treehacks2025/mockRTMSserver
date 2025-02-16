class ConversationManager {
    constructor() {
        this.currentState = 'EXPRESSION_CHECK';
        this.userSelections = {};  // Object to store user selections
        this.expressionStates = {
            furrowed: {
                matches: false,
                confidence: 0,
                explanation: ''
            },
            smiling: {
                matches: false,
                confidence: 0,
                explanation: ''
            },
            relaxed: {
                matches: false,
                confidence: 0,
                explanation: ''
            },
            eyesClosed: {
                matches: false,
                confidence: 0,
                explanation: ''
            },
            eyesFocused: {
                matches: false,
                confidence: 0,
                explanation: ''
            }
        };
        this.expressionHistory = {
            furrowed: [],
            smiling: [],
            relaxed: [],
            eyesClosed: [],
            eyesFocused: []
        };
        this.expressionCheckInterval = null;
        this.states = {
            INITIAL: {
                script: `Good morning, Taiki. Discover peace in every sip. This is the beginning of your first tea ritual.
                You have a couple of options here. You can start your first ritual now.
                If you're ready, simply say 'Start'.`,
                nextTrigger: 'start',
                nextState: 'CHECK_IN'
            },
            CHECK_IN: {
                script: `You're at the Check-In. Begin heating your water. Don't add your center me™ tea stick yet!
                We will guide you in preparing your tea after you check in and select today's practice.
                To proceed, say 'Check in'.`,
                nextTrigger: 'check in',
                nextState: 'FEELING_CHECK'
            },
            FEELING_CHECK: {
                script: `Check-In. How are you feeling today?
                You can choose from: Great, Good, Okay, Meh, or Bad.
                Please let me know your choice.`,
                nextTriggers: ['great', 'good', 'okay', 'meh', 'bad'],
                nextState: 'STRESS_CHECK',
                saveSelection: 'feeling'
            },
            STRESS_CHECK: {
                script: `Thank you for sharing. Now, let's check your stress level.
                Please adjust the slider to indicate how stressed you're feeling right now.
                You can choose from: Very Low, Low, Medium, High, or Very High.`,
                nextTriggers: ['very low', 'low', 'medium', 'high', 'very high'],
                nextState: 'PREPARE_WATER',
                saveSelection: 'stressLevel'
            },
            PREPARE_WATER: {
                script: `Almost there! Is your water ready?
                Here's what to do next: Pour a half cup, that's four ounces, of boiling water into your favorite teacup.
                When you've done that, say 'Ready'.`,
                nextTrigger: 'ready',
                nextState: 'PREPARE_TEA_STICK'
            },
            PREPARE_TEA_STICK: {
                script: `Now, unwrap a center me™ tea stick and set it aside. Once you've done that, say 'Ready'.`,
                nextTrigger: 'ready',
                nextState: 'PREPARE_SPACE'
            },
            PREPARE_SPACE: {
                script: `Prepare your space. Find a quiet and comfortable place to sit. When you're ready, say 'Ready'.`,
                nextTrigger: 'ready',
                nextState: 'SPACE_READY'
            },
            SPACE_READY: {
                script: `Welcome to your CenterMe ritual.
                By being here, you are showing up in a positive way for yourself
                and your wellbeing.
                I will now guide you
                in preparing your matcha tea.
                Remember,
                every part of this meditation
                is an invitation.
                Feel free to adjust this practice
                to make this time truly
                your own.`,
                duration: 10000, // 10 seconds
                nextState: 'BREATHING_INTRO'
            },
            BREATHING_INTRO: {
                script: `As you settle in,
                take a slow, deliberate breath
                if that feels comfortable.`,
                duration: 5000,
                nextState: 'EXPRESSION_CHECK'
            },
            EXPRESSION_CHECK: {
                script: `Let's take a moment to check your expression.
                I want to make sure you're feeling relaxed.`,
                duration: 3000,
                checkExpression: true,
                expressionQuery: 'signs of furrowed brow or tension between eyebrows',
                outcomes: {
                    false: 'NEXT_BREATHING',
                    true: 'EXPRESSION_RECHECK'
                }
            },
            EXPRESSION_RECHECK: {
                script: `I notice you might be feeling tense.
                Let's take another moment to relax.
                Release any tension in your face,
                especially around your eyebrows.
                Take another deep breath.`,
                duration: 5000,
                checkExpression: true,
                expressionQuery: 'signs of facial tension, particularly around the forehead and eyebrows, or any stress indicators in facial muscles',
                outcomes: {
                    false: 'NEXT_BREATHING',
                    true: 'NEXT_BREATHING'
                }
            },
            NEXT_BREATHING: {
                script: `Very good.
                Now, let's continue with our practice.`,
                duration: 3000,
                nextState: 'NEXT_STATE'
            },
            // Add additional states here
        };
    }

    async initialize() {
        try {
            // Start periodic expression checks
            this.startExpressionChecks();
            
            await this.playScript(this.getCurrentScript());
            return {
                success: true,
                state: this.currentState
            };
        } catch (error) {
            console.error('Failed to initialize conversation:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    startExpressionChecks() {
        if (this.expressionCheckInterval) {
            clearInterval(this.expressionCheckInterval);
        }

        this.expressionCheckInterval = setInterval(async () => {
            try {
                const timestamp = Date.now();
                
                // Check for furrowed brow
                const furrowedResult = await this.analyzeExpression('signs of furrowed brow or tension between eyebrows');
                this.expressionStates.furrowed = furrowedResult;
                this.expressionHistory.furrowed.push({ ...furrowedResult, timestamp });

                // Check for smile
                const smilingResult = await this.analyzeExpression('upturned corners of the mouth or signs of smiling');
                this.expressionStates.smiling = smilingResult;
                this.expressionHistory.smiling.push({ ...smilingResult, timestamp });

                // Check for relaxed expression
                const relaxedResult = await this.analyzeExpression('overall relaxed facial expression without tension');
                this.expressionStates.relaxed = relaxedResult;
                this.expressionHistory.relaxed.push({ ...relaxedResult, timestamp });

                // New eye state checks
                const eyesClosedResult = await this.analyzeExpression('eyes closed or nearly closed');
                this.expressionStates.eyesClosed = eyesClosedResult;
                this.expressionHistory.eyesClosed.push({ ...eyesClosedResult, timestamp });

                const eyesFocusedResult = await this.analyzeExpression('eyes focused and steady, looking directly at camera, not wandering or darting around');
                this.expressionStates.eyesFocused = eyesFocusedResult;
                this.expressionHistory.eyesFocused.push({ ...eyesFocusedResult, timestamp });

                // Update UI with current states and history
                UIController.updateExpressionStates(this.expressionStates);
                UIController.updateExpressionDashboard(this.expressionHistory);

            } catch (error) {
                console.error('Expression check error:', error);
            }
        }, 3000);
    }

    async analyzeExpression(query) {
        try {
            const videoElement = document.getElementById('mediaVideo');
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoElement, 0, 0);
            
            const imageUrl = canvas.toDataURL('image/jpeg');
            
            const response = await fetch('/api/analyze-expression', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    imageUrl,
                    query
                })
            });

            if (!response.ok) {
                throw new Error('Expression analysis failed');
            }

            return await response.json();
        } catch (error) {
            console.error('Expression analysis error:', error);
            return { matches: false, confidence: 0, explanation: 'Failed to analyze expression' };
        }
    }

    cleanup() {
        if (this.expressionCheckInterval) {
            clearInterval(this.expressionCheckInterval);
            this.expressionCheckInterval = null;
        }
    }

    getCurrentScript() {
        return this.states[this.currentState].script;
    }

    async playScript(script) {
        try {
            const audioBlob = await APIHandler.textToSpeech(script);
            const blobUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(blobUrl);

            await audio.play();
            
            audio.onended = async () => {
                URL.revokeObjectURL(blobUrl);
                
                const currentStateData = this.states[this.currentState];
                if (currentStateData.duration) {
                    setTimeout(async () => {
                        let nextState;
                        
                        if (currentStateData.checkExpression) {
                            const expressionResult = await this.checkFrownExpression();
                            console.log('expressionResult', expressionResult);
                            nextState = currentStateData.outcomes[expressionResult.matches];
                        } else {
                            nextState = currentStateData.nextState;
                        }

                        if (this.states[nextState]) {
                            this.currentState = nextState;
                            const nextScript = this.states[nextState].script;
                            await this.playScript(nextScript);
                        }
                    }, currentStateData.duration);
                }
            };
            
            return true;
        } catch (error) {
            console.error('Failed to play script audio:', error);
            UIController.showError(`Failed to play script audio: ${error.message}`);
            throw error;
        }
    }

    async checkFrownExpression() {
        return this.expressionStates.furrowed;
    }

    async processTranscript(transcript) {
        const currentStateData = this.states[this.currentState];
        // continue with the existing trigger-based processing
        const normalizedTranscript = transcript.toLowerCase();
        
        // Check both single and multiple triggers
        const triggers = currentStateData.nextTriggers || [currentStateData.nextTrigger];
        const matchedTrigger = triggers.find(trigger => normalizedTranscript.includes(trigger));
        
        if (matchedTrigger) {
            // Save selection if applicable
            if (currentStateData.saveSelection) {
                this.userSelections[currentStateData.saveSelection] = matchedTrigger;
            }

            const nextState = currentStateData.nextState;
            if (this.states[nextState]) {
                this.currentState = nextState;
                const nextScript = this.states[nextState].script;
                
                try {
                    await this.playScript(nextScript);
                    return {
                        success: true,
                        newState: nextState,
                        script: nextScript,
                        selection: matchedTrigger
                    };
                } catch (error) {
                    return {
                        success: false,
                        error: error.message
                    };
                }
            }
        }
        
        return {
            success: false,
            message: 'No matching trigger found in transcript'
        };
    }

    isComplete() {
        return !this.states[this.currentState].nextState;
    }

    // New method to get user selections
    getSelection(key) {
        return this.userSelections[key];
    }
}
