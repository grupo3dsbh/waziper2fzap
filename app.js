const WAZIPER = require("./waziper/waziper.js");

WAZIPER.app.get('/instance', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        await WAZIPER.get_info(instance_id, res);
    });
});

WAZIPER.app.get('/get_qrcode', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        await WAZIPER.get_qrcode(instance_id, res);
    });
});

WAZIPER.app.get('/get_groups', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        await WAZIPER.get_groups(instance_id, res);
    });
});

/*EDITED G3
WAZIPER.app.get('/get_contacts', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        await WAZIPER.get_contacts(instance_id, res);
    });
});
/*END EDITED G3*/

WAZIPER.app.post('/connect_phone', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id  = req.query.instance_id;
    var phone_number = (req.body.phone_number || req.body.phone || '').replace(/\D/g, '');
    console.log(`[route/connect_phone] recebido — instance_id=${instance_id} phone=${phone_number} token=${access_token ? access_token.slice(0,8)+'...' : 'AUSENTE'}`);
    if (!phone_number) return res.json({ status: 'error', message: 'phone_number is required' });
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        console.log(`[route/connect_phone] instance OK — chamando connect_phone`);
        await WAZIPER.connect_phone(instance_id, phone_number, res);
    });
});

WAZIPER.app.get('/logout', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    WAZIPER.logout(instance_id, res);
});

WAZIPER.app.post('/send_message', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        WAZIPER.send_message(instance_id, access_token, req, res);
    });
});

/*EDITED G3 */
WAZIPER.app.post('/send_location', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        WAZIPER.send_location(instance_id, access_token, req, res);
    });
});

//CONTATO
WAZIPER.app.post('/send_contact', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        WAZIPER.send_contact(instance_id, access_token, req, res);
    });
});

//ENQUETES
WAZIPER.app.post('/send_poll', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        WAZIPER.send_poll(instance_id, access_token, req, res);
    });
});

WAZIPER.app.post('/read_poll', WAZIPER.cors, async (req, res) => {
    var access_token = req.query.access_token;
    var instance_id = req.query.instance_id;
    await WAZIPER.instance(access_token, instance_id, res, async (client) => {
        WAZIPER.read_poll(instance_id, access_token, req, res);
    });
});
/* END EDITED */

WAZIPER.app.get('/', WAZIPER.cors, async (req, res) => {
    return res.json({ status: 'success', message: "Bem Vindo a WapiG3" });
});

WAZIPER.server.listen(8754, () => {
    console.log("WapiG3 Online");
});
