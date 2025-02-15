class ConversationManager {
    constructor() {
        this.currentState = 'INITIAL';
        this.userSelections = {};  // Object to store user selections
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
            // Add additional states here
        };
    }

    async initialize() {
        try {
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

    getCurrentScript() {
        return this.states[this.currentState].script;
    }

    async playScript(script) {
        try {
            const audioBlob = await APIHandler.textToSpeech(script);
            console.log('Audio blob created for script');
            const blobUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(blobUrl);

            await audio.play();
            audio.onended = () => {
                URL.revokeObjectURL(blobUrl);
            };
            return true;
        } catch (error) {
            console.error('Failed to play script audio:', error);
            UIController.showError(`Failed to play script audio: ${error.message}`);
            throw error;
        }
    }

    async processTranscript(transcript) {
        const currentStateData = this.states[this.currentState];
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
