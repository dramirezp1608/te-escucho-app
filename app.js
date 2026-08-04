document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const apiKeyModal = document.getElementById('apiKeyModal');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const copilotUrlInput = document.getElementById('copilotUrlInput');
    const copilotSecretInput = document.getElementById('copilotSecretInput');
    const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
    const skipApiKeyBtn = document.getElementById('skipApiKeyBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const resetBtn = document.getElementById('resetBtn');
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
    let copilotUrl = localStorage.getItem('copilotUrl') || 'https://directline.botframework.com/v3/directline/conversations';
    let copilotSecret = localStorage.getItem('copilotSecret') || '';
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordingInterval = null;
    let recordingSeconds = 0;

    // Initialization
    if (!groqApiKey || !copilotSecret || !copilotUrl) {
        showModal();
    }

    // Modal Events
    saveApiKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        const url = copilotUrlInput.value.trim();
        const secret = copilotSecretInput.value.trim();
        
        if (key) {
            groqApiKey = key;
            localStorage.setItem('groqApiKey', key);
        }
        if (url) {
            copilotUrl = url;
            localStorage.setItem('copilotUrl', url);
        }
        if (secret) {
            copilotSecret = secret;
            localStorage.setItem('copilotSecret', secret);
        }
        
        if (key && secret && url) {
            hideModal();
            // Reconectar con las nuevas credenciales
            initCopilotConversation();
        } else {
            hideModal();
        }
    });

    skipApiKeyBtn.addEventListener('click', hideModal);
    settingsBtn.addEventListener('click', showModal);
    
    resetBtn.addEventListener('click', () => {
        // Limpiar interfaz
        chatBox.innerHTML = '';
        
        // Cerrar conexión actual si existe
        if (ws) {
            ws.close();
            ws = null;
        }
        
        copilotConversationId = '';
        copilotToken = '';
        
        // Iniciar nueva conversación
        initCopilotConversation();
    });

    function showModal() {
        apiKeyInput.value = groqApiKey;
        if (copilotUrlInput) {
            copilotUrlInput.value = copilotUrl;
        }
        if (copilotSecretInput) {
            copilotSecretInput.value = copilotSecret;
        }
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

        // Enviamos el texto a Copilot Studio
        sendToCopilot(text);
    }

    function addMessage(text, sender) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${sender === 'user' ? 'user-message' : 'ai-message'}`;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble markdown-body';
        
        if (sender === 'ai' && typeof marked !== 'undefined') {
            // marked parsea las negritas y el markdown y lo devuelve como HTML
            bubble.innerHTML = marked.parse(text);
        } else {
            bubble.textContent = text;
        }

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
        if (document.getElementById('typingIndicator')) return; // No duplicar

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
        const indicators = document.querySelectorAll('#typingIndicator, .typing-container');
        indicators.forEach(ind => ind.remove());
    }

    function scrollToBottom() {
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    // Copilot Studio Integration
    let copilotConversationId = '';
    let copilotToken = '';
    let ws = null;

    async function initCopilotConversation() {
        if (!copilotSecret || !copilotUrl) return; // Si faltan datos, no conectamos
        showTypingIndicator(); // Mostrar indicación de que está conectando
        try {
            const response = await fetch(copilotUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${copilotSecret}`
                },
                body: JSON.stringify({})
            });

            if (!response.ok) {
                throw new Error(`Error en conexión: ${response.status}`);
            }

            const data = await response.json();
            copilotConversationId = data.conversationId;
            copilotToken = data.token;
            
            if (data.streamUrl) {
                connectWebSocket(data.streamUrl);
            }
        } catch (error) {
            console.error('Copilot init error:', error);
            removeTypingIndicator();
            addSystemMessage("Error al conectar con Copilot Studio.");
        }
    }

    function connectWebSocket(streamUrl) {
        ws = new WebSocket(streamUrl);
        
        ws.onopen = () => {
            console.log('Connected to Copilot Studio');
            // Forzar el saludo enviando el evento startConversation
            triggerCopilotGreeting();
        };

        ws.onmessage = (event) => {
            try {
                if (event.data) {
                    const activity = JSON.parse(event.data);
                    
                    if (activity && activity.activities) {
                        activity.activities.forEach(act => processActivity(act));
                    } else if (activity && activity.type) {
                        processActivity(activity);
                    }
                }
            } catch (e) {
                console.error('Error parsing WS message:', e);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
        };
    }

    function processActivity(activity) {
        // Ignorar nuestros propios mensajes o si no existe from
        if (activity.from && activity.from.role === 'user') return;
        
        if (activity.type === 'message') {
            removeTypingIndicator();
            
            if (activity.text) {
                addMessage(activity.text, 'ai');
            }
            
            // Renderizar Adaptive Cards
            if (activity.attachments && activity.attachments.length > 0) {
                activity.attachments.forEach(attachment => {
                    if (attachment.contentType === 'application/vnd.microsoft.card.adaptive') {
                        renderAdaptiveCard(attachment.content);
                    }
                });
            }
        } else if (activity.type === 'typing') {
            showTypingIndicator();
        }
    }

    async function triggerCopilotGreeting() {
        if (!copilotConversationId) return;
        const activitiesUrl = `${copilotUrl}/${copilotConversationId}/activities`;
        try {
            await fetch(activitiesUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(copilotSecret ? { 'Authorization': `Bearer ${copilotSecret}` } : {})
                },
                body: JSON.stringify({
                    type: 'event',
                    name: 'startConversation',
                    from: { id: 'user1', role: 'user' }
                })
            });
        } catch (err) {
            console.error("Error triggering greeting:", err);
        }
    }

    function renderAdaptiveCard(cardContent) {
        if (typeof AdaptiveCards === 'undefined') return;
        
        const adaptiveCard = new AdaptiveCards.AdaptiveCard();
        
        // Host config básico
        adaptiveCard.hostConfig = new AdaptiveCards.HostConfig({
            fontFamily: "Inter, Roboto, sans-serif"
        });
        
        // Permitir procesar markdown dentro de la tarjeta usando marked
        AdaptiveCards.AdaptiveCard.onProcessMarkdown = function (text, result) {
            if (typeof marked !== 'undefined') {
                result.outputHtml = marked.parse(text);
                result.didProcess = true;
            }
        };

        adaptiveCard.parse(cardContent);
        const renderedCard = adaptiveCard.render();
        
        if (renderedCard) {
            const wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper ai-message adaptive-card-wrapper';
            
            const bubble = document.createElement('div');
            bubble.className = 'message-bubble markdown-body';
            bubble.appendChild(renderedCard);
            
            const time = document.createElement('span');
            time.className = 'message-time';
            time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            wrapper.appendChild(bubble);
            wrapper.appendChild(time);
            
            chatBox.appendChild(wrapper);
            scrollToBottom();
        }
    }

    async function sendToCopilot(text) {
        if (!copilotConversationId) {
            addSystemMessage("La conexión con el agente aún no está lista.");
            return;
        }

        showTypingIndicator();
        const activitiesUrl = `${copilotUrl}/${copilotConversationId}/activities`;

        try {
            const response = await fetch(activitiesUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(copilotToken ? { 'Authorization': `Bearer ${copilotToken}` } : {})
                },
                body: JSON.stringify({
                    type: 'message',
                    text: text,
                    from: {
                        id: 'user1',
                        role: 'user'
                    }
                })
            });

            if (!response.ok) {
                throw new Error('Failed to send message');
            }
        } catch (error) {
            console.error('Copilot send error:', error);
            removeTypingIndicator();
            addSystemMessage("Error al enviar mensaje al agente.");
        }
    }

    // Conectar con el agente al cargar
    initCopilotConversation();
});
