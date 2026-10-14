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
    const attachmentsPreviewContainer = document.getElementById('attachmentsPreviewContainer');
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
    let attachedFiles = [];
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

    // Connection & Timeout State
    const RESPONSE_TIMEOUT_MS = 75000; // 75 segundos para permitir orquestación multi-agente y razonamiento profundo
    let activeMessageTimeout = null;
    let lastPendingMessage = null; // { text, files, wrapper }
    let wsReconnectTimeout = null;
    let wsReconnectAttempts = 0;
    let heartbeatInterval = null;
    let progressiveStatusTimer = null;
    let pendingQueue = []; // Cola de envíos pendientes cuando no hay conexión

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function updateConnectionStatus(status, text) {
        if (chatStatus && text) {
            chatStatus.innerText = text;
        }
        const indicatorEl = document.querySelector('.status-indicator');
        if (indicatorEl) {
            indicatorEl.classList.remove('offline', 'reconnecting');
            if (status === 'offline') {
                indicatorEl.classList.add('offline');
            } else if (status === 'reconnecting') {
                indicatorEl.classList.add('reconnecting');
            }
        }
    }

    function restoreDraft() {
        const savedDraft = localStorage.getItem('cuentame_chat_draft');
        if (savedDraft && messageInput) {
            messageInput.value = savedDraft;
            messageInput.style.height = 'auto';
            messageInput.style.height = (messageInput.scrollHeight) + 'px';
            updateSendButtonState();
        }
    }

    function startHeartbeat() {
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
            if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                if (navigator.onLine && copilotStreamUrl) {
                    console.log('[Heartbeat] WebSocket inactivo detectado. Reconectando...');
                    connectWebSocket(copilotStreamUrl, true);
                }
            } else if (ws.readyState === WebSocket.OPEN) {
                if (navigator.onLine && chatStatus && chatStatus.innerText !== "En línea") {
                    updateConnectionStatus('online', 'En línea');
                }
            }
        }, 25000);
    }

    function enqueuePendingItem(item) {
        pendingQueue.push(item);
        if (item.wrapper) {
            item.wrapper.classList.add('is-queued');
            let badge = item.wrapper.querySelector('.message-queued-badge');
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'message-queued-badge';
                badge.innerHTML = '<span class="material-symbols-rounded">schedule</span> <span>En cola (esperando conexión...)</span>';
                item.wrapper.appendChild(badge);
            }
        }
        scrollToBottom();
    }

    let isFlushingQueue = false;
    async function flushPendingQueue() {
        if (isFlushingQueue || pendingQueue.length === 0 || !navigator.onLine) return;
        isFlushingQueue = true;
        
        try {
            console.log(`[Cola de Envíos] Procesando ${pendingQueue.length} elemento(s) pendiente(s)...`);
            
            while (pendingQueue.length > 0 && navigator.onLine) {
                const item = pendingQueue.shift();
                if (item.wrapper) {
                    item.wrapper.classList.remove('is-queued');
                    const badge = item.wrapper.querySelector('.message-queued-badge');
                    if (badge) badge.remove();
                }

                if (item.type === 'chat') {
                    handleUserMessage(item.text, item.files, item.wrapper);
                } else if (item.type === 'audio') {
                    processAudio(item.audioBlob, item.wrapper);
                }
                
                await new Promise(r => setTimeout(r, 600));
            }
        } finally {
            isFlushingQueue = false;
        }
    }

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
        updateConnectionStatus('online', 'En línea');

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
        startHeartbeat();
        restoreDraft();
    });

    // Call init
    initializeApp();

    // Reset Events
    resetBtn.addEventListener('click', () => {
        // En lugar de limpiar, recargamos la página para revalidar el token y limpiar el estado por completo
        localStorage.removeItem('cuentame_chat_draft');
        sessionStorage.removeItem('cuentame_initial_greeting_sent');
        if (copilotConversationId) {
            sessionStorage.removeItem('cuentame_greeted_' + copilotConversationId);
        }
        window.location.reload();
    });

    // Helper to format filenames with middle-substring and extension preservation
    function formatFileName(name, maxLength = 18) {
        if (!name || typeof name !== 'string') return '';
        if (name.length <= maxLength) return name;
        
        const lastDot = name.lastIndexOf('.');
        if (lastDot <= 0) {
            return name.substring(0, maxLength - 3) + '...';
        }
        
        const ext = name.substring(lastDot); // e.g. '.pdf'
        const base = name.substring(0, lastDot);
        
        if (ext.length >= maxLength - 3) {
            return name.substring(0, maxLength - 3) + '...';
        }
        
        const avail = maxLength - ext.length - 3;
        if (avail <= 3) {
            return base.substring(0, Math.max(1, avail)) + '...' + ext;
        }
        
        const front = Math.ceil(avail * 0.65);
        const back = avail - front;
        if (back > 0) {
            return `${base.substring(0, front)}...${base.substring(base.length - back)}${ext}`;
        } else {
            return `${base.substring(0, front)}...${ext}`;
        }
    }

    function updateSendButtonState() {
        sendBtn.disabled = (messageInput.value.trim().length === 0 && attachedFiles.length === 0);
    }

    // Chat Events
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (text || attachedFiles.length > 0) {
            handleUserMessage(text);
        }
    });

    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = messageInput.value.trim();
            if (text || attachedFiles.length > 0) {
                handleUserMessage(text);
            }
        }
    });

    messageInput.addEventListener('input', () => {
        updateSendButtonState();
        // Auto-resize
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
        
        // Guardar borrador en localStorage
        const draftText = messageInput.value;
        if (draftText && draftText.trim().length > 0) {
            localStorage.setItem('cuentame_chat_draft', draftText);
        } else {
            localStorage.removeItem('cuentame_chat_draft');
        }
    });

    // File Attachment Events
    attachBtn.addEventListener('click', () => {
        imageInput.click();
    });

    imageInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            await handleFilesSelection(files);
        }
    });

    messageInput.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        const filesToProcess = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file) filesToProcess.push(file);
            }
        }
        if (filesToProcess.length > 0) {
            e.preventDefault();
            await handleFilesSelection(filesToProcess);
        }
    });

    function getAdaptiveCompressionSettings() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (!conn) {
            return { maxWidth: 800, maxHeight: 800, quality: 0.7 };
        }
        
        const effectiveType = conn.effectiveType;
        const saveData = conn.saveData;
        
        if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
            console.log('[Compresión Adaptativa] Red lenta (2G/Ahorro). Comprimiendo a 500px, calidad 0.4');
            return { maxWidth: 500, maxHeight: 500, quality: 0.4 };
        } else if (effectiveType === '3g') {
            console.log('[Compresión Adaptativa] Red 3G. Comprimiendo a 700px, calidad 0.55');
            return { maxWidth: 700, maxHeight: 700, quality: 0.55 };
        } else {
            return { maxWidth: 1000, maxHeight: 1000, quality: 0.75 };
        }
    }

    async function processFile(file) {
        if (file.type && file.type.startsWith('image/')) {
            return new Promise((resolve) => {
                const settings = getAdaptiveCompressionSettings();
                const reader = new FileReader();
                reader.onload = (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;
                        const MAX_WIDTH = settings.maxWidth;
                        const MAX_HEIGHT = settings.maxHeight;
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
                            const compressedBlob = blob || file;
                            const dataUrl = canvas.toDataURL('image/jpeg', settings.quality);
                            resolve({
                                id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                                file: compressedBlob,
                                name: file.name,
                                type: 'image/jpeg',
                                isImage: true,
                                previewUrl: dataUrl
                            });
                        }, 'image/jpeg', settings.quality);
                    };
                    img.onerror = () => {
                        resolve({
                            id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                            file: file,
                            name: file.name,
                            type: file.type || 'application/octet-stream',
                            isImage: false
                        });
                    };
                    img.src = e.target.result;
                };
                reader.onerror = () => {
                    resolve({
                        id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                        file: file,
                        name: file.name,
                        type: file.type || 'application/octet-stream',
                        isImage: false
                    });
                };
                reader.readAsDataURL(file);
            });
        } else {
            return Promise.resolve({
                id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                file: file,
                name: file.name,
                type: file.type || 'application/octet-stream',
                isImage: false
            });
        }
    }

    async function handleFilesSelection(fileList) {
        if (!fileList || fileList.length === 0) return;
        for (let i = 0; i < fileList.length; i++) {
            const item = await processFile(fileList[i]);
            attachedFiles.push(item);
        }
        imageInput.value = '';
        renderAttachmentsPreview();
    }

    function renderAttachmentsPreview() {
        if (!attachmentsPreviewContainer) return;
        attachmentsPreviewContainer.innerHTML = '';
        
        if (attachedFiles.length === 0) {
            attachmentsPreviewContainer.classList.add('hidden');
            updateSendButtonState();
            return;
        }

        attachmentsPreviewContainer.classList.remove('hidden');
        updateSendButtonState();

        attachedFiles.forEach(fileItem => {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';
            chip.title = fileItem.name;

            if (fileItem.isImage && fileItem.previewUrl) {
                const img = document.createElement('img');
                img.src = fileItem.previewUrl;
                img.className = 'chip-thumb';
                img.alt = 'preview';
                chip.appendChild(img);
            } else {
                const icon = document.createElement('span');
                icon.className = 'material-symbols-rounded chip-icon';
                let iconName = 'description';
                const lower = (fileItem.name || '').toLowerCase();
                if (lower.endsWith('.pdf')) iconName = 'picture_as_pdf';
                else if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) iconName = 'table_chart';
                else if (lower.endsWith('.docx') || lower.endsWith('.doc')) iconName = 'article';
                icon.textContent = iconName;
                chip.appendChild(icon);
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'chip-name';
            nameSpan.textContent = formatFileName(fileItem.name, 18);
            chip.appendChild(nameSpan);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'chip-remove-btn';
            removeBtn.title = 'Eliminar archivo';
            removeBtn.innerHTML = '<span class="material-symbols-rounded">close</span>';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeAttachment(fileItem.id);
            });
            chip.appendChild(removeBtn);

            attachmentsPreviewContainer.appendChild(chip);
        });
    }

    function removeAttachment(id) {
        attachedFiles = attachedFiles.filter(item => item.id !== id);
        renderAttachmentsPreview();
    }

    function clearAttachments() {
        attachedFiles = [];
        imageInput.value = '';
        renderAttachmentsPreview();
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

    async function processAudio(audioBlob, existingWrapper = null) {
        if (!audioBlob) return;

        let wrapper = existingWrapper;

        if (!wrapper) {
            // Crear burbuja de mensaje de voz en el chat del usuario
            wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper user-message';

            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.innerHTML = `
                <div class="audio-msg-container">
                    <span class="audio-voice-badge">
                        <span class="material-symbols-rounded">mic</span>
                        <span>Mensaje de voz</span>
                    </span>
                    <span class="audio-transcribing-status">
                        <span class="material-symbols-rounded">sync</span>
                        <span class="status-msg">Transcribiendo audio...</span>
                    </span>
                </div>
            `;

            const time = document.createElement('span');
            time.className = 'message-time';
            time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            wrapper.appendChild(bubble);
            wrapper.appendChild(time);
            chatBox.appendChild(wrapper);
            scrollToBottom();
        } else {
            wrapper.classList.remove('has-error');
            const oldRetry = wrapper.querySelector('.message-retry-container');
            if (oldRetry) oldRetry.remove();

            const bubble = wrapper.querySelector('.message-bubble');
            if (bubble) {
                bubble.innerHTML = `
                    <div class="audio-msg-container">
                        <span class="audio-voice-badge">
                            <span class="material-symbols-rounded">mic</span>
                            <span>Mensaje de voz</span>
                        </span>
                        <span class="audio-transcribing-status">
                            <span class="material-symbols-rounded">sync</span>
                            <span class="status-msg">Transcribiendo audio...</span>
                        </span>
                    </div>
                `;
            }
        }

        // Si el usuario está offline, guardar en la cola de envíos pendientes
        if (!navigator.onLine) {
            const statusMsg = wrapper.querySelector('.status-msg');
            if (statusMsg) statusMsg.textContent = "Esperando conexión...";
            enqueuePendingItem({ type: 'audio', audioBlob, wrapper });
            return;
        }

        // Timeout controlado para la llamada de transcripción (35s)
        const abortController = new AbortController();
        const transcribeTimeout = setTimeout(() => {
            abortController.abort();
        }, 35000);

        try {
            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.webm');

            const response = await fetch('/api/chat/transcribe', {
                method: 'POST',
                body: formData,
                signal: abortController.signal
            });

            clearTimeout(transcribeTimeout);

            if (!response.ok) {
                const text = await response.text();
                let errorMsg = `API Error: ${response.status}`;
                try {
                    const errorData = JSON.parse(text);
                    errorMsg = errorData.error || errorMsg;
                } catch (e) {
                    errorMsg = `Error (${response.status}): ${text.substring(0, 100)}`;
                }
                throw new Error(errorMsg);
            }

            const data = await response.json();
            
            if (data.text && data.text.trim()) {
                const bubble = wrapper.querySelector('.message-bubble');
                if (bubble) {
                    bubble.innerHTML = `
                        <div class="audio-voice-badge">
                            <span class="material-symbols-rounded">mic</span>
                            <span>Mensaje de voz</span>
                        </div>
                        <div class="transcribed-text">${escapeHtml(data.text)}</div>
                    `;
                }
                // Enviar la transcripción a Copilot reutilizando el wrapper existente
                handleUserMessage(data.text, [], wrapper);
            } else {
                throw new Error("No se detectó voz o audio inteligible");
            }

        } catch (error) {
            clearTimeout(transcribeTimeout);
            console.error('Transcription error:', error);
            const isTimeout = error.name === 'AbortError';
            const reason = isTimeout ? 'Tiempo de espera de transcripción agotado' : 'Error al transcribir el audio';
            markAudioTranscriptionFailed(wrapper, audioBlob, reason);
        }
    }

    function markAudioTranscriptionFailed(wrapper, audioBlob, reason = "Error al transcribir el audio") {
        if (!wrapper) return;
        wrapper.classList.add('has-error');

        const transcribingStatus = wrapper.querySelector('.audio-transcribing-status');
        if (transcribingStatus) {
            transcribingStatus.innerHTML = `
                <span class="material-symbols-rounded" style="color:var(--danger-color,#ef4444); animation:none;">mic_off</span>
                <span style="color:#fca5a5;">Grabación guardada (sin transcribir)</span>
            `;
        }

        let retryContainer = wrapper.querySelector('.message-retry-container');
        if (!retryContainer) {
            retryContainer = document.createElement('div');
            retryContainer.className = 'message-retry-container';
            wrapper.appendChild(retryContainer);
        }

        retryContainer.innerHTML = `
            <span class="message-retry-text">
                <span class="material-symbols-rounded">error</span>
                <span>${reason}</span>
            </span>
            <button type="button" class="retry-btn" title="Volver a intentar transcribir este audio">
                <span class="material-symbols-rounded">refresh</span>
                <span>Reintentar transcripción</span>
            </button>
        `;

        const retryBtn = retryContainer.querySelector('.retry-btn');
        retryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            processAudio(audioBlob, wrapper);
        });

        scrollToBottom();
    }

    // Message Handling
    function handleUserMessage(text, customFiles = null, existingWrapper = null) {
        const filesToSend = customFiles !== null ? customFiles : [...attachedFiles];
        if (!text && filesToSend.length === 0) return;
        
        let wrapper = existingWrapper;
        if (!wrapper) {
            wrapper = addMessage(text, 'user', filesToSend);
            messageInput.value = '';
            messageInput.style.height = 'auto';
            clearAttachments();
            localStorage.removeItem('cuentame_chat_draft');
        } else {
            wrapper.classList.remove('has-error');
            const oldRetry = wrapper.querySelector('.message-retry-container');
            if (oldRetry) oldRetry.remove();
        }
        
        sendBtn.disabled = true;

        // Si no hay conexión de red, encolar el mensaje para cuando regrese la conexión
        if (!navigator.onLine) {
            enqueuePendingItem({ type: 'chat', text, files: filesToSend, wrapper });
            return;
        }

        // Limpiar timeout previo si lo hubiera
        if (activeMessageTimeout) {
            clearTimeout(activeMessageTimeout);
            activeMessageTimeout = null;
        }

        // Armar el timeout de respuesta del agente (75 segundos)
        lastPendingMessage = { text, files: filesToSend, wrapper };
        activeMessageTimeout = setTimeout(() => {
            onMessageResponseTimeout();
        }, RESPONSE_TIMEOUT_MS);
        
        sendToCopilot(text, filesToSend, wrapper);
    }

    function onMessageResponseTimeout(reason = "Sin respuesta del agente (tiempo de espera agotado)") {
        removeTypingIndicator();
        if (lastPendingMessage && lastPendingMessage.wrapper) {
            markMessageAsFailed(
                lastPendingMessage.wrapper, 
                lastPendingMessage.text, 
                lastPendingMessage.files, 
                reason
            );
        }
        lastPendingMessage = null;
        if (activeMessageTimeout) {
            clearTimeout(activeMessageTimeout);
            activeMessageTimeout = null;
        }
    }

    function markMessageAsFailed(wrapper, text, files, reason = "No se pudo recibir respuesta") {
        removeTypingIndicator();
        if (!wrapper) return;
        
        wrapper.classList.add('has-error');
        
        let retryContainer = wrapper.querySelector('.message-retry-container');
        if (!retryContainer) {
            retryContainer = document.createElement('div');
            retryContainer.className = 'message-retry-container';
            wrapper.appendChild(retryContainer);
        }
        
        retryContainer.innerHTML = `
            <span class="message-retry-text">
                <span class="material-symbols-rounded">error</span>
                <span>${reason}</span>
            </span>
            <button type="button" class="retry-btn" title="Volver a intentar enviar este mensaje">
                <span class="material-symbols-rounded">refresh</span>
                <span>Reintentar</span>
            </button>
        `;
        
        const retryBtn = retryContainer.querySelector('.retry-btn');
        retryBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            retryMessage(wrapper, text, files);
        });
        
        scrollToBottom();
    }

    function retryMessage(wrapper, text, files) {
        // Si el WebSocket se cayó o está cerrado, intentar reconectar
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            if (copilotStreamUrl) {
                connectWebSocket(copilotStreamUrl, true);
            }
        }
        
        handleUserMessage(text, files, wrapper);
    }

    function addMessage(text, sender, attachments = []) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${sender === 'user' ? 'user-message' : 'ai-message'}`;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble markdown-body';
        
        if (sender === 'ai' && typeof marked !== 'undefined') {
            bubble.innerHTML = marked.parse(text);
        } else if (text) {
            bubble.textContent = text;
        }

        if (attachments && attachments.length > 0) {
            const attachList = document.createElement('div');
            attachList.className = 'message-attachments';
            
            attachments.forEach(att => {
                if (att.isImage && att.previewUrl) {
                    const img = document.createElement('img');
                    img.src = att.previewUrl;
                    img.className = 'message-image';
                    img.alt = att.name || 'imagen';
                    attachList.appendChild(img);
                } else {
                    const fileEl = document.createElement('div');
                    fileEl.className = 'message-file-badge';
                    fileEl.title = att.name || 'archivo';
                    
                    let iconName = 'description';
                    const lower = (att.name || '').toLowerCase();
                    if (lower.endsWith('.pdf')) iconName = 'picture_as_pdf';
                    else if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) iconName = 'table_chart';
                    else if (lower.endsWith('.docx') || lower.endsWith('.doc')) iconName = 'article';

                    fileEl.innerHTML = `
                        <span class="material-symbols-rounded">${iconName}</span>
                        <span class="file-name">${formatFileName(att.name || 'archivo', 22)}</span>
                    `;
                    attachList.appendChild(fileEl);
                }
            });
            
            bubble.appendChild(attachList);
        }

        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        wrapper.appendChild(bubble);
        wrapper.appendChild(time);
        
        chatBox.appendChild(wrapper);
        scrollToBottom();
        return wrapper;
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

    function startProgressiveStatus() {
        stopProgressiveStatus();
        const stages = [
            { time: 0, text: "Pensando..." },
            { time: 8000, text: "Analizando información..." },
            { time: 22000, text: "Coordinando agentes y contexto..." },
            { time: 42000, text: "Razonando y redactando respuesta detallada..." }
        ];
        const startTime = Date.now();

        const updateStatus = () => {
            const elapsed = Date.now() - startTime;
            let currentText = stages[0].text;
            for (let i = stages.length - 1; i >= 0; i--) {
                if (elapsed >= stages[i].time) {
                    currentText = stages[i].text;
                    break;
                }
            }
            const statusEl = document.querySelector('#typingIndicator .typing-status-text');
            if (statusEl && statusEl.textContent !== currentText) {
                statusEl.textContent = currentText;
            }
        };

        progressiveStatusTimer = setInterval(updateStatus, 2500);
    }

    function stopProgressiveStatus() {
        if (progressiveStatusTimer) {
            clearInterval(progressiveStatusTimer);
            progressiveStatusTimer = null;
        }
    }

    function showTypingIndicator() {
        if (document.getElementById('typingIndicator')) return; 

        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper ai-message typing-container';
        wrapper.id = 'typingIndicator';

        const bubble = document.createElement('div');
        bubble.className = 'typing-indicator';
        
        const dotsContainer = document.createElement('div');
        dotsContainer.className = 'typing-dots';
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            dotsContainer.appendChild(dot);
        }
        bubble.appendChild(dotsContainer);

        const statusText = document.createElement('span');
        statusText.className = 'typing-status-text';
        statusText.textContent = 'Pensando...';
        bubble.appendChild(statusText);

        wrapper.appendChild(bubble);
        chatBox.appendChild(wrapper);
        scrollToBottom();

        startProgressiveStatus();
    }

    function removeTypingIndicator() {
        stopProgressiveStatus();
        const indicators = document.querySelectorAll('#typingIndicator, .typing-container');
        indicators.forEach(ind => ind.remove());
    }

    function scrollToBottom() {
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    const seenActivityIds = new Set();

    function connectWebSocket(streamUrl, isReconnect = false) {
        if (!streamUrl) return;

        if (ws) {
            try {
                ws.onclose = null;
                ws.close();
            } catch (e) {}
        }

        updateConnectionStatus('reconnecting', 'Conectando...');
        ws = new WebSocket(streamUrl);
        
        ws.onopen = () => {
            console.log('Connected to Copilot Studio via secure proxy');
            wsReconnectAttempts = 0;
            updateConnectionStatus('online', 'En línea');
            if (!isReconnect && !hasAlreadyGreeted()) {
                triggerCopilotGreeting();
            }
            flushPendingQueue();
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

        ws.onclose = (event) => {
            console.warn('WebSocket cerrado:', event.code, event.reason);
            updateConnectionStatus('reconnecting', 'Reconectando...');
            scheduleWsReconnect();
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            updateConnectionStatus('reconnecting', 'Reconectando...');
        };
    }

    function scheduleWsReconnect() {
        if (wsReconnectTimeout) clearTimeout(wsReconnectTimeout);
        if (!navigator.onLine) {
            updateConnectionStatus('offline', 'Sin conexión');
            return;
        }

        wsReconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(1.5, wsReconnectAttempts), 10000);
        console.log(`Reintentando conexión WebSocket en ${Math.round(delay)}ms...`);
        
        wsReconnectTimeout = setTimeout(() => {
            if (copilotStreamUrl) {
                connectWebSocket(copilotStreamUrl, true);
            }
        }, delay);
    }

    // Escuchadores de eventos de red global
    window.addEventListener('online', () => {
        console.log('Dispositivo recuperó la conexión a internet');
        updateConnectionStatus('reconnecting', 'Reconectando...');
        wsReconnectAttempts = 0;
        if (copilotStreamUrl) {
            connectWebSocket(copilotStreamUrl, true);
        }
    });

    window.addEventListener('offline', () => {
        console.warn('Dispositivo perdió la conexión a internet');
        updateConnectionStatus('offline', 'Sin conexión');
        if (activeMessageTimeout) {
            onMessageResponseTimeout("Sin conexión a internet");
        }
    });

    function processActivity(activity) {
        if (activity.from && activity.from.role === 'user') return;
        
        // Deduplicar actividades por ID para evitar que reconexiones del WebSocket dupliquen burbujas
        if (activity.id) {
            if (seenActivityIds.has(activity.id)) {
                console.log('[DirectLine] Actividad ya procesada previamente, ignorando duplicado:', activity.id);
                return;
            }
            seenActivityIds.add(activity.id);
        }

        if (activity.type === 'message') {
            // Cancelar timeout activo porque el agente ya respondió exitosamente
            if (activeMessageTimeout) {
                clearTimeout(activeMessageTimeout);
                activeMessageTimeout = null;
            }
            lastPendingMessage = null;

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

    function hasAlreadyGreeted() {
        if (hasGreeted) return true;
        if (sessionStorage.getItem('cuentame_initial_greeting_sent') === 'true') {
            hasGreeted = true;
            return true;
        }
        if (copilotConversationId && sessionStorage.getItem('cuentame_greeted_' + copilotConversationId) === 'true') {
            hasGreeted = true;
            return true;
        }
        // Si ya existen mensajes del usuario o del asistente en el chatBox, no se debe enviar saludo
        const existingMessages = chatBox ? chatBox.querySelectorAll('.message-wrapper:not(.typing-container)') : [];
        if (existingMessages.length > 0 || pendingQueue.length > 0) {
            hasGreeted = true;
            return true;
        }
        return false;
    }

    async function triggerCopilotGreeting() {
        if (!copilotConversationId || hasAlreadyGreeted()) {
            console.log('[Greeting] Saludo inicial omitido porque ya fue emitido previamente.');
            return;
        }

        hasGreeted = true;
        sessionStorage.setItem('cuentame_initial_greeting_sent', 'true');
        if (copilotConversationId) {
            sessionStorage.setItem('cuentame_greeted_' + copilotConversationId, 'true');
        }

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
            console.log('[Greeting] Saludo inicial enviado con éxito al agente.');
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

    async function sendToCopilot(text, files = [], wrapper = null) {
        if (!copilotConversationId) {
            addSystemMessage("La conexión con el agente aún no está lista.");
            if (wrapper) {
                markMessageAsFailed(wrapper, text, files, "Sin conexión con el agente");
            }
            return;
        }

        showTypingIndicator();
        
        const payload = {
            type: 'message',
            text: text || '',
            from: { id: 'user1', role: 'user' }
        };

        try {
            let response;
            
            if (files && files.length > 0) {
                // Envío de cualquier tipo de archivo a través de /upload (multipart)
                const uploadUrl = `${copilotUrl}/${copilotConversationId}/upload?userId=user1`;
                
                const formData = new FormData();
                
                // 1. Agregar el activity (JSON) como un Blob
                const activityBlob = new Blob([JSON.stringify(payload)], { type: 'application/vnd.microsoft.activity' });
                formData.append('activity', activityBlob, 'activity.json');
                
                // 2. Agregar cada archivo real directamente
                files.forEach((fileItem) => {
                    const actualFile = fileItem.file || fileItem;
                    const fileName = fileItem.name || 'archivo';
                    formData.append('file', actualFile, fileName);
                });

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

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.error('Copilot send error:', error);
            removeTypingIndicator();
            if (activeMessageTimeout) {
                clearTimeout(activeMessageTimeout);
                activeMessageTimeout = null;
            }
            if (wrapper) {
                markMessageAsFailed(wrapper, text, files, "Error de red al enviar");
            } else {
                addSystemMessage("Error de red al enviar mensaje al agente.");
            }
        }
    }
});
