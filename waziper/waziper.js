import http from 'http';
import express from 'express';
import moment from 'moment-timezone';
import bodyParser from 'body-parser';
import cors from 'cors';
import spintax from 'spintax';
import axios from 'axios';
import { Server } from 'socket.io';
import config from './../config.js';
import Common from './common.js';
import cron from 'node-cron';

const app = express();
const server = http.createServer(app);

const bulks = {};
const chatbots = {};
const limit_messages = {};
const stats_history = {};

// Cores ANSI para logs
const RED    = '\x1b[91m';
const GREEN  = '\x1b[92m';
const YELLOW = '\x1b[93m';
const BLUE   = '\x1b[94m';
const MAGENTA= '\x1b[95m';
const CYAN   = '\x1b[96m';
const WHITE  = '\x1b[97m';
const RESET  = '\x1b[0m';

console.log(GREEN + '[fzap] Iniciando integração com fzap API: ' + config.fzap.base_url + RESET);

const io = new Server(server, { cors: { origin: '*' } });

app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));

// ---------------------------------------------------------------------------
// Helpers de comunicação com a API fzap
// ---------------------------------------------------------------------------

/**
 * Chama a API fzap com o token do usuário (= instance_id).
 * Cada instância WhatsApp no wapizer corresponde a um usuário no fzap,
 * cujo token é o próprio instance_id.
 */
async function fzapCall(method, endpoint, instance_id, data = null) {
    const url = `${config.fzap.base_url}${endpoint}`;
    try {
        const response = await axios({
            method,
            url,
            headers: { token: instance_id },
            data,
            timeout: 30000
        });
        return response.data;
    } catch (err) {
        const msg = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error(RED + `[fzap] ${method.toUpperCase()} ${endpoint} [token=${instance_id}]: ${msg}` + RESET);
        throw err;
    }
}

/**
 * Chama a API fzap com o token de admin (para gerenciar usuários).
 */
async function fzapAdmin(method, endpoint, data = null) {
    const url = `${config.fzap.base_url}${endpoint}`;
    try {
        const response = await axios({
            method,
            url,
            headers: { Authorization: config.fzap.admin_token },
            data,
            timeout: 30000
        });
        return response.data;
    } catch (err) {
        const msg = err.response ? JSON.stringify(err.response.data) : err.message;
        console.error(RED + `[fzap Admin] ${method.toUpperCase()} ${endpoint}: ${msg}` + RESET);
        throw err;
    }
}

/**
 * Normaliza o resultado de envio fzap para o callback de auto_send.
 * Adiciona message_id como alias de data.id para compatibilidade PHP.
 */
function fzapSendCb(result) {
    const ok = !!(result?.success && result?.data?.details === 'Sent');
    const d  = result?.data ?? null;
    return {
        status: ok ? 1 : 0,
        stats:  true,
        data:   d ? { ...d, message_id: d.id } : null
    };
}

/**
 * Garante que o usuário fzap existe para este instance_id.
 * Cria via admin API se não existir.
 */
async function ensureFzapUser(instance_id) {
    try {
        await fzapCall('GET', '/session/status', instance_id);
    } catch (err) {
        if (err.response && (err.response.status === 401 || err.response.status === 403)) {
            try {
                const webhookUrl = `${config.fzap.webhook_base_url}/webhook/receive/${instance_id}`;
                await fzapAdmin('POST', '/admin/users', {
                    name: instance_id,
                    token: instance_id,
                    webhook: webhookUrl,
                    events: 'All'
                });
                console.log(GREEN + `[fzap] Usuário criado no fzap: ${instance_id}` + RESET);
            } catch (createErr) {
                // Usuário já pode existir – ignorar erro de duplicata
                if (!createErr.response || createErr.response.status !== 409) {
                    console.error(RED + `[fzap] Erro ao criar usuário ${instance_id}:` + RESET, createErr.message);
                }
            }
        }
    }
}

/**
 * Configura o webhook do fzap para esta instância.
 * O fzap irá enviar eventos para: <webhook_base_url>/webhook/receive/<instance_id>
 */
async function configureFzapWebhook(instance_id) {
    const webhookUrl = `${config.fzap.webhook_base_url}/webhook/receive/${instance_id}`;
    try {
        // Lista webhooks existentes
        const existing = await fzapCall('GET', '/webhook', instance_id);
        if (existing.success && Array.isArray(existing.data)) {
            const alreadySet = existing.data.find(w => w.url === webhookUrl);
            if (alreadySet) return; // já configurado
            // Remove webhooks antigos deste token
            for (const wh of existing.data) {
                await fzapCall('DELETE', `/webhook/${wh.id}`, instance_id).catch(() => {});
            }
        }
        // Cria novo webhook
        await fzapCall('POST', '/webhook', instance_id, {
            url: webhookUrl,
            events: ['Message', 'ReadReceipt', 'Connected', 'Disconnected', 'LoggedOut', 'QR']
        });
        console.log(GREEN + `[fzap] Webhook configurado para ${instance_id}: ${webhookUrl}` + RESET);
    } catch (err) {
        console.error(YELLOW + `[fzap] Aviso: não foi possível configurar webhook para ${instance_id}` + RESET);
    }
}

// ---------------------------------------------------------------------------
// Objeto principal WAZIPER (interface compatível com app.js)
// ---------------------------------------------------------------------------

const WAZIPER = {
    io,
    app,
    server,
    cors: cors(config.cors),

    // -----------------------------------------------------------------------
    // Ajuste de número de telefone (mantido do original)
    // -----------------------------------------------------------------------
    ajustaNumero(chat_id) {
        let nmr = String(chat_id).trim();
        if (nmr.includes('@g.us')) return nmr;
        const sufixoRegex = /@(c|g)\.us$/;
        if (sufixoRegex.test(nmr)) nmr = nmr.split('@')[0];
        nmr = nmr.startsWith('+') ? nmr.substring(1) : nmr;
        if (nmr.startsWith('0')) nmr = nmr.substring(1);
        if (nmr.startsWith('55') && nmr.length > 2 && nmr[2] === '0') {
            nmr = nmr.substring(0, 2) + nmr.substring(3);
        }
        if (nmr.length > 17 && !nmr.includes('@')) return nmr + '@g.us';
        const nmrDDI = nmr.substring(0, 2);
        const nmrDDD = nmr.substring(2, 4);
        const nmrSemDDIeDDD = nmr.substring(4);
        const ehCelular = ['9','8','7','6'].includes(nmrSemDDIeDDD.substring(0, 1));
        let nmrfinal = nmr;
        if (nmrDDI === '55') {
            if (parseInt(nmrDDD) <= 30 && ehCelular && nmrSemDDIeDDD.length === 8) {
                nmrfinal = nmrDDI + nmrDDD + '9' + nmrSemDDIeDDD;
            } else if (parseInt(nmrDDD) > 30 && ehCelular && nmrSemDDIeDDD.length === 9) {
                nmrfinal = nmrDDI + nmrDDD + nmrSemDDIeDDD.substring(1);
            }
        }
        return nmrfinal;
    },

    // -----------------------------------------------------------------------
    // Garante que a instância está conectada no fzap
    // -----------------------------------------------------------------------
    session: async function(instance_id) {
        await ensureFzapUser(instance_id);
        try {
            await fzapCall('POST', '/session/connect', instance_id, {
                subscribe: ['Message', 'ReadReceipt', 'ChatPresence', 'Presence'],
                immediate: true
            });
        } catch (err) {
            // Pode já estar conectado — não é erro crítico
        }
        await configureFzapWebhook(instance_id);
        return { instance_id };
    },

    // -----------------------------------------------------------------------
    // Valida access_token + instance_id e chama callback (mantém interface do app.js)
    // -----------------------------------------------------------------------
    instance: async function(access_token, instance_id, res, callback) {
        if (instance_id === undefined && res != null) {
            console.log(`[instance] ERRO: instance_id ausente`);
            return res.json({ status: 'error', message: "The Instance ID must be provided for the process to be completed" });
        }

        const team = await Common.db_get("sp_team", [{ ids: access_token }]);
        if (!team) {
            console.log(`[instance] ERRO: team não encontrado para access_token=${access_token ? access_token.slice(0,8)+'...' : 'AUSENTE'}`);
            if (res) return res.json({ status: 'error', message: "The authentication process has failed" });
            return callback(false);
        }

        const session = await Common.db_get("sp_whatsapp_sessions", [{ instance_id }, { team_id: team.id }]);
        if (!session) {
            console.log(`[instance] ERRO: sessão não encontrada — instance_id=${instance_id} team_id=${team.id}`);
            if (res) return res.json({ status: 'error', message: "The Instance ID provided has been invalidated" });
            return callback(false);
        }

        console.log(`[instance] OK — instance_id=${instance_id} team_id=${team.id}`);
        // Garante usuário e conexão no fzap
        await ensureFzapUser(instance_id);
        return callback({ instance_id, team_id: team.id });
    },

    // -----------------------------------------------------------------------
    // QR Code — obtido direto da API fzap
    // -----------------------------------------------------------------------
    get_qrcode: async function(instance_id, res) {
        try {
            const status = await fzapCall('GET', '/session/status', instance_id);
            // Sessão completamente autenticada (connected=true E loggedIn=true)
            const isFullyConnected = status.success && status.data?.connected && status.data?.loggedIn;

            if (isFullyConnected) {
                // O PHP oauth() reseta status=0 ao abrir a tela de QR.
                // Reativa sp_whatsapp_sessions E atualiza sp_accounts com
                // nome/avatar reais para que check_login() redirecione.
                const jid     = status.data.jid || '';
                const jidFull = jid ? Common.get_phone(jid, 'wid') : '';
                const phone   = jid ? Common.get_phone(jid)         : '';

                // Nome real via POST /user/info
                let pushName = '';
                try {
                    if (jidFull) {
                        const ui = await fzapCall('POST', '/user/info', instance_id, { phone: [jidFull] });
                        if (ui.success && ui.data?.users?.[jidFull]) {
                            const u = ui.data.users[jidFull];
                            pushName = u.pushName || u.fullName || u.businessName || '';
                        }
                    }
                } catch (e) { /* opcional */ }

                let avatarUrl = '';
                try {
                    if (phone) {
                        const av = await fzapCall('POST', '/user/avatar', instance_id, { phone, preview: false });
                        if (av.success && av.data?.url) avatarUrl = av.data.url;
                    }
                } catch (e) { /* opcional */ }

                const wa_info = { id: jid || instance_id, name: pushName || instance_id, avatar: avatarUrl };
                await Common.update_status_instance(instance_id, wa_info);
                // Também atualiza sp_accounts para que o nome apareça correto na UI
                await Common.db_update("sp_accounts", [
                    { status: 1, can_post: 1, name: wa_info.name, avatar: avatarUrl },
                    { token: instance_id }
                ]);
                return res.json({ status: 'success', message: 'Instance already connected', connected: true });
            }

            // Sessão com socket aberto mas aguardando QR (connected=true, loggedIn=false):
            // NÃO chamar /session/connect de novo — apenas buscar QR atual
            if (!status.data?.connected) {
                // Socket completamente inativo — precisa iniciar conexão
                await fzapCall('POST', '/session/connect', instance_id, {
                    subscribe: ['Message', 'ReadReceipt', 'ChatPresence', 'Presence'],
                    immediate: true
                }).catch(() => {});
                await new Promise(r => setTimeout(r, 3000));
            }

            const qrData = await fzapCall('GET', '/session/qr', instance_id);
            if (qrData.success && qrData.data?.qrCode) {
                return res.json({ status: 'success', message: 'Success', base64: qrData.data.qrCode });
            }
            return res.json({ status: 'error', message: "The system cannot generate a WhatsApp QR code" });
        } catch (err) {
            return res.json({ status: 'error', message: "Error getting QR code" });
        }
    },

    // -----------------------------------------------------------------------
    // connect_phone — conectar via Pair Code (sem precisar escanear QR)
    // -----------------------------------------------------------------------
    connect_phone: async function(instance_id, phone_number, res) {
        try {
            const status = await fzapCall('GET', '/session/status', instance_id);
            console.log(CYAN + `[connect_phone] ${instance_id} status: connected=${status.data?.connected} loggedIn=${status.data?.loggedIn}` + RESET);

            if (status.data?.loggedIn) {
                return res.json({ status: 'error', message: 'Already paired' });
            }

            if (!status.data?.connected) {
                console.log(CYAN + `[connect_phone] ${instance_id}: iniciando conexão (immediate:true)` + RESET);
                const conn = await fzapCall('POST', '/session/connect', instance_id, {
                    subscribe: ['Message', 'ReadReceipt', 'ChatPresence', 'Presence'],
                    immediate: true
                }).catch(err => {
                    console.warn(YELLOW + `[connect_phone] ${instance_id}: connect error: ${err.message}` + RESET);
                    return null;
                });
                console.log(CYAN + `[connect_phone] ${instance_id}: connect result: ${JSON.stringify(conn?.data)}` + RESET);
            }

            console.log(CYAN + `[connect_phone] ${instance_id}: chamando pairphone phone=${phone_number}` + RESET);
            const result = await fzapCall('POST', '/session/pairphone', instance_id, { phone: phone_number });
            console.log(CYAN + `[connect_phone] ${instance_id}: pairphone result: ${JSON.stringify(result)}` + RESET);

            if (result.success && result.data?.linkingCode) {
                return res.json({ status: 'success', message: 'Success', code: result.data.linkingCode });
            }
            const errMsg = result.error || 'Could not generate pair code';
            return res.json({ status: 'error', message: errMsg });
        } catch (err) {
            console.error(RED + `[connect_phone] ${instance_id}: exception: ${JSON.stringify(err.response?.data ?? err.message)}` + RESET);
            const msg = err.response?.data?.error || err.message;
            return res.json({ status: 'error', message: msg });
        }
    },

    // -----------------------------------------------------------------------
    // Informações da sessão — status da conexão fzap
    // -----------------------------------------------------------------------
    get_info: async function(instance_id, res) {
        try {
            const data = await fzapCall('GET', '/session/status', instance_id);
            if (data.success) {
                return res.json({ status: 'success', message: "Success", data: data.data });
            }
            return res.json({ status: 'error', message: "Error", relogin: true });
        } catch (err) {
            return res.json({ status: 'error', message: "Error", relogin: true });
        }
    },

    // -----------------------------------------------------------------------
    // Logout — desconecta no fzap e limpa DB
    // -----------------------------------------------------------------------
    logout: async function(instance_id, res) {
        Common.db_delete("sp_whatsapp_sessions", [{ instance_id }]);
        Common.db_update("sp_accounts", [{ status: 0 }, { token: instance_id }]);

        try {
            await fzapCall('POST', '/session/logout', instance_id, {});
        } catch (err) {
            // Ignorar erros de logout (sessão pode já estar encerrada)
        }

        if (res) return res.json({ status: 'success', message: 'Success' });
    },

    // -----------------------------------------------------------------------
    // Lista de grupos — via fzap /group/list
    // -----------------------------------------------------------------------
    get_groups: async function(instance_id, res) {
        try {
            const data = await fzapCall('GET', '/group/list', instance_id);
            if (data.success && data.data && data.data.groups) {
                const groups = data.data.groups.map(g => ({
                    id: g.jid,
                    name: g.name,
                    size: (g.participants || []).length,
                    desc: g.topic || '',
                    participants: (g.participants || []).map(p => ({ id: p.jid, isAdmin: p.isAdmin }))
                }));
                return res.json({ status: 'success', message: 'Success', data: groups });
            }
            return res.json({ status: 'success', message: 'Success', data: [] });
        } catch (err) {
            return res.json({ status: 'success', message: 'Success', data: [] });
        }
    },

    // -----------------------------------------------------------------------
    // Webhook — repassa eventos do fzap para o webhook configurado no wapizer
    // -----------------------------------------------------------------------
    webhook: async function(instance_id, data) {
        try {
            const tb_webhook = await Common.db_query("SHOW TABLES LIKE 'sp_whatsapp_webhook'");
            if (tb_webhook) {
                const webhook = await Common.db_query(
                    `SELECT * FROM sp_whatsapp_webhook WHERE status = 1 AND instance_id = '${instance_id}'`
                );
                if (webhook) {
                    axios.post(webhook.webhook_url, { instance_id, data }).then(() => {}).catch(() => {});
                }
            }
        } catch (err) { /* ignorar */ }
    },

    // -----------------------------------------------------------------------
    // Registrar envio no banco (mantido do original)
    // -----------------------------------------------------------------------
    registrarEnvioWhatsApp: async function(whatsapp, instance_id, team_id, conteudo_mensagem, status_envio, tipo_envio) {
        const hora_mensagem = moment().tz("America/Sao_Paulo").format('YYYY-MM-DD HH:mm:ss');
        const query = `INSERT INTO sp_whatsapp_envios (whatsapp, instance_id, team_id, conteudo_mensagem, hora_mensagem, status_envio, tipo_envio) VALUES ('${whatsapp}', '${instance_id}', '${team_id}', '${conteudo_mensagem}', '${hora_mensagem}', '${status_envio}', '${tipo_envio}')`;
        try {
            await Common.db_query(query, true);
        } catch (error) {
            console.error(RED + "Erro ao registrar envio:" + RESET, error);
        }
    },

    // -----------------------------------------------------------------------
    // Verificar se mensagem já foi enviada recentemente (mantido do original)
    // -----------------------------------------------------------------------
    verificaMensagemEnviada: async function(whatsapp, instance_id, team_id, conteudo_mensagem) {
        try {
            const query = `SELECT COUNT(*) AS count FROM sp_whatsapp_envios WHERE whatsapp = '${whatsapp}' AND instance_id = '${instance_id}' AND team_id = '${team_id}' AND conteudo_mensagem = '${conteudo_mensagem}' AND status_envio = '1' AND hora_mensagem > NOW() - INTERVAL 10 MINUTE`;
            const result = await Common.db_query(query, false);
            return result[0].count > 0;
        } catch (err) {
            return false;
        }
    },

    // -----------------------------------------------------------------------
    // send_message — roteia para fzap conforme tipo de mídia
    // -----------------------------------------------------------------------
    send_message: async function(instance_id, access_token, req, res) {
        const chat_id  = this.ajustaNumero(req.body.chat_id);
        const media_url = req.body.media_url;
        const caption   = req.body.caption;
        const filename  = req.body.filename;

        const team = await Common.db_get("sp_team", [{ ids: access_token }]);
        if (!team) return res.json({ status: 'error', message: "The authentication process has failed" });

        const item = { team_id: team.id, type: 1, caption, media: media_url, filename };
        const msgConversa = caption + (media_url ? ` - ${media_url}` : '');
        const mensagemJaEnviada = await this.verificaMensagemEnviada(chat_id, instance_id, team.id, msgConversa);

        if (!mensagemJaEnviada) {
            await WAZIPER.auto_send(instance_id, chat_id, chat_id, "api", item, false, false, async (result) => {
                if (result && result.status === 1) {
                    await this.registrarEnvioWhatsApp(chat_id, instance_id, team.id, msgConversa, '1', 'api');
                    return res.json({ status: 'success', message: "Success", data: result.data });
                }
                return res.json({ status: 'error', message: "Error sending message" });
            });
        } else {
            return res.json({ status: 'error', message: "Mensagem já enviada recentemente." });
        }
    },

    // -----------------------------------------------------------------------
    // send_location — via fzap /chat/send/location
    // -----------------------------------------------------------------------
    send_location: async function(instance_id, access_token, req, res) {
        const chat_id   = this.ajustaNumero(req.body.chat_id);
        const latitude  = parseFloat(req.body.latitude);
        const longitude = parseFloat(req.body.longitude);

        const team = await Common.db_get("sp_team", [{ ids: access_token }]);
        if (!team) return res.json({ status: 'error', message: "The authentication process has failed" });

        try {
            const result = await fzapCall('POST', '/chat/send/location', instance_id, {
                phone: chat_id,
                latitude,
                longitude
            });
            if (result.success) {
                return res.json({ status: 'success', message: "Success", data: result.data });
            }
            return res.json({ status: 'error', message: "Error sending location" });
        } catch (err) {
            return res.json({ status: 'error', message: "Error" });
        }
    },

    // -----------------------------------------------------------------------
    // send_contact — via fzap /chat/send/contact
    // -----------------------------------------------------------------------
    send_contact: async function(instance_id, access_token, req, res) {
        const chat_id     = this.ajustaNumero(req.body.chat_id);
        const name        = req.body.name || '';
        const phone       = req.body.phone || '';
        const vcard       = req.body.vcard || '';

        const team = await Common.db_get("sp_team", [{ ids: access_token }]);
        if (!team) return res.json({ status: 'error', message: "The authentication process has failed" });

        const payload = { phone: chat_id, name };
        if (vcard) {
            payload.vcard = vcard;
        } else if (phone) {
            payload.vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;waid=${phone}:+${phone}\nEND:VCARD`;
        }

        try {
            const result = await fzapCall('POST', '/chat/send/contact', instance_id, payload);
            if (result.success) {
                return res.json({ status: 'success', message: "Success", data: result.data });
            }
            return res.json({ status: 'error', message: "Error sending contact" });
        } catch (err) {
            return res.json({ status: 'error', message: "Error" });
        }
    },

    // -----------------------------------------------------------------------
    // send_poll — via fzap /chat/send/poll
    // -----------------------------------------------------------------------
    send_poll: async function(instance_id, access_token, req, res) {
        const chat_id = this.ajustaNumero(req.body.chat_id);
        const question = req.body.question || req.body.header || '';
        const options  = req.body.options || [];

        const team = await Common.db_get("sp_team", [{ ids: access_token }]);
        if (!team) return res.json({ status: 'error', message: "The authentication process has failed" });

        try {
            const result = await fzapCall('POST', '/chat/send/poll', instance_id, {
                group: chat_id,
                header: question,
                options: Array.isArray(options) ? options : [options]
            });
            if (result.success) {
                return res.json({ status: 'success', message: "Success", data: result.data });
            }
            return res.json({ status: 'error', message: "Error sending poll" });
        } catch (err) {
            return res.json({ status: 'error', message: "Error" });
        }
    },

    // -----------------------------------------------------------------------
    // read_poll — marca mensagem de poll como lida
    // -----------------------------------------------------------------------
    read_poll: async function(instance_id, access_token, req, res) {
        const msg_id = req.body.msg_id || req.body.id || '';
        const chat   = this.ajustaNumero(req.body.chat_id || req.body.chat || '');

        const team = await Common.db_get("sp_team", [{ ids: access_token }]);
        if (!team) return res.json({ status: 'error', message: "The authentication process has failed" });

        try {
            const result = await fzapCall('POST', '/chat/markread', instance_id, {
                id: [msg_id],
                chat
            });
            if (result.success) {
                return res.json({ status: 'success', message: "Success" });
            }
            return res.json({ status: 'error', message: "Error" });
        } catch (err) {
            return res.json({ status: 'error', message: "Error" });
        }
    },

    // -----------------------------------------------------------------------
    // auto_send — envia mensagem via fzap conforme tipo de conteúdo
    // -----------------------------------------------------------------------
    auto_send: async function(instance_id, chat_id, phone_number, type, item, params, msg_info, callback) {
        chat_id = this.ajustaNumero(chat_id);

        const limit = await WAZIPER.limit(item, type);
        if (!limit) {
            return callback({ status: 0, stats: false, message: "The number of messages you have sent per month has exceeded the maximum limit" });
        }

        // --- Extrai dados de contexto de msg_info ---
        let msgRecebida = '', cleanedWaName = '', userPhone = chat_id;
        let nextAction = '', inputName = '', saveData = '';

        if (msg_info && typeof msg_info === 'object') {
            cleanedWaName = (msg_info.cleanedWaName || '').replace(/[&<>"']/g, '');
            userPhone     = msg_info.userPhone || chat_id;
            msgRecebida   = msg_info.msgConversa || '';
            nextAction    = msg_info.nextAction  || '';
            inputName     = msg_info.inputName   || '';
            saveData      = msg_info.saveData    || '';
        } else if (msg_info && typeof msg_info === 'string') {
            try {
                const parsed = JSON.parse(msg_info);
                cleanedWaName = (parsed.pushName || '').replace(/[&<>"']/g, '');
                userPhone     = parsed.key?.remoteJid?.split('@')[0] || chat_id;
                const msgObj  = parsed.message || {};
                msgRecebida   = msgObj.conversation || msgObj.extendedTextMessage?.text || '';
            } catch (e) { /* ignorar */ }
        }

        // --- Processa caption com variáveis ---
        let caption = spintax.unspin(item.caption || '');
        caption = caption
            .replace('%msg_recebida%', msgRecebida)
            .replace('%wa_nome%', cleanedWaName)
            .replace('%wa_numero%', userPhone)
            .replace('[wa_name]', cleanedWaName)
            .replace('[user_phone]', userPhone);

        if (params) caption = Common.params(params, caption);

        // Substituições de data/hora
        caption = this._substituiVariaveisDatas(caption);

        // Duração / delay
        let duration = 4000;
        const delayRegex = /^%(\d+)%/;
        const delayMatch = caption.match(delayRegex);
        if (delayMatch && Number(delayMatch[1]) >= 1 && Number(delayMatch[1]) <= 60) {
            duration = Number(delayMatch[1]) * 1000;
            caption  = caption.replace(delayRegex, '').trim();
        }

        // Aguarda o delay simulando "digitando"
        if (duration > 0) {
            await fzapCall('POST', '/chat/presence', instance_id, { phone: chat_id, state: 'composing' }).catch(() => {});
            await new Promise(r => setTimeout(r, duration));
            await fzapCall('POST', '/chat/presence', instance_id, { phone: chat_id, state: 'paused' }).catch(() => {});
        }

        try {
            switch (item.type) {
                // --- Botões ---
                case 2: {
                    const template = await WAZIPER.button_template_handler(item.template, params);
                    if (!template) {
                        return callback({ status: 0, stats: true });
                    }
                    const btns = (template.templateButtons || []).map((b, i) => {
                        if (b.quickReplyButton) return { buttonId: `btn-${i+1}`, buttonText: b.quickReplyButton.displayText };
                        if (b.urlButton)        return { buttonId: `btn-${i+1}`, buttonText: b.urlButton.displayText, type: 'url', url: b.urlButton.url };
                        if (b.callButton)       return { buttonId: `btn-${i+1}`, buttonText: b.callButton.displayText, type: 'call', phoneNumber: b.callButton.phoneNumber };
                        return null;
                    }).filter(Boolean);

                    const result = await fzapCall('POST', '/chat/send/buttons', instance_id, {
                        phone:   chat_id,
                        title:   template.text || caption,
                        text:    template.text || caption,
                        footer:  template.footer || '',
                        buttons: btns
                    });
                    WAZIPER.stats(instance_id, type, item, result.success ? 1 : 0);
                    return callback(fzapSendCb(result));
                }

                // --- Lista ---
                case 3: {
                    const template = await WAZIPER.list_message_template_handler(item.template, params);
                    if (!template) {
                        return callback({ status: 0, stats: true });
                    }
                    const result = await fzapCall('POST', '/chat/send/list', instance_id, {
                        phone:      chat_id,
                        text:       template.text || caption,
                        title:      template.title || '',
                        footer:     template.footer || '',
                        buttonText: template.buttonText || 'Escolher',
                        sections:   template.sections || []
                    });
                    WAZIPER.stats(instance_id, type, item, result.success ? 1 : 0);
                    return callback(fzapSendCb(result));
                }

                // --- Mídia e Texto (padrão) ---
                default: {
                    // Limpa marcadores especiais do caption antes de enviar
                    const cleanCaption = caption.replace(/%a%|%t%|%v%|%i%|%d%/g, '').trim();

                    if (item.media && item.media !== '') {
                        const mime      = Common.ext2mime(item.media);
                        const post_type = Common.post_type(mime, 1);
                        const filename  = item.filename || Common.get_file_name(item.media);
                        let result;

                        if (post_type === 'videoMessage') {
                            result = await fzapCall('POST', '/chat/send/video', instance_id, {
                                phone:   chat_id,
                                video:   item.media,
                                caption: cleanCaption
                            });
                        } else if (post_type === 'imageMessage') {
                            result = await fzapCall('POST', '/chat/send/image', instance_id, {
                                phone:   chat_id,
                                image:   item.media,
                                caption: cleanCaption
                            });
                        } else if (post_type === 'audioMessage') {
                            // Se há texto além do áudio, envia texto também
                            if (cleanCaption && caption.includes('%t%')) {
                                await fzapCall('POST', '/chat/send/text', instance_id, { phone: chat_id, body: cleanCaption });
                                await new Promise(r => setTimeout(r, 1000));
                            }
                            result = await fzapCall('POST', '/chat/send/audio', instance_id, {
                                phone: chat_id,
                                audio: item.media,
                                ptt:   true,
                                delay: duration
                            });
                            if (cleanCaption && caption.includes('%a%')) {
                                await new Promise(r => setTimeout(r, 1000));
                                await fzapCall('POST', '/chat/send/text', instance_id, { phone: chat_id, body: cleanCaption });
                            }
                        } else {
                            result = await fzapCall('POST', '/chat/send/document', instance_id, {
                                phone:    chat_id,
                                document: item.media,
                                fileName: filename,
                                caption:  cleanCaption
                            });
                        }

                        WAZIPER.stats(instance_id, type, item, result && result.success ? 1 : 0);
                        return callback(fzapSendCb(result));
                    } else {
                        // Apenas texto
                        if (!cleanCaption) {
                            return callback({ status: 0, stats: true });
                        }
                        const result = await fzapCall('POST', '/chat/send/text', instance_id, {
                            phone: chat_id,
                            body:  cleanCaption,
                            delay: duration
                        });
                        WAZIPER.stats(instance_id, type, item, result.success ? 1 : 0);
                        return callback({ status: result.success ? 1 : 0, stats: true, data: result.data });
                    }
                }
            }
        } catch (err) {
            console.error(RED + `[fzap] auto_send erro (${instance_id}):` + RESET, err.message);
            WAZIPER.stats(instance_id, type, item, 0);
            return callback({ status: 0, stats: true });
        }
    },

    // -----------------------------------------------------------------------
    // Substituição de variáveis de data/hora na mensagem
    // -----------------------------------------------------------------------
    _substituiVariaveisDatas(caption) {
        const now = moment().tz("America/Sao_Paulo");
        const meses = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
        const dias  = ["Domingo","Segunda-feira","Terça-feira","Quarta-feira","Quinta-feira","Sexta-feira","Sábado"];
        const hora  = now.format('HH');
        const minuto= now.format('mm');

        let saudacao = "Boa noite";
        const h = parseInt(hora);
        if (h >= 5  && h < 12) saudacao = "Bom dia";
        else if (h >= 12 && h < 18) saudacao = "Boa tarde";

        const codigoUnico   = Math.floor(Math.random() * 9000000) + 1000000;
        const codigoProtocolo = `Prot-${now.format('DDMMYYYYHHmm')}${codigoUnico}`;

        const amanha = moment(now).add(1, 'day');

        return caption
            .replace('#dia#',            now.format('DD'))
            .replace('#mes#',            now.format('MM'))
            .replace('#mesescrito#',     meses[now.month()])
            .replace('#ano4#',           now.format('YYYY'))
            .replace('#ano2#',           now.format('YY'))
            .replace('#diaescrito#',     dias[now.day()])
            .replace('#proximodia#',     amanha.format('DD'))
            .replace('#proximomes#',     amanha.format('MM'))
            .replace('#data#',           now.format('DD/MM/YYYY'))
            .replace('#hora#',           hora)
            .replace('#minuto#',         minuto)
            .replace('#horario#',        `${hora}:${minuto}`)
            .replace('#saudacao#',       saudacao)
            .replace('#protocolo#',      codigoProtocolo);
    },

    // -----------------------------------------------------------------------
    // Autoresponder — processa mensagem recebida e envia resposta automática
    // -----------------------------------------------------------------------
    autoresponder: async function(instance_id, user_type, message) {
        const chat_id = message.key?.remoteJid || '';
        const now     = new Date().getTime() / 1000;

        const item = await Common.db_get("sp_whatsapp_autoresponder", [{ instance_id }, { status: 1 }]);
        if (!item) return false;

        switch (item.send_to) {
            case 2: if (user_type === "group") return false; break;
            case 3: if (user_type === "user")  return false; break;
        }

        const except_data = item.except ? item.except.split(",") : [];
        for (const ex of except_data) {
            if (ex !== "" && chat_id.indexOf(ex) !== -1) return false;
        }

        const cleanedWaName = (message.pushName || '').replace(/[&<>"']/g, '');
        const userPhone     = chat_id.split('@')[0];
        const idConversa    = message.key?.id || '';
        const participanteGrupo = message.key?.participant || '';

        let msgConversa = '';
        try {
            msgConversa = message.message?.conversation ||
                          message.message?.extendedTextMessage?.text || '';
        } catch(e) {}

        item.caption = (item.caption || '')
            .replace('%msg_recebida%', msgConversa)
            .replace('%wa_nome%', cleanedWaName)
            .replace('%wa_numero%', userPhone);

        const responseRecord = await Common.db_query(
            `SELECT * FROM sp_whatsapp_ar_responses WHERE whatsapp = '${userPhone}' AND instance_id = '${instance_id}' LIMIT 1`,
            false
        );

        if (responseRecord && responseRecord.length > 0) {
            const timeElapsed = now - new Date(responseRecord[0].last_response).getTime() / 1000;
            if (timeElapsed < (item.delay || 0) * 60) return false;
            await Common.db_update("sp_whatsapp_ar_responses", [{ last_response: new Date() }, { id: responseRecord[0].id }]);
        } else {
            await Common.db_query(
                `INSERT INTO sp_whatsapp_ar_responses (whatsapp, instance_id, last_response) VALUES ('${userPhone}', '${instance_id}', NOW())`,
                true
            );
        }

        const msg_info = { cleanedWaName, userPhone, idConversa, msgConversa, participanteGrupo, nextAction: '', inputName: '', saveData: '' };

        await WAZIPER.auto_send(instance_id, chat_id, chat_id, "autoresponder", item, false, msg_info, (result) => {
            console.log(CYAN + `[autoresponder] ${instance_id} → ${userPhone}: status=${result.status}` + RESET);
        });
        return false;
    },

    // -----------------------------------------------------------------------
    // Chatbot — processa palavras-chave e responde
    // -----------------------------------------------------------------------
    chatbot: async function(instance_id, user_type, message) {
        const chat_id = message.key?.remoteJid || '';
        const items   = await Common.db_fetch("sp_whatsapp_chatbot", [{ instance_id }, { status: 1 }, { run: 1 }]);
        if (!items) return false;

        const cleanedWaName = (message.pushName || '').replace(/[&<>"']/g, '');
        const userPhone     = chat_id.split('@')[0];
        const idConversa    = message.key?.id || '';
        const participanteGrupo = message.key?.participant || '';

        let msgConversa = '';
        try {
            if (message.message?.templateButtonReplyMessage)
                msgConversa = message.message.templateButtonReplyMessage.selectedDisplayText || '';
            else if (message.message?.listResponseMessage)
                msgConversa = (message.message.listResponseMessage.title || '') + ' ' + (message.message.listResponseMessage.description || '');
            else
                msgConversa = message.message?.conversation ||
                              message.message?.extendedTextMessage?.text ||
                              message.message?.imageMessage?.caption ||
                              message.message?.videoMessage?.caption || '';
        } catch(e) {}

        const content = msgConversa.toLowerCase();
        let sent = false;

        for (const item of items) {
            if (sent) break;

            switch (item.send_to) {
                case 2: if (user_type === "group") continue; break;
                case 3: if (user_type === "user")  continue; break;
            }

            const keywords = (item.keywords || '').split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
            const nextaction = item.nextaction || '';
            const savedata   = item.savedata   || '';
            const inputname  = item.inputname  || '';

            let run = false;
            if (item.type_search == 1) {
                // Contém: mensagem contém a palavra-chave
                run = keywords.some(kw => content.includes(kw));
            } else if (item.type_search == 2) {
                // Exato: mensagem igual à palavra-chave
                run = keywords.some(kw => content === kw);
            } else if (item.type_search == 3) {
                // Partes ordenadas: "fal.atend" → ["fal","atend"] devem aparecer EM ORDEM
                // na mensagem, cada parte no início de uma palavra (fronteira de palavra)
                // Exemplo: "fal.atend" reconhece "falar com atendente" e "quero falar com um atendente"
                run = keywords.some(kw => {
                    const parts = kw.split('.');
                    let idx = 0;
                    return parts.every(part => {
                        const pos = content.indexOf(part.trim(), idx);
                        if (pos !== -1 && (pos === 0 || /\s/.test(content.charAt(pos - 1)))) {
                            idx = pos + part.length;
                            return true;
                        }
                        return false;
                    });
                });
            } else if (item.type_search == 4) {
                // Prefixo com contexto: keyword presente E há conteúdo adicional após ela
                // Usado em fluxos de agendamento (ex: "AGENDAR manicure" extrai "manicure")
                run = keywords.some(kw => {
                    const pos = content.indexOf(kw);
                    return pos !== -1 && content.substring(pos).trim().length > kw.length;
                });
            } else {
                run = keywords.some(kw => content.includes(kw));
            }

            if (!run) continue;

            sent = true;
            const msg_info = {
                cleanedWaName, userPhone, idConversa, msgConversa,
                participanteGrupo, nextAction: nextaction, inputName: inputname, saveData: savedata
            };

            await WAZIPER.auto_send(instance_id, chat_id, chat_id, "chatbot", item, false, msg_info, (result) => {
                console.log(CYAN + `[chatbot] ${instance_id} → ${userPhone}: status=${result.status}` + RESET);
            });

            // Dispara automaticamente o próximo passo do fluxo (nextaction encadeado)
            if (nextaction) {
                await WAZIPER._chatbot_nextaction(instance_id, chat_id, nextaction, msg_info, 0);
            }
        }

        return sent; // true se o chatbot respondeu, false caso contrário
    },

    // Dispara o próximo item do chatbot pelo campo "nextaction" (encadeamento de fluxo)
    _chatbot_nextaction: async function(instance_id, chat_id, nextaction, msg_info, depth) {
        if (depth > 5) return; // proteção contra loop infinito
        const items_next = await Common.db_fetch("sp_whatsapp_chatbot", [{ keywords: nextaction }, { instance_id }, { status: 1 }, { run: 1 }]);
        if (!items_next || items_next.length === 0) return;
        const next_item = items_next[0];
        await new Promise(r => setTimeout(r, 5000));
        await WAZIPER.auto_send(instance_id, chat_id, chat_id, "chatbot", next_item, false, msg_info, (result) => {
            console.log(CYAN + `[chatbot/next] ${instance_id} → ${chat_id}: step=${depth+1} status=${result.status}` + RESET);
        });
        const next_next = next_item.nextaction || '';
        if (next_next && next_next !== nextaction) {
            await WAZIPER._chatbot_nextaction(instance_id, chat_id, next_next, msg_info, depth + 1);
        }
    },

    // -----------------------------------------------------------------------
    // Bulk messaging — disparador de campanhas agendadas (mantém lógica original)
    // -----------------------------------------------------------------------
    bulk_messaging: async function() {
        const self = this;
        const d = new Date();
        const time_now = d.getTime() / 1000;

        const items = await Common.db_query(
            `SELECT * FROM sp_whatsapp_schedules WHERE status = 1 AND run <= '${time_now}' AND accounts != '' AND time_post <= '${time_now}' ORDER BY time_post ASC LIMIT 5`,
            false
        );
        if (!items) return;

        for (const item of items) {
            await Common.db_update("sp_whatsapp_schedules", [{ run: time_now + 30 }, { id: item.id }]);
        }

        for (const item of items) {
            let current_hour = -1;
            if (item.timezone !== "") {
                const user_diff = Common.getTZDiff(item.timezone);
                current_hour = d.getHours() + (user_diff * -1);
                if (current_hour > 23) current_hour -= 23;
            }

            if (item.schedule_time !== "" && current_hour !== -1) {
                const schedule_time = JSON.parse(item.schedule_time);
                if (!schedule_time.includes(current_hour.toString())) {
                    let next_time = -1;
                    const user_diff = Common.getTZDiff(item.timezone);
                    const date = new Date((d.getTime()/1000 + (user_diff * -1) * 60 * 60) * 1000);
                    for (let i = 1; i <= 24; i++) {
                        Common.roundMinutes(date);
                        const hour = date.getHours();
                        if (schedule_time.includes(hour.toString())) {
                            const minutes = new Date(time_now*1000).getMinutes();
                            const max_minute_rand = (minutes > 10) ? 10 : minutes;
                            const random_add = Common.randomIntFromInterval(0, max_minute_rand);
                            next_time = d.getTime()/1000 + i*60*60 - ((minutes - random_add) * 60);
                            break;
                        }
                    }
                    if (next_time === -1) {
                        await Common.db_update("sp_whatsapp_schedules", [{ status: 2 }, { id: item.id }]);
                    } else {
                        await Common.db_update("sp_whatsapp_schedules", [{ time_post: next_time }, { id: item.id }]);
                    }
                    continue;
                }
            }

            const query_phone_data = (item.result && item.result !== '')
                ? JSON.parse(item.result).map(r => r.phone_number.toString())
                : [];

            const phone_number_item = await Common.get_phone_number(item.contact_id, query_phone_data);
            if (!phone_number_item) {
                Common.db_update("sp_whatsapp_schedules", [{ status: 2, run: 0 }, { id: item.id }]);
                continue;
            }

            let phone_number = phone_number_item.phone;
            const params     = phone_number_item.params;

            const accounts      = JSON.parse(item.accounts);
            const next_account  = (item.next_account == null || item.next_account === "" || item.next_account >= accounts.length) ? 0 : item.next_account;

            const check_account = await Common.get_accounts(accounts.join(","));
            if (check_account && check_account.count === 0) {
                Common.db_update("sp_whatsapp_schedules", [{ status: 0 }, { id: item.id }]);
            }

            let instance_id = false;

            for (let index = 0; index < accounts.length; index++) {
                if (index !== next_account) continue;
                const account_item = await Common.db_get("sp_accounts", [{ id: accounts[index] }, { status: 1 }]);
                if (account_item) instance_id = account_item.token;
                break;
            }

            if (!instance_id) {
                await Common.db_update("sp_whatsapp_schedules", [{ next_account: next_account + 1, run: 1 }, { id: item.id }]);
                continue;
            }

            const chat_id = phone_number.includes('@g.us')
                ? phone_number
                : (phone_number.length > 17 ? phone_number + "@g.us" : phone_number + "@c.us");

            const mensagemJaEnviada = await self.verificaMensagemEnviada(phone_number, instance_id, item.team_id, item.caption);
            if (mensagemJaEnviada) {
                console.log(YELLOW + `[bulk] Mensagem já enviada para ${phone_number}, pulando...` + RESET);
                continue;
            }

            await WAZIPER.auto_send(instance_id, chat_id, chat_id, "bulk", item, params, false, async (result) => {
                if (result.stats) {
                    const status = result.status;
                    const new_stats = { phone_number, status };
                    const result_list = (item.result == null || item.result === "")
                        ? [new_stats]
                        : [...JSON.parse(item.result), new_stats];

                    if (bulks[item.id] === undefined) bulks[item.id] = {};
                    if (bulks[item.id].bulk_sent === undefined) {
                        bulks[item.id].bulk_sent   = item.sent;
                        bulks[item.id].bulk_failed = item.failed;
                    }
                    bulks[item.id].bulk_sent   += (status ? 1 : 0);
                    bulks[item.id].bulk_failed += (!status ? 1 : 0);

                    const now2     = Math.floor(new Date().getTime() / 1000);
                    const rand_t   = Math.floor(Math.random() * item.max_delay) + item.min_delay;
                    let next_time  = item.time_post + rand_t;
                    if (next_time < now2) next_time = now2 + rand_t;

                    await self.registrarEnvioWhatsApp(phone_number, instance_id, item.team_id, item.caption, '1', 'bulk');
                    await Common.db_update("sp_whatsapp_schedules", [{
                        result:       JSON.stringify(result_list),
                        sent:         bulks[item.id].bulk_sent,
                        failed:       bulks[item.id].bulk_failed,
                        time_post:    next_time,
                        next_account: next_account + 1,
                        run:          0
                    }, { id: item.id }]);
                }
            });
        }
    },

    // -----------------------------------------------------------------------
    // live_back — mantém sessões ativas (verifica contas no DB e reconecta)
    // -----------------------------------------------------------------------
    live_back: async function() {
        const account = await Common.db_query(`
            SELECT a.changed, a.token as instance_id, a.id, b.ids as access_token
            FROM sp_accounts as a
            INNER JOIN sp_team as b ON a.team_id=b.id
            WHERE a.social_network = 'whatsapp' AND a.login_type = '2' AND a.status = 1
            ORDER BY a.changed ASC
            LIMIT 1
        `);

        if (account) {
            const now = new Date().getTime() / 1000;
            await Common.db_update("sp_accounts", [{ changed: now }, { id: account.id }]);

            try {
                const status = await fzapCall('GET', '/session/status', account.instance_id);
                // Usa Connected (capital) pois LoggedIn pode ser false em sessões válidas aguardando QR
                const isActive = status.success && status.data &&
                    (status.data.Connected || status.data.connected ||
                     status.data.LoggedIn  || status.data.loggedIn);
                if (!isActive) {
                    // Reconecta apenas se o socket está completamente inativo
                    await WAZIPER.session(account.instance_id).catch(() => {});
                }
            } catch (err) {
                // Instância pode não existir ainda no fzap — tenta criar
                await WAZIPER.session(account.instance_id).catch(() => {});
            }
        }
    },

    // -----------------------------------------------------------------------
    // add_account — chamada após login bem-sucedido (mantém lógica original)
    // -----------------------------------------------------------------------
    add_account: async function(instance_id, team_id, wa_info, account) {
        if (!account) {
            await Common.db_insert_account(instance_id, team_id, wa_info);
        } else {
            const old_instance_id = account.token;
            await Common.db_update_account(instance_id, team_id, wa_info, account.id);
            if (instance_id !== old_instance_id) {
                await Common.db_delete("sp_whatsapp_sessions", [{ instance_id: old_instance_id }]);
                await Common.db_update("sp_whatsapp_autoresponder", [{ instance_id }, { instance_id: old_instance_id }]);
                await Common.db_update("sp_whatsapp_chatbot",        [{ instance_id }, { instance_id: old_instance_id }]);
                await Common.db_update("sp_whatsapp_webhook",        [{ instance_id }, { instance_id: old_instance_id }]);
                await WAZIPER.logout(old_instance_id).catch(() => {});
            }
            const pid = Common.get_phone(wa_info.id, 'wid');
            const account_other = await Common.db_query(`SELECT id FROM sp_accounts WHERE pid = '${pid}' AND team_id = '${team_id}' AND id != '${account.id}'`);
            if (account_other) {
                await Common.db_delete("sp_accounts", [{ id: account_other.id }]);
            }
        }
        const wa_stats = await Common.db_get("sp_whatsapp_stats", [{ team_id }]);
        if (!wa_stats) await Common.db_insert_stats(team_id);
    },

    // -----------------------------------------------------------------------
    // limit — verifica limite mensal de mensagens (mantido do original)
    // -----------------------------------------------------------------------
    limit: async function(item, type) {
        const time_now = Math.floor(new Date().getTime() / 1000);

        const team = await Common.db_query(`SELECT owner FROM sp_team WHERE id = '${item.team_id}'`);
        if (!team) return false;

        const user = await Common.db_query(`SELECT expiration_date FROM sp_users WHERE id = '${team.owner}'`);
        if (!user) return false;

        if (user.expiration_date !== 0 && user.expiration_date < time_now) return false;

        if (stats_history[item.team_id] === undefined) {
            stats_history[item.team_id] = {};
            const current_stats = await Common.db_get("sp_whatsapp_stats", [{ team_id: item.team_id }]);
            if (current_stats) {
                Object.assign(stats_history[item.team_id], current_stats);
            } else {
                return false;
            }
        }

        if (stats_history[item.team_id].wa_time_reset < time_now) {
            stats_history[item.team_id].wa_total_sent_by_month = 0;
            stats_history[item.team_id].wa_time_reset = time_now + 30*60*60*24;
        }

        if (limit_messages[item.team_id] === undefined) {
            limit_messages[item.team_id] = {};
            const t = await Common.db_get("sp_team", [{ id: item.team_id }]);
            if (t) {
                const perms = JSON.parse(t.permissions);
                limit_messages[item.team_id].whatsapp_message_per_month = parseInt(perms.whatsapp_message_per_month);
                limit_messages[item.team_id].next_update = 0;
            } else {
                return false;
            }
        }

        if (limit_messages[item.team_id].next_update < time_now) {
            const t = await Common.db_get("sp_team", [{ id: item.team_id }]);
            if (t) {
                const perms = JSON.parse(t.permissions);
                limit_messages[item.team_id].whatsapp_message_per_month = parseInt(perms.whatsapp_message_per_month);
                limit_messages[item.team_id].next_update = time_now + 30;
            }
        }

        if (limit_messages[item.team_id] !== undefined && stats_history[item.team_id] !== undefined) {
            if (limit_messages[item.team_id].whatsapp_message_per_month <= stats_history[item.team_id].wa_total_sent_by_month) {
                if (type === "bulk") {
                    await Common.db_update("sp_whatsapp_schedules", [{ run: 0, status: 0 }, { id: item.id }]);
                }
                return false;
            }
        }

        return true;
    },

    // -----------------------------------------------------------------------
    // stats — atualiza estatísticas de envio no banco (mantido do original)
    // -----------------------------------------------------------------------
    stats: async function(instance_id, type, item, status) {
        const time_now = Math.floor(new Date().getTime() / 1000);
        if (!stats_history[item.team_id]) return;

        if (stats_history[item.team_id].wa_time_reset < time_now) {
            stats_history[item.team_id].wa_total_sent_by_month = 0;
            stats_history[item.team_id].wa_time_reset = time_now + 30*60*60*24;
        }

        const sent   = status ? 1 : 0;
        const failed = !status ? 1 : 0;
        stats_history[item.team_id].wa_total_sent_by_month += sent;
        stats_history[item.team_id].wa_total_sent += sent;

        switch (type) {
            case "chatbot":
                if (!chatbots[item.id]) chatbots[item.id] = { chatbot_sent: item.sent, chatbot_failed: item.failed };
                chatbots[item.id].chatbot_sent   += sent;
                chatbots[item.id].chatbot_failed += failed;
                stats_history[item.team_id].wa_chatbot_count += sent;
                await Common.db_update("sp_whatsapp_chatbot", [{ sent: chatbots[item.id].chatbot_sent, failed: chatbots[item.id].chatbot_failed }, { id: item.id }]);
                break;
            case "autoresponder":
                stats_history[item.team_id].wa_autoresponder_count += sent;
                await Common.db_update("sp_whatsapp_autoresponder", [{ sent: item.sent + sent, failed: item.failed + failed }, { id: item.id }]);
                break;
            case "bulk":
                stats_history[item.team_id].wa_bulk_total_count  += 1;
                stats_history[item.team_id].wa_bulk_sent_count   += sent;
                stats_history[item.team_id].wa_bulk_failed_count += failed;
                break;
            case "api":
                stats_history[item.team_id].wa_api_count += sent;
                break;
        }

        if (stats_history[item.team_id].next_update < time_now) {
            stats_history[item.team_id].next_update = time_now + 30;
        }
        await Common.db_update("sp_whatsapp_stats", [stats_history[item.team_id], { team_id: item.team_id }]);
    },

    // -----------------------------------------------------------------------
    // Template handlers (botões e listas) — mantidos do original
    // -----------------------------------------------------------------------
    button_template_handler: async function(template_id, params) {
        const template = await Common.db_get("sp_whatsapp_template", [{ id: template_id }, { type: 2 }]);
        if (!template) return false;
        const data = JSON.parse(template.data);
        if (data.text)    data.text    = Common.params(params, spintax.unspin(data.text));
        if (data.caption) data.caption = Common.params(params, spintax.unspin(data.caption));
        if (data.footer)  data.footer  = Common.params(params, spintax.unspin(data.footer));
        for (const btn of (data.templateButtons || [])) {
            if (btn.quickReplyButton) btn.quickReplyButton.displayText = Common.params(params, spintax.unspin(btn.quickReplyButton.displayText));
            if (btn.urlButton)        btn.urlButton.displayText        = Common.params(params, spintax.unspin(btn.urlButton.displayText));
            if (btn.callButton)       btn.callButton.displayText       = Common.params(params, spintax.unspin(btn.callButton.displayText));
        }
        return data;
    },

    list_message_template_handler: async function(template_id, params) {
        const template = await Common.db_get("sp_whatsapp_template", [{ id: template_id }, { type: 1 }]);
        if (!template) return false;
        const data = JSON.parse(template.data);
        if (data.text)       data.text       = Common.params(params, spintax.unspin(data.text));
        if (data.footer)     data.footer     = Common.params(params, spintax.unspin(data.footer));
        if (data.title)      data.title      = Common.params(params, spintax.unspin(data.title));
        if (data.buttonText) data.buttonText = Common.params(params, spintax.unspin(data.buttonText));
        for (const section of (data.sections || [])) {
            if (section.title) section.title = Common.params(params, spintax.unspin(section.title));
            for (const row of (section.rows || [])) {
                if (row.title)       row.title       = Common.params(params, spintax.unspin(row.title));
                if (row.description) row.description = Common.params(params, spintax.unspin(row.description));
            }
        }
        return data;
    }
};

// ---------------------------------------------------------------------------
// Endpoint: recebe eventos do fzap (webhook) e processa para chatbot/autoresponder
// ---------------------------------------------------------------------------
WAZIPER.app.post('/webhook/receive/:instance_id', WAZIPER.cors, async (req, res) => {
    res.status(200).json({ status: 'ok' }); // responde imediatamente ao fzap

    const instance_id = req.params.instance_id;
    const payload     = req.body;
    if (!payload) return;

    // fzap envia o tipo do evento no campo "type" (wuzapi-compatible)
    // Suporta também "event" para compatibilidade futura
    const event = payload.type || payload.event;
    if (!event) return;

    // fzap coloca os dados da mensagem em payload.event (objeto), não em payload.data
    // payload.type  = string do evento ("Message", "QR", "Connected"...)
    // payload.event = objeto com os dados do evento (Info, Message, etc.)
    const fzapEventData = (payload.event && typeof payload.event === 'object') ? payload.event : {};
    const data          = payload.data || fzapEventData;

    console.log(BLUE + `[webhook] ${instance_id} ← evento: ${event}` + RESET);

    // Repassa evento para webhook configurado no wapizer
    WAZIPER.webhook(instance_id, { event, data });

    // QR Code — notifica frontend em tempo real via Socket.IO
    if (event === 'QR') {
        const qrCode = data.qrCode || data.qr || data.code;
        if (qrCode) io.emit(instance_id, { qrcode: qrCode });
    }

    // Processa mensagens recebidas (chatbot + autoresponder)
    if (event === 'Message') {
        // Normaliza payload fzap → formato Baileys/wuzapi esperado pelo restante do código
        // fzap:  payload.event.Info.Chat, payload.event.Info.IsFromMe, payload.event.Message, ...
        // nosso: message.key.remoteJid,   message.key.fromMe,          message.message, ...
        const info = fzapEventData.Info || {};
        const message = {
            key: {
                remoteJid:   info.Chat   || '',
                fromMe:      info.IsFromMe === true,
                id:          info.ID      || '',
                participant: info.IsGroup ? (info.Sender || '') : undefined,
            },
            message:   fzapEventData.Message || null,
            pushName:  info.PushName || '',
        };

        // Ignora mensagens enviadas por nós mesmos e status broadcast
        if (message.key.fromMe === true) {
            // Registra no histórico de AR para evitar auto-resposta cruzada quando enviamos
            const chat_id = message.key.remoteJid;
            if (chat_id && !chat_id.includes('@g.us')) {
                const chatid = chat_id.split('@')[0];
                await Common.db_query(
                    `INSERT INTO sp_whatsapp_ar_responses (whatsapp, instance_id, last_response)
                     VALUES ('${chatid}', '${instance_id}', NOW())
                     ON DUPLICATE KEY UPDATE last_response = NOW()`,
                    true
                );
            }
            return;
        }

        if (message.key.remoteJid === "status@broadcast") return;
        if (!message.message) return;

        const chat_id   = message.key.remoteJid;
        const user_type = chat_id.includes('@g.us') ? "group" : "user";

        // Chatbot tem prioridade: se respondeu, o autoresponder não dispara
        const chatbotRespondeu = await WAZIPER.chatbot(instance_id, user_type, message).catch(err => {
            console.error(RED + `[chatbot] Erro: ${err.message}` + RESET);
            return false;
        });

        if (!chatbotRespondeu) {
            WAZIPER.autoresponder(instance_id, user_type, message).catch(err => {
                console.error(RED + `[autoresponder] Erro: ${err.message}` + RESET);
            });
        }
    }

    // Atualiza status da conta quando WhatsApp conecta com sucesso
    if (event === 'Connected' || event === 'PairSuccess') {
        try {
            // Pequeno delay: fzap pode ainda não ter populado o JID no status
            await new Promise(r => setTimeout(r, 1500));

            // Retry para garantir JID disponível (até 3 tentativas)
            let statusData, jid = '';
            for (let attempt = 1; attempt <= 3; attempt++) {
                statusData = await fzapCall('GET', '/session/status', instance_id);
                jid = statusData?.data?.jid || '';
                if (jid) break;
                console.log(YELLOW + `[webhook] ${instance_id} tentativa ${attempt}/3 — aguardando JID...` + RESET);
                await new Promise(r => setTimeout(r, 2000));
            }

            const [session, account] = await Promise.all([
                Common.db_get("sp_whatsapp_sessions", [{ instance_id }]),
                Common.db_get("sp_accounts", [{ token: instance_id }])
            ]);
            const team_id = session?.team_id || account?.team_id;
            if (team_id) {
                const jidFull = jid ? Common.get_phone(jid, 'wid') : ''; // ex: 553...@s.whatsapp.net
                const phone   = jid ? Common.get_phone(jid)         : ''; // ex: 553...

                console.log(CYAN + `[webhook] ${instance_id} — jid=${jid} jidFull=${jidFull} phone=${phone}` + RESET);

                // Busca nome real via POST /user/info (status.data.name é o nome do token, não WhatsApp)
                let pushName = '';
                try {
                    if (jidFull) {
                        const ui = await fzapCall('POST', '/user/info', instance_id, { phone: [jidFull] });
                        console.log(CYAN + `[webhook] user/info: ${JSON.stringify(ui?.data?.users)}` + RESET);
                        if (ui.success && ui.data?.users?.[jidFull]) {
                            const u = ui.data.users[jidFull];
                            pushName = u.pushName || u.fullName || u.businessName || '';
                        }
                    }
                } catch (e) {
                    console.log(YELLOW + `[webhook] user/info falhou: ${e.message}` + RESET);
                }

                // Busca avatar via POST /user/avatar
                let avatarUrl = '';
                try {
                    if (phone) {
                        const av = await fzapCall('POST', '/user/avatar', instance_id, { phone, preview: false });
                        if (av.success && av.data?.url) avatarUrl = av.data.url;
                    }
                } catch (e) { /* opcional */ }

                const wa_info = {
                    id:     jid || instance_id,
                    name:   pushName || instance_id,
                    avatar: avatarUrl
                };
                console.log(GREEN + `[webhook] ${instance_id} conectado como: "${wa_info.name}" (${wa_info.id})` + RESET);

                // Atualiza sp_accounts com status=1, can_post=1
                await Common.db_update("sp_accounts", [
                    { status: 1, can_post: 1, name: wa_info.name, avatar: avatarUrl },
                    { token: instance_id }
                ]);
                // Ativa sp_whatsapp_sessions (UPDATE na row criada pelo PHP)
                await Common.update_status_instance(instance_id, wa_info);
                await WAZIPER.add_account(instance_id, team_id, wa_info, account);
                // Notifica frontend via Socket.IO
                io.emit(instance_id, { connected: true, name: wa_info.name, avatar: wa_info.avatar });
            }
        } catch (err) {
            console.error(YELLOW + `[webhook] Erro ao processar Connected: ${err.message}` + RESET);
        }
    }

    // Logout — marca conta como inativa no DB
    if (event === 'LoggedOut') {
        await Common.db_update("sp_accounts", [{ status: 0 }, { token: instance_id }]);
        console.log(YELLOW + `[webhook] ${instance_id} deslogado do WhatsApp` + RESET);
    }
});

export default WAZIPER;

// ---------------------------------------------------------------------------
// Timers de manutenção
// ---------------------------------------------------------------------------
cron.schedule('*/10 * * * * *', () => { WAZIPER.live_back().catch(() => {}); });
cron.schedule('*/2 * * * * *',  () => { WAZIPER.bulk_messaging().catch(() => {}); });
