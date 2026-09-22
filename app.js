document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const authScreen = document.getElementById('authScreen');
    const authTitle = document.getElementById('authTitle');
    const authMessage = document.getElementById('authMessage');
    const chatApp = document.getElementById('chatApp');
    const chatStatus = document.getElementById('chatStatus');
    
    const resetBtn = document.getElementById('resetBtn');
    const chatBox = document.getElementById('chatBox');
    const chatForm = document.getElementById('chatForm');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const recordBtn = document.getElementById('recordBtn');
    const imageInput = document.getElementById('imageInput');
    const attachBtn = document.getElementById('attachBtn');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const removeImageBtn = document.getElementById('removeImageBtn');
    const cancelRecordBtn = document.getElementById('cancelRecordBtn');
    const recordingIndicator = document.getElementById('recordingIndicator');
    const recordingTimer = document.getElementById('recordingTimer');
    
    // User Form DOM
    const userFormModal = document.getElementById('userFormModal');
    const userNameInput = document.getElementById('userNameInput');
    const userAreaInput = document.getElementById('userAreaInput');
    const startSessionBtn = document.getElementById('startSessionBtn');

    // State
    let userName = '';
    let userArea = '';
    let currentAttachment = null;
    let currentAttachmentType = null;
    let currentFile = null;
    let wakeLock = null;

    // State
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let recordingInterval = null;
    let recordingSeconds = 0;

    // Copilot State
    let copilotConversationId = '';
    let copilotToken = '';
    let ws = null;
    let copilotUrl = '';
    let copilotStreamUrl = '';
    let currentProjectId = null;

    let backendInitPromise = null;

    // Initialization & Validation
    function initializeApp() {
        const urlParams = new URLSearchParams(window.location.search);
        currentProjectId = urlParams.get('id');

        if (!currentProjectId) {
            showAccessDenied("No se ha proporcionado un identificador de proyecto válido. Escanea el código QR oficial.");
            return;
        }

        // 1. Mostrar formulario de usuario inmediatamente para no bloquear la pantalla
        checkUserCookieAndShowForm();

        // 2. Iniciar la carga del backend en paralelo
        backendInitPromise = initBackend();
    }

    async function initBackend() {
        try {
            const res = await fetch(`/api/chat/start?id=${currentProjectId}`);
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Error de validación de proyecto.');
            }

            return { ok: true, data };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }

    function showAccessDenied(msg) {
        if (authTitle) {
            authTitle.innerText = "Acceso Denegado";
            authTitle.style.color = "var(--danger)";
        }
        if (authMessage) authMessage.innerText = msg;
    }

    // --- User Form & Cookies ---
    function setCookie(name, value, days) {
        let expires = "";
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "")  + expires + "; path=/";
    }

    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for(let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    function checkUserCookieAndShowForm() {
        const cookieData = getCookie('cuentame_user_info');
        if (cookieData) {
            try {
                const parsed = JSON.parse(cookieData);
                if (parsed.userName) userNameInput.value = parsed.userName;
                if (parsed.userArea) userAreaInput.value = parsed.userArea;
            } catch (e) {
                console.error("Error parsing user cookie", e);
            }
        }
        userFormModal.classList.add('active');
    }

    startSessionBtn.addEventListener('click', async () => {
        const name = userNameInput.value.trim();
        const area = userAreaInput.value.trim();

        if (!name || !area) {
            alert("Por favor, completa tu nombre y área para continuar.");
            return;
        }

        const originalText = startSessionBtn.innerText;
        startSessionBtn.innerText = "Conectando...";
        startSessionBtn.disabled = true;

        const result = await backendInitPromise;
        
        if (!result || !result.ok) {
            startSessionBtn.innerText = originalText;
            startSessionBtn.disabled = false;
            userFormModal.classList.remove('active');
            showAccessDenied(result?.error || 'Error de conexión');
            return;
        }

        const data = result.data;
        
        // Asignar variables globales
        copilotToken = data.copilotToken;
        copilotConversationId = data.conversationId;
        copilotUrl = data.endpoint;
        copilotStreamUrl = data.streamUrl;

        // Mostrar UI principal
        if (authScreen) authScreen.style.display = 'none';
        if (chatApp) chatApp.style.display = 'flex';
        if (chatStatus) chatStatus.innerText = "En línea";

        // Configurar CSS dinámico
        if (data.colors) {
            try {
                const colors = JSON.parse(data.colors);
                const root = document.documentElement;
                for (const [key, value] of Object.entries(colors)) {
                    root.style.setProperty(`--${key}`, value);
                }
            } catch (e) {
                console.error("Error al parsear el JSON de colores corporativos:", e);
            }
        }

        // Actualizar header
        const headerNameEl = document.querySelector('.header-info h1');
        if (headerNameEl && data.projectName) {
            headerNameEl.innerText = `Cuentame AI - ${data.projectName}`;
            document.title = `Cuentame AI - ${data.projectName}`;
        }

        userName = name;
        userArea = area;

        const userInfo = {
            projectId: currentProjectId,
            userName: name,
            userArea: area
        };

        setCookie('cuentame_user_info', JSON.stringify(userInfo), 30);
        
        userFormModal.classList.remove('active');
        connectWebSocket(copilotStreamUrl);
    });


    // Call init
    initializeApp();

    // Reset Events
    resetBtn.addEventListener('click', () => {
        // En lugar de limpiar, recargamos la página para revalidar el token y limpiar el estado por completo
        window.location.reload();
    });

    // Chat Events
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (text || currentAttachment) {
            handleUserMessage(text);
        }
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = messageInput.value.trim();
            if (text || currentAttachment) {
                handleUserMessage(text);
            }
        }
    });

    messageInput.addEventListener('input', () => {
        sendBtn.disabled = (messageInput.value.trim().length === 0 && !currentAttachment);
        // Auto-resize
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    });

    // Image Attachment Events
    attachBtn.addEventListener('click', () => {
        imageInput.click();
    });

    imageInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleFileSelection(file);
        }
    });

    messageInput.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file) {
                    handleFileSelection(file);
                    e.preventDefault();
                    break;
                }
            }
        }
    });

    function handleFileSelection(file) {
        currentFile = file;
        currentAttachmentType = file.type || 'application/octet-stream';
        
        // Find or create a generic file preview element
        let fileNameEl = document.getElementById('fileNamePreview');
        if (!fileNameEl) {
            fileNameEl = document.createElement('span');
            fileNameEl.id = 'fileNamePreview';
            fileNameEl.style.color = 'var(--text-primary)';
            fileNameEl.style.fontSize = '0.9rem';
            fileNameEl.style.padding = '8px';
            fileNameEl.style.display = 'none';
            fileNameEl.style.background = 'rgba(255,255,255,0.1)';
            fileNameEl.style.borderRadius = '8px';
            fileNameEl.style.marginBottom = '8px';
            imagePreviewContainer.insertBefore(fileNameEl, imagePreview);
        }

        if (file.type.startsWith('image/')) {
            fileNameEl.style.display = 'none';
            imagePreview.style.display = 'block';

            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    
                    if (width > height) {
                        if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                    } else {
                        if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    canvas.toBlob((blob) => {
                        currentFile = blob;
                        currentFile.name = file.name;
                        currentAttachment = canvas.toDataURL('image/jpeg', 0.6);
                        
                        imagePreview.src = currentAttachment;
                        imagePreviewContainer.classList.remove('hidden');
                        sendBtn.disabled = false;
                    }, 'image/jpeg', 0.6);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        } else {
            // Documento genérico
            currentAttachment = null;
            imagePreview.style.display = 'none';
            imagePreview.src = '';
            
            fileNameEl.textContent = `📄 ${file.name}`;
            fileNameEl.style.display = 'inline-block';
            
            imagePreviewContainer.classList.remove('hidden');
            sendBtn.disabled = false;
        }
    }

    removeImageBtn.addEventListener('click', () => {
        clearAttachment();
    });

    function clearAttachment() {
        currentFile = null;
        currentAttachment = null;
        currentAttachmentType = null;
        imageInput.value = '';
        imagePreview.src = '';
        imagePreview.style.display = 'block';
        
        const fileNameEl = document.getElementById('fileNamePreview');
        if (fileNameEl) fileNameEl.style.display = 'none';
        
        imagePreviewContainer.classList.add('hidden');
        sendBtn.disabled = messageInput.value.trim().length === 0;
    }

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
        if (pressDuration < 400) return;
        
        if (isRecording) {
            stopRecording(true);
        } else {
            stopPending = true;
        }
    }

    recordBtn.addEventListener('touchstart', (e) => {
        isTouchDevice = true;
        e.preventDefault();
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

    // --- Screen Wake Lock API ---
    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Screen Wake Lock adquirido');
                
                wakeLock.addEventListener('release', () => {
                    console.log('Screen Wake Lock liberado de forma externa');
                });
            } catch (err) {
                console.error(`Wake Lock request failed: ${err.name}, ${err.message}`);
            }
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release().then(() => {
                wakeLock = null;
                console.log('Screen Wake Lock liberado');
            });
        }
    }

    document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible' && isRecording) {
            requestWakeLock();
        }
    });

    async function startRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.addEventListener('dataavailable', event => {
                if (event.data.size > 0) audioChunks.push(event.data);
            });

            mediaRecorder.addEventListener('stop', async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                stream.getTracks().forEach(track => track.stop());
                
                const shouldProcess = (audioChunks.length > 0 && isRecording);
                resetRecordingUI();
                
                if (shouldProcess) {
                    await processAudio(audioBlob);
                }
            });

            mediaRecorder.start();
            isRecording = true;
            
            // Adquirir bloqueo de pantalla (Wake Lock)
            requestWakeLock();
            
            recordBtn.classList.add('recording');
            const micIcon = recordBtn.querySelector('span');
            if (micIcon) micIcon.innerText = 'stop';
            
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
            isRecording = process; 
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
        const micIcon = recordBtn.querySelector('span');
        if (micIcon) micIcon.innerText = 'mic';
        recordingIndicator.classList.add('hidden');
        
        // Liberar bloqueo de pantalla
        releaseWakeLock();
    }

    function updateTimerDisplay() {
        const mins = Math.floor(recordingSeconds / 60).toString().padStart(2, '0');
        const secs = (recordingSeconds % 60).toString().padStart(2, '0');
        recordingTimer.textContent = `${mins}:${secs}`;
    }

    async function processAudio(audioBlob) {
        addSystemMessage("Transcribiendo audio...");
        
        try {
            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.webm');

            const response = await fetch('/api/chat/transcribe', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const text = await response.text();
                let errorMsg = `API Error: ${response.status}`;
                try {
                    const errorData = JSON.parse(text);
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {
                    errorMsg = `Cloudflare Error (${response.status}): ${text.substring(0, 100)}`;
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            chatBox.lastElementChild.remove();
            
            if (data.text) {
                handleUserMessage(data.text);
            }

        } catch (error) {
            console.error('Transcription error:', error);
            chatBox.lastElementChild.remove();
            addSystemMessage("Error al transcribir el audio.");
        }
    }

    // Message Handling
    function handleUserMessage(text) {
        const fileName = currentFile ? (currentFile.name || 'documento') : null;
        addMessage(text, 'user', currentAttachment, fileName);
        
        const fileToSend = currentFile;
        const fileType = currentAttachmentType;
        
        messageInput.value = '';
        messageInput.style.height = 'auto';
        clearAttachment();
        sendBtn.disabled = true;
        
        sendToCopilot(text, fileToSend, fileType, fileName);
    }

    function addMessage(text, sender, attachmentData = null, fileName = null) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${sender === 'user' ? 'user-message' : 'ai-message'}`;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble markdown-body';
        
        if (sender === 'ai' && typeof marked !== 'undefined') {
            bubble.innerHTML = marked.parse(text);
        } else {
            bubble.textContent = text;
        }

        if (attachmentData) {
            const img = document.createElement('img');
            img.src = attachmentData;
            img.className = 'message-image';
            bubble.appendChild(img);
        } else if (fileName) {
            const fileEl = document.createElement('div');
            fileEl.textContent = `📄 ${fileName}`;
            fileEl.style.marginTop = '8px';
            fileEl.style.padding = '8px';
            fileEl.style.background = 'rgba(255,255,255,0.1)';
            fileEl.style.borderRadius = '8px';
            fileEl.style.fontSize = '0.85rem';
            bubble.appendChild(fileEl);
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
        if (document.getElementById('typingIndicator')) return; 

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

    function connectWebSocket(streamUrl) {
        ws = new WebSocket(streamUrl);
        
        ws.onopen = () => {
            console.log('Connected to Copilot Studio via secure proxy');
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

        ws.onerror = (error) => console.error('WebSocket Error:', error);
    }

    function processActivity(activity) {
        if (activity.from && activity.from.role === 'user') return;
        
        if (activity.type === 'message') {
            removeTypingIndicator();
            if (activity.text) addMessage(activity.text, 'ai');
            
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

    let hasGreeted = false;
    async function triggerCopilotGreeting() {
        if (!copilotConversationId || hasGreeted) return;
        hasGreeted = true;
        const activitiesUrl = `${copilotUrl}/${copilotConversationId}/activities`;
        try {
            await fetch(activitiesUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${copilotToken}`
                },
                body: JSON.stringify({
                    type: 'message',
                    text: `Hola. El project ID es: ${currentProjectId}. Mi nombre es ${userName} y pertenezco al área de ${userArea}.`,
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
        adaptiveCard.hostConfig = new AdaptiveCards.HostConfig({ fontFamily: "Inter, Roboto, sans-serif" });
        
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

    async function sendToCopilot(text, fileObject = null, fileType = null, fileName = 'archivo') {
        if (!copilotConversationId) {
            addSystemMessage("La conexión con el agente aún no está lista.");
            return;
        }

        showTypingIndicator();
        
        const payload = {
            type: 'message',
            text: text,
            from: { id: 'user1', role: 'user' }
        };

        try {
            let response;
            
            if (fileObject) {
                // Envío de cualquier tipo de archivo a través de /upload (multipart)
                const uploadUrl = `${copilotUrl}/${copilotConversationId}/upload?userId=user1`;
                
                const formData = new FormData();
                
                // 1. Agregar el activity (JSON) como un Blob
                const activityBlob = new Blob([JSON.stringify(payload)], { type: 'application/vnd.microsoft.activity' });
                formData.append('activity', activityBlob, 'activity.json');
                
                // 2. Agregar el archivo real directamente
                formData.append('file', fileObject, fileName);

                response = await fetch(uploadUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${copilotToken}`
                    },
                    body: formData
                });
            } else {
                // Envío normal de solo texto
                const activitiesUrl = `${copilotUrl}/${copilotConversationId}/activities`;
                response = await fetch(activitiesUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${copilotToken}`
                    },
                    body: JSON.stringify(payload)
                });
            }

            if (!response.ok) throw new Error('Failed to send message');
        } catch (error) {
            console.error('Copilot send error:', error);
            removeTypingIndicator();
            addSystemMessage("Error al enviar mensaje al agente.");
        }
    }
});
