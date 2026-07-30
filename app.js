document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const apiKeyModal = document.getElementById('apiKeyModal');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    const skipApiKeyBtn = document.getElementById('skipApiKeyBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const chatBox = document.getElementById('chatBox');
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const recordBtn = document.getElementById('recordBtn');
    const cancelRecordBtn = document.getElementById('cancelRecordBtn');
    const recordingIndicator = document.getElementById('recordingIndicator');
    const recordingTimer = document.getElementById('recordingTimer');

    // State
    let groqApiKey = localStorage.getItem('groqApiKey') || '';
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordingInterval = null;
    let recordingSeconds = 0;

    // Initialization
    if (!groqApiKey) {
        showModal();
    }

    // Modal Events
    saveApiKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            groqApiKey = key;
            localStorage.setItem('groqApiKey', key);
            hideModal();
        }
    });

    skipApiKeyBtn.addEventListener('click', hideModal);
    settingsBtn.addEventListener('click', showModal);

    function showModal() {
        apiKeyInput.value = groqApiKey;
        apiKeyModal.classList.add('active');
    }

    function hideModal() {
        apiKeyModal.classList.remove('active');
    }

    // Chat Events
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (text) {
            handleUserMessage(text);
        }
    });

    messageInput.addEventListener('input', () => {
        sendBtn.disabled = messageInput.value.trim().length === 0;
    });

    // Audio Recording Events
    let isTouchDevice = false;
    let recordStartTime = 0;
    let stopPending = false;
    let isPressing = false;

    function handlePress() {
        if (isRecording) {
            stopRecording(true);
        } else {
            isPressing = true;
            recordStartTime = Date.now();
            stopPending = false;
            startRecording();
        }
    }

    function handleRelease() {
        if (!isPressing) return;
        isPressing = false;

        const pressDuration = Date.now() - recordStartTime;
        // Si fue un toque rápido (< 400ms), lo dejamos grabando (toggle mode)
        if (pressDuration < 400) {
            return;
        }
        
        // Si mantuvo presionado, detenemos al soltar
        if (isRecording) {
            stopRecording(true);
        } else {
            stopPending = true;
        }
    }

    recordBtn.addEventListener('touchstart', (e) => {
        isTouchDevice = true;
        e.preventDefault(); // Evitar menú contextual
        handlePress();
    }, { passive: false });

    recordBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        handleRelease();
    });

    recordBtn.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        handleRelease();
    });

    // Ignorar eventos de mouse si es dispositivo táctil
    recordBtn.addEventListener('mousedown', (e) => {
        if (isTouchDevice || e.button !== 0) return;
        handlePress();
    });

    recordBtn.addEventListener('mouseup', (e) => {
        if (isTouchDevice || e.button !== 0) return;
        handleRelease();
    });

    recordBtn.addEventListener('contextmenu', e => e.preventDefault());

    cancelRecordBtn.addEventListener('click', () => {
        stopPending = false;
        isPressing = false;
        cancelRecording();
    });

    async function startRecording() {
        if (!groqApiKey) {
            alert('Por favor, configura tu API Key de Groq primero para usar esta función.');
            showModal();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            });

            mediaRecorder.addEventListener('stop', async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());
                
                if (audioChunks.length > 0 && isRecording) {
                    await processAudio(audioBlob);
                }
                
                resetRecordingUI();
            });

            mediaRecorder.start();
            isRecording = true;
            
            // Update UI
            recordBtn.classList.add('recording');
            recordingIndicator.classList.remove('hidden');
            recordingSeconds = 0;
            updateTimerDisplay();
            
            recordingInterval = setInterval(() => {
                recordingSeconds++;
                updateTimerDisplay();
            }, 1000);

            if (stopPending) {
                stopPending = false;
                stopRecording(true);
            }

        } catch (err) {
            console.error('Error al acceder al micrófono:', err);
            isPressing = false;
            stopPending = false;
            alert('No se pudo acceder al micrófono. Verifica los permisos de tu navegador.');
        }
    }

    function stopRecording(process = true) {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            isRecording = process; // Si process es false, indicamos que se canceló
            mediaRecorder.stop();
        }
    }

    function cancelRecording() {
        stopRecording(false);
        resetRecordingUI();
    }

    function resetRecordingUI() {
        isRecording = false;
        clearInterval(recordingInterval);
        recordBtn.classList.remove('recording');
        recordingIndicator.classList.add('hidden');
    }

    function updateTimerDisplay() {
        const mins = Math.floor(recordingSeconds / 60).toString().padStart(2, '0');
        const secs = (recordingSeconds % 60).toString().padStart(2, '0');
        recordingTimer.textContent = `${mins}:${secs}`;
    }

    async function processAudio(audioBlob) {
        // Mostrar un mensaje de que estamos transcribiendo
        addSystemMessage("Transcribiendo audio con Whisper...");
        
        try {
            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.webm');
            formData.append('model', 'whisper-large-v3');
            // formData.append('language', 'es'); // Opcional, forzar español

            const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${groqApiKey}`
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            
            // Remover el mensaje de "transcribiendo"
            chatBox.lastElementChild.remove();
            
            if (data.text) {
                handleUserMessage(data.text);
            }

        } catch (error) {
            console.error('Transcription error:', error);
            chatBox.lastElementChild.remove();
            addSystemMessage("Error al transcribir el audio. Revisa tu API key.");
        }
    }

    // Message Handling
    function handleUserMessage(text) {
        addMessage(text, 'user');
        messageInput.value = '';
        sendBtn.disabled = true;

        // Simulamos la respuesta de la IA
        simulateAIResponse(text);
    }

    function addMessage(text, sender) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${sender === 'user' ? 'user-message' : 'ai-message'}`;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = text;

        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        wrapper.appendChild(bubble);
        wrapper.appendChild(time);
        
        chatBox.appendChild(wrapper);
        scrollToBottom();
    }

    function addSystemMessage(text) {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper ai-message';
        wrapper.style.opacity = '0.7';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.style.background = 'transparent';
        bubble.style.border = '1px dashed var(--glass-border)';
        bubble.textContent = text;

        wrapper.appendChild(bubble);
        chatBox.appendChild(wrapper);
        scrollToBottom();
    }

    function showTypingIndicator() {
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper ai-message typing-container';
        wrapper.id = 'typingIndicator';

        const bubble = document.createElement('div');
        bubble.className = 'typing-indicator';
        
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            bubble.appendChild(dot);
        }

        wrapper.appendChild(bubble);
        chatBox.appendChild(wrapper);
        scrollToBottom();
    }

    function removeTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.remove();
        }
    }

    function scrollToBottom() {
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Mock AI Agent
    function simulateAIResponse(userText) {
        showTypingIndicator();

        // Tiempo de respuesta aleatorio entre 1 y 2.5 segundos
        const delay = Math.random() * 1500 + 1000;

        setTimeout(() => {
            removeTypingIndicator();
            
            // Generar una respuesta de prueba basada en la longitud
            const responses = [
                "¡Entendido! Como soy un agente de prueba, solo puedo simular una respuesta, pero he recibido tu mensaje correctamente.",
                "Interesante punto. Cuando el backend esté conectado, aquí procesaré esa información.",
                "¡Hola! He procesado tu mensaje. Esta interfaz está lista para conectarse al cerebro principal de IA.",
                "Mensaje recibido alto y claro. El diseño glassmorphism hace que nuestra conversación luzca muy bien, ¿no crees?"
            ];
            
            const randomResponse = responses[Math.floor(Math.random() * responses.length)];
            addMessage(randomResponse, 'ai');
        }, delay);
    }
});
