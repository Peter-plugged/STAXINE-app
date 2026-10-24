document.addEventListener('DOMContentLoaded', () => {
    console.log("STAXINE Chat Initialized.");

    const textarea = document.querySelector('textarea');
    const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Submit'));
    const voiceBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Voice'));
    
    // Find the response box, but let's transform it into a chat log
    let chatLog = document.querySelector('div[style*="Awaiting"]') || Array.from(document.querySelectorAll('div')).find(d => d.innerText.includes('Awaiting prompt execution'));
    if (chatLog) {
        chatLog.innerText = "";
        chatLog.style.height = "300px";
        chatLog.style.overflowY = "auto";
        chatLog.style.display = "flex";
        chatLog.style.flexDirection = "column";
        chatLog.style.gap = "10px";
        chatLog.style.padding = "15px";
        chatLog.style.fontFamily = "monospace";
    }

    function appendMessage(role, text) {
        if (!chatLog) return;
        const msgDiv = document.createElement('div');
        msgDiv.style.padding = "10px";
        msgDiv.style.borderRadius = "8px";
        msgDiv.style.maxWidth = "85%";
        msgDiv.style.wordWrap = "break-word";
        
        if (role === "user") {
            msgDiv.style.alignSelf = "flex-end";
            msgDiv.style.background = "#0055ff";
            msgDiv.style.color = "white";
            msgDiv.innerText = `You: ${text}`;
        } else {
            msgDiv.style.alignSelf = "flex-start";
            msgDiv.style.background = "#1a1a1a";
            msgDiv.style.border = "1px solid #00ffff";
            msgDiv.style.color = "#00ffff";
            msgDiv.innerText = `STAXINE: ${text}`;
        }
        
        chatLog.appendChild(msgDiv);
        chatLog.scrollTop = chatLog.scrollHeight;
    }

    async function sendMessage(text) {
        if (!text.trim()) return;
        appendMessage("user", text);
        if (textarea) textarea.value = "";
        
        try {
            const res = await fetch('http://127.0.0.1:8000/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });
            const data = await res.json();
            appendMessage("staxine", data.response);
        } catch (err) {
            appendMessage("staxine", "Connection failed. Is the Hub running?");
        }
    }

    if (submitBtn && textarea) {
        submitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            sendMessage(textarea.value);
        });
    }

    // --- Voice Recognition ---
    if (voiceBtn && window.webkitSpeechRecognition) {
        const recognition = new webkitSpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;

        voiceBtn.addEventListener('click', () => {
            voiceBtn.innerText = "🎙️ Listening...";
            voiceBtn.style.background = "#ff0033";
            recognition.start();
        });

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            voiceBtn.innerText = "🎤 Voice";
            voiceBtn.style.background = "";
            sendMessage(transcript);
        };

        recognition.onerror = () => {
            voiceBtn.innerText = "🎤 Voice";
            voiceBtn.style.background = "";
        };
    }

    // --- Load Agent Buttons (from previous steps) ---
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = "padding: 20px; display: flex; flex-direction: column; gap: 10px;";
    document.body.appendChild(btnContainer);

    function createBtn(text, color, endpoint, payload) {
        const btn = document.createElement('button');
        btn.innerText = text;
        btn.style.cssText = `width: 100%; padding: 15px; background: ${color}; color: black; border: none; border-radius: 8px; font-weight: bold; font-family: monospace; cursor: pointer; box-shadow: 0 0 10px ${color};`;
        btnContainer.appendChild(btn);

        btn.addEventListener('click', async () => {
            appendMessage("user", `[Command: ${text}]`);
            btn.innerText = "🔄 Processing...";
            btn.style.background = "#888";
            try {
                const res = await fetch(`http://127.0.0.1:8000${endpoint}`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
                });
                const data = await res.json();
                appendMessage("staxine", `[Result]:\n${JSON.stringify(data.result || data, null, 2)}`);
            } catch (err) {
                appendMessage("staxine", "Connection Failed.");
            }
            btn.innerText = text; btn.style.background = color;
        });
    }

    createBtn("🧠 RUN UNIFIED BRAIN ANALYSIS", "linear-gradient(90deg, #ff00cc, #3333ff)", "/unified_predict", {ticker: "AAPL"});
    createBtn("🌐 Browse Web (Crypto News)", "#00ccff", "/omni/execute", {action: "browse", query: "latest Bitcoin news"});
    createBtn("👁️ See Image (Chart)", "#ffcc00", "/omni/execute", {action: "see", image_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/Bitcoin.svg/1200px-Bitcoin.svg.png", prompt: "What is this image?"});
});

// ==========================================
// GEMINI LIVE API (REAL-TIME CONVERSATION)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const liveVoiceBtn = document.getElementById('liveVoiceBtn');
    const responseBox = document.querySelector('div[style*="Awaiting"]');
    
    let ws = null;
    let audioContext = null;
    let mediaStream = null;
    let processor = null;
    let isRecording = false;
    let playbackQueue = [];
    let isPlaying = false;

    // --- 1. Start Live Session ---
    async function startLiveSession() {
        if (ws) return;
        
        // Connect to the WebSocket proxy
        ws = new WebSocket(`ws://${window.location.hostname}:8000/ws/live`);
        
        ws.onopen = () => {
            console.log("Live WebSocket Connected");
            if (responseBox) responseBox.innerText = "🔴 Live Session Active. Speak now...";
            startMicrophone();
        };

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            handleGeminiMessage(msg);
        };

        ws.onclose = () => {
            console.log("Live WebSocket Closed");
            stopMicrophone();
            if (responseBox) responseBox.innerText = "Live session ended.";
        };
    }

    // --- 2. Handle Gemini Messages (Audio & Interruption) ---
    function handleGeminiMessage(msg) {
        if (msg.serverContent) {
            const serverContent = msg.serverContent;
            
            // Check for interruption
            if (serverContent.interrupted) {
                console.log("🛑 Interrupted by user. Clearing audio queue.");
                playbackQueue = [];
                isPlaying = false;
                return;
            }

            // Handle audio chunks
            if (serverContent.modelTurn && serverContent.modelTurn.parts) {
                for (const part of serverContent.modelTurn.parts) {
                    if (part.inlineData && part.inlineData.mimeType.startsWith("audio/pcm")) {
                        const audioData = base64ToArrayBuffer(part.inlineData.data);
                        playbackQueue.push(audioData);
                        if (!isPlaying) playNextChunk();
                    }
                }
            }
        }
    }

    // --- 3. Microphone Capture & Resampling ---
    async function startMicrophone() {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioContext = new AudioContext({ sampleRate: 16000 }); // Gemini expects 16kHz
            const source = audioContext.createMediaStreamSource(mediaStream);
            
            processor = audioContext.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
                if (!ws || ws.readyState !== WebSocket.OPEN) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                const pcm16 = floatTo16BitPCM(inputData);
                const base64Audio = arrayBufferToBase64(pcm16.buffer);
                
                // Send audio to Gemini
                ws.send(JSON.stringify({
                    realtimeInput: {
                        mediaChunks: [{
                            mimeType: "audio/pcm;rate=16000",
                            data: base64Audio
                        }]
                    }
                }));
            };
            
            source.connect(processor);
            processor.connect(audioContext.destination);
            isRecording = true;
            
        } catch (err) {
            console.error("Microphone error:", err);
            if (responseBox) responseBox.innerText = "Microphone access denied.";
        }
    }

    // --- 4. Audio Playback ---
    function playNextChunk() {
        if (playbackQueue.length === 0) {
            isPlaying = false;
            return;
        }
        
        isPlaying = true;
        const audioData = playbackQueue.shift();
        
        // Gemini sends 24kHz audio
        const playbackCtx = new AudioContext({ sampleRate: 24000 });
        const buffer = playbackCtx.createBuffer(1, audioData.byteLength / 2, 24000);
        const channelData = buffer.getChannelData(0);
        const int16Data = new Int16Array(audioData);
        
        for (let i = 0; i < int16Data.length; i++) {
            channelData[i] = int16Data[i] / 32768.0;
        }
        
        const source = playbackCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(playbackCtx.destination);
        source.onended = () => {
            playbackCtx.close();
            playNextChunk();
        };
        source.start();
    }

    // --- Utility Functions ---
    function floatTo16BitPCM(input) {
        const output = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return output;
    }

    function arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function stopMicrophone() {
        if (processor) processor.disconnect();
        if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
        if (audioContext) audioContext.close();
        isRecording = false;
    }

    // --- Add the Live Button to your UI ---
    if (!document.getElementById('liveVoiceBtn')) {
        const liveBtn = document.createElement('button');
        liveBtn.id = "liveVoiceBtn";
        liveBtn.innerText = "🎙️ Start Live Conversation";
        liveBtn.style.cssText = "width: 100%; padding: 20px; margin-top: 20px; background: linear-gradient(90deg, #ff00cc, #3333ff); color: white; border: none; border-radius: 8px; font-weight: bold; font-size: 16px; cursor: pointer; box-shadow: 0 0 15px #ff00cc;";
        document.body.appendChild(liveBtn);
        
        liveBtn.addEventListener('click', () => {
            if (isRecording) {
                ws.close();
                liveBtn.innerText = "🎙️ Start Live Conversation";
                liveBtn.style.background = "linear-gradient(90deg, #ff00cc, #3333ff)";
            } else {
                startLiveSession();
                liveBtn.innerText = "🔴 Live Conversation Active (Tap to Stop)";
                liveBtn.style.background = "#ff0033";
            }
        });
    }
});
