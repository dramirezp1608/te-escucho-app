import { dataverseRequest } from '../../utils/dataverse.js';

export async function onRequestPost(context) {
    try {
        // 1. Obtener GroqApiKey de Dataverse
        const paramsResult = await dataverseRequest(context.env, 'coem_parametroglobals');
        const paramsList = paramsResult.value || [];
        const groqApiObj = paramsList.find(p => p.coem_nombre === 'GroqApiKey');

        if (!groqApiObj) {
            return new Response(JSON.stringify({ error: "GroqApiKey no configurada en el sistema." }), { status: 500 });
        }

        const groqApiKey = groqApiObj.coem_valor;

        // 2. Extraer el audio enviado desde el frontend
        const formData = await context.request.formData();
        
        // 3. Reenviar a Groq de forma segura
        const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${groqApiKey}`
            },
            body: formData
        });

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();
            throw new Error(`Error en Groq: ${errorText}`);
        }

        const data = await groqResponse.json();
        
        return new Response(JSON.stringify({ text: data.text }), { 
            headers: { 'Content-Type': 'application/json' } 
        });

    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
