let accessToken = sessionStorage.getItem("adminToken") || "";
let currentAdminEmail = sessionStorage.getItem("adminEmail") || "";

// --- INICIALIZACIÓN ---
document.addEventListener("DOMContentLoaded", async () => {
    // Lógica para cerrar menú al hacer clic en un botón en móvil
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if(window.innerWidth <= 768) {
                document.getElementById('sidebar').classList.remove('open');
                document.getElementById('sidebarOverlay').classList.remove('active');
            }
        });
    });

    if (accessToken) {
        document.getElementById('userEmail').innerText = currentAdminEmail;
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('dashboardScreen').style.display = 'flex';
        loadProjects();
    }
});

// --- MENÚ MÓVIL ---
document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('active');
});
document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
});

// --- UI SPINNER ---
function showSpinner() {
    document.getElementById('globalSpinner').style.display = 'flex';
}
function hideSpinner() {
    document.getElementById('globalSpinner').style.display = 'none';
}

// --- AUTENTICACIÓN ---
document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    if(!email || !password) {
        showError("Por favor ingresa correo y contraseña.");
        return;
    }
    
    document.getElementById('loginBtn').disabled = true;
    document.getElementById('loginBtn').innerHTML = 'Iniciando...';
    
    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            const errorMsg = data.details ? `${data.error}: ${data.details}` : (data.error || "Error al iniciar sesión");
            throw new Error(errorMsg);
        }
        
        accessToken = data.token;
        currentAdminEmail = data.email;
        
        sessionStorage.setItem("adminToken", accessToken);
        sessionStorage.setItem("adminEmail", currentAdminEmail);
        
        document.getElementById('userEmail').innerText = currentAdminEmail;
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('dashboardScreen').style.display = 'flex';
        
        loadProjects();
    } catch (err) {
        showError(err.message);
    } finally {
        document.getElementById('loginBtn').disabled = false;
        document.getElementById('loginBtn').innerHTML = '<span class="material-symbols-rounded">login</span> Iniciar Sesión';
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem("adminToken");
    sessionStorage.removeItem("adminEmail");
    window.location.reload();
});

function showError(msg) {
    const el = document.getElementById('loginError');
    el.innerText = msg;
    el.style.display = 'block';
}

// --- NAVEGACIÓN ---
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        
        document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
        const target = e.currentTarget.getAttribute('data-target');
        document.getElementById(target).style.display = 'block';
        
        if (target === 'projectsSection') loadProjects();
        if (target === 'paramsSection') loadParams();
        if (target === 'usersSection') loadUsers();
    });
});

// --- API HELPER ---
async function apiCall(endpoint, method = 'GET', body = null) {
    showSpinner();
    try {
        const options = {
            method,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        };
        if (body) options.body = JSON.stringify(body);
        
        const res = await fetch(`/api/admin/${endpoint}`, options);
        if (!res.ok) {
            const text = await res.text();
            alert(`Error: ${text}`);
            throw new Error(text);
        }
        return res.status === 204 ? null : await res.json();
    } finally {
        hideSpinner();
    }
}

// --- CRUD PROYECTOS ---
async function loadProjects() {
    const data = await apiCall('projects');
    const tbody = document.querySelector('#projectsTable tbody');
    tbody.innerHTML = '';
    
    data.forEach(p => {
        // En Dataverse el primary key suele ser el logical name sin prefijo + id
        const id = p.coem_proyectoinnovacionid;
        const start = new Date(p.coem_fechainicio).toLocaleDateString();
        const end = new Date(p.coem_fechafin).toLocaleDateString();
        
        tbody.innerHTML += `
            <tr>
                <td data-label="Cliente">${p.coem_nombrecliente || 'Sin nombre'}</td>
                <td data-label="Inicio">${start}</td>
                <td data-label="Fin">${end}</td>
                <td class="actions" data-label="Acciones">
                    <button class="btn-icon" onclick="showQR('${id}')" title="Generar QR"><span class="material-symbols-rounded">qr_code</span></button>
                    <button class="btn-icon" onclick="editProject('${id}')" title="Editar"><span class="material-symbols-rounded">edit</span></button>
                    <button class="btn-icon" onclick="deleteProject('${id}')" title="Eliminar"><span class="material-symbols-rounded">delete</span></button>
                </td>
            </tr>
        `;
    });
}

function saveProject() {
    const id = document.getElementById('projectId').value;
    const body = {
        coem_nombrecliente: document.getElementById('projectClient').value,
        coem_descripcion: document.getElementById('projectDesc').value,
        coem_fechainicio: new Date(document.getElementById('projectStart').value).toISOString(),
        coem_fechafin: new Date(document.getElementById('projectEnd').value).toISOString(),
        coem_colorescorporativos: document.getElementById('projectColors').value || null
    };
    
    const method = id ? 'PATCH' : 'POST';
    const endpoint = id ? `projects/${id}` : 'projects';
    
    apiCall(endpoint, method, body).then(() => {
        closeModal('projectModal');
        loadProjects();
    });
}

async function editProject(id) {
    const data = await apiCall('projects');
    const p = data.find(x => x.coem_proyectoinnovacionid === id);
    if (!p) return;
    
    document.getElementById('projectId').value = id;
    document.getElementById('projectClient').value = p.coem_nombrecliente;
    document.getElementById('projectDesc').value = p.coem_descripcion;
    document.getElementById('projectStart').value = p.coem_fechainicio.substring(0, 16);
    document.getElementById('projectEnd').value = p.coem_fechafin.substring(0, 16);
    document.getElementById('projectColors').value = p.coem_colorescorporativos || '';
    document.getElementById('projectModalTitle').innerText = 'Editar Proyecto';
    openModal('projectModal');
}

function deleteProject(id) {
    if (confirm("¿Estás seguro de eliminar este proyecto?")) {
        apiCall(`projects/${id}`, 'DELETE').then(() => loadProjects());
    }
}

function showQR(id) {
    const url = `${window.location.origin}/?id=${id}`;
    document.getElementById('qrcode').innerHTML = '';
    new QRCode(document.getElementById('qrcode'), {
        text: url,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
    
    const linkEl = document.getElementById('qrLink');
    linkEl.href = url;
    linkEl.innerText = url;
    
    openModal('qrModal');
}

// --- CRUD PARAMETROS ---
async function loadParams() {
    const data = await apiCall('params');
    const tbody = document.querySelector('#paramsTable tbody');
    tbody.innerHTML = '';
    
    data.forEach(p => {
        const id = p.coem_parametroglobalideacionid;
        tbody.innerHTML += `
            <tr>
                <td data-label="Nombre">${p.coem_nombre}</td>
                <td data-label="Valor" style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.coem_valor || ''}</td>
                <td class="actions" data-label="Acciones">
                    <button class="btn-icon" onclick="editParam('${id}')" title="Editar"><span class="material-symbols-rounded">edit</span></button>
                    <button class="btn-icon" onclick="deleteParam('${id}')" title="Eliminar"><span class="material-symbols-rounded">delete</span></button>
                </td>
            </tr>
        `;
    });
}

function saveParam() {
    const id = document.getElementById('paramId').value;
    const body = {
        coem_nombre: document.getElementById('paramName').value,
        coem_valor: document.getElementById('paramValue').value
    };
    
    const method = id ? 'PATCH' : 'POST';
    const endpoint = id ? `params/${id}` : 'params';
    
    apiCall(endpoint, method, body).then(() => {
        closeModal('paramModal');
        loadParams();
    });
}

async function editParam(id) {
    const data = await apiCall('params');
    const p = data.find(x => x.coem_parametroglobalideacionid === id);
    if (!p) return;
    
    document.getElementById('paramId').value = id;
    document.getElementById('paramName').value = p.coem_nombre;
    document.getElementById('paramValue').value = p.coem_valor;
    document.getElementById('paramModalTitle').innerText = 'Editar Parámetro';
    openModal('paramModal');
}

function deleteParam(id) {
    if (confirm("¿Estás seguro de eliminar este parámetro?")) {
        apiCall(`params/${id}`, 'DELETE').then(() => loadParams());
    }
}

// --- CRUD USUARIOS ---
async function loadUsers() {
    const data = await apiCall('users');
    const tbody = document.querySelector('#usersTable tbody');
    tbody.innerHTML = '';
    
    data.forEach(p => {
        const id = p.coem_administradorid;
        tbody.innerHTML += `
            <tr>
                <td data-label="Correo (Entra ID)">${p.coem_correo}</td>
                <td class="actions" data-label="Acciones">
                    <button class="btn-icon" onclick="deleteUser('${id}')" title="Eliminar"><span class="material-symbols-rounded">delete</span></button>
                </td>
            </tr>
        `;
    });
}

function saveUser() {
    const body = {
        coem_correo: document.getElementById('userEmailInput').value,
        coem_password: document.getElementById('userPasswordInput').value
    };
    apiCall('users', 'POST', body).then(() => {
        closeModal('userModal');
        loadUsers();
    });
}

function deleteUser(id) {
    if (confirm("¿Estás seguro de eliminar este administrador? Perderá el acceso.")) {
        apiCall(`users/${id}`, 'DELETE').then(() => loadUsers());
    }
}

// --- UTILIDADES DE MODAL ---
window.openModal = function(id) {
    // Limpiar inputs al abrir para crear
    if(id === 'projectModal' && document.getElementById('projectModalTitle').innerText === 'Nuevo Proyecto') {
        document.getElementById('projectId').value = '';
        document.getElementById('projectClient').value = '';
        document.getElementById('projectDesc').value = '';
        document.getElementById('projectStart').value = '';
        document.getElementById('projectEnd').value = '';
        document.getElementById('projectColors').value = '';
    }
    if(id === 'paramModal' && document.getElementById('paramModalTitle').innerText === 'Nuevo Parámetro') {
        document.getElementById('paramId').value = '';
        document.getElementById('paramName').value = '';
        document.getElementById('paramValue').value = '';
    }
    if(id === 'userModal') {
        document.getElementById('userId').value = '';
        document.getElementById('userEmailInput').value = '';
        document.getElementById('userPasswordInput').value = '';
    }
    document.getElementById(id).classList.add('active');
}

window.closeModal = function(id) {
    document.getElementById(id).classList.remove('active');
    // Restablecer títulos
    if(id === 'projectModal') document.getElementById('projectModalTitle').innerText = 'Nuevo Proyecto';
    if(id === 'paramModal') document.getElementById('paramModalTitle').innerText = 'Nuevo Parámetro';
}
