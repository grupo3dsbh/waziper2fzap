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
    }
};

export default config;
