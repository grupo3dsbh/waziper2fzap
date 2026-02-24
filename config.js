const config = {
    debug: true,
    database: {
        connectionLimit: 1000,
        host: "localhost",
        user: "USUARIO",
        password: "SENHA",
        database: "BANCO",
        charset: "utf8mb4",
        debug: false,
        waitForConnections: true,
        multipleStatements: true
    },
    cors: {
        origin: '*',
        optionsSuccessStatus: 200
    },
    fzap: {
        // URL base da API fzap (wuzapi)
        base_url: "https://wapi.profluxus.com",
        // Token de administrador definido em WUZAPI_ADMIN_TOKEN no stack
        admin_token: "26a0d92f593e7360cf8a3f1f14fd07bb",
        // URL do servidor waziper (para configurar o webhook no fzap)
        // O fzap irá chamar esta URL quando receber mensagens do WhatsApp
        // Exemplo: "https://seu-dominio.com" ou "http://ip-do-servidor:8754"
        webhook_base_url: "https://api.seuatendimento.dev.br"
    }
};

export default config;
