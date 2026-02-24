const fs = require('fs');
const http = require('http');
const qrimg = require('qr-image');
const express = require('express');
const rimraf = require('rimraf');
const moment = require('moment-timezone');
const bodyParser = require('body-parser');
const publicIp = require('ip');
const cors = require('cors');
const spintax = require('spintax');
const Boom = require('@hapi/boom');
const P = require('pino');
const app = express();
const axios = require('axios');
const server = http.createServer(app);
const { Server } = require("socket.io");
const config = require("./../config.js");
const Common = require("./common.js");
const cron = require('node-cron');
const linkPreview = require ('link-preview-js');

const bulks = {};
const chatbots = {};
const limit_messages = {};
const stats_history = {};
const sessions = {};
const new_sessions = {};
const session_dir = __dirname+'/../sessions/';
let verify_next = 0;
let verify_response = false;
let verified = false;
let chatbot_delay = 20000; //20s
let duration = 4000; //4s
//EDITED G3
    // Fora da função auto_send, adicione a variável messageCounter
        let messageCounter = 0;
    //

const os = require('os');
// Definir códigos de escape ANSI para as cores
const RED = '\x1b[91m';
const GREEN = '\x1b[92m';
const YELLOW = '\x1b[93m';
const BLUE = '\x1b[94m';
const MAGENTA = '\x1b[95m';
const CYAN = '\x1b[96m';
const WHITE = '\x1b[97m';
const RESET = '\x1b[0m';

const crypto = require('crypto');

//const { webcrypto } = require('crypto');
//globalThis.crypto = webcrypto;

// Exibir uma mensagem em vermelho
console.log(RED + 'SEJA BEM VINDO!' + RESET);
// Exibir uma mensagem em azul

const io = new Server(server, {
    cors: {
        origin: '*',
    }
});

app.use(bodyParser.urlencoded({
	extended: true,
	limit: '50mb'
}));

const {
	default: makeWASocket,
	BufferJSON,
	useMultiFileAuthState,
	DisconnectReason,
	MessageType,
	MessageOptions,
	Mimetype
//} = require('@Whiskeysockets/baileys')
} = require('@adiwajshing/baileys')

const WAZIPER = {
	io: io,
	app: app,
	server: server,
	cors: cors(config.cors),

	makeWASocket: async function(instance_id){
		const { state, saveCreds } = await useMultiFileAuthState('sessions/'+instance_id);

		const WA = makeWASocket({ 
			auth: state,
			printQRInTerminal: false,
			logger: P({ level: 'silent' }),
			receivedPendingNotifications: true,
			defaultQueryTimeoutMs: undefined,
			browser: [instance_id,'Chrome','96.0.4664.110'],
			patchMessageBeforeSending: (message) => {
	            const requiresPatch = !!(
	                message.buttonsMessage ||
	                // || message.templateMessage
	                message.listMessage
	            );
	            if (requiresPatch) {
	                message = {
	                    viewOnceMessage: {
	                        message: {
	                            messageContextInfo: {
	                                deviceListMetadataVersion: 2,
	                                deviceListMetadata: {},
	                            },
	                            ...message,
	                        },
	                    },
	                };
	            }
	            return message;
	        },
		});
		
		//console.log("evento: ", WA.ev.on);

		await WA.ev.on('connection.update', async ( { connection, lastDisconnect, isNewLogin, qr, receivedPendingNotifications } ) => {

			/*
			* Get QR COde
			*/
			if(qr != undefined){
				WA.qrcode = qr;
				if(new_sessions[instance_id] == undefined)
					new_sessions[instance_id] = new Date().getTime()/1000 + 300;
			}

			/*
			* Login successful
			*/
			if(isNewLogin){

				/*
				* Reload session after login successful
				*/
				await WAZIPER.makeWASocket(instance_id);

			}

			if(lastDisconnect != undefined && lastDisconnect.error != undefined){
		    	var statusCode = lastDisconnect.error.output.statusCode;
		    	if( DisconnectReason.restartRequired == statusCode || DisconnectReason.connectionClosed == statusCode ){
	                await WAZIPER.makeWASocket(instance_id);
		    	}
	    	}

			/*
			* Connection status
			*/
			switch(connection) {
			  	case "close":
			    	/*
			    	* 401 Unauthorized
			    	*/
			    	if(lastDisconnect.error != undefined){
				    	var statusCode = lastDisconnect.error.output.statusCode;
				    	if( DisconnectReason.loggedOut == statusCode || 0 == statusCode){
				    		var SESSION_PATH = session_dir + instance_id;
							if (fs.existsSync(SESSION_PATH)) {
		                        rimraf.sync(SESSION_PATH);
		                        delete sessions[instance_id];
    							delete chatbots[ instance_id ];
    							delete bulks[ instance_id ];
		                    }

		                    await WAZIPER.session(instance_id);
				    	}
			    	}
			    	break;

			    case "open":
			    	// Reload WASocket
			    	if(WA.user.name == undefined){
			    		await Common.sleep(3000);
			    		await WAZIPER.makeWASocket(instance_id);
			    		break;
			    	}

			    	sessions[instance_id] = WA;

					// Remove QR code
			    	if(sessions[instance_id].qrcode != undefined){
			    		delete sessions[instance_id].qrcode; 
			    		delete new_sessions[instance_id];
			    	}

			    	// Add account
			    	var session = await Common.db_get("sp_whatsapp_sessions", [ { instance_id: instance_id }, { status: 0 } ]);
			    	if(session){
				    	// Get avatar 
				    	WA.user.avatar = await WAZIPER.get_avatar(WA);

			    		var account = await Common.db_get("sp_accounts", [ { token: instance_id } ]);
			    		if(!account){
			    			account = await Common.db_get("sp_accounts", [ { pid: Common.get_phone(WA.user.id, "wid")}, {team_id: session.team_id } ]);
			    		}

			    		await Common.update_status_instance(instance_id, WA.user);
			    		await WAZIPER.add_account(instance_id, session.team_id, WA.user, account);
			    	}

			    	break;

			  	default:
			    	// code block
			} 
		});

		await WA.ev.on('messages.upsert', async(messages) => {
		    //console.log('Received messages:', messages);
		    
			WAZIPER.webhook(instance_id, { event: "messages.upsert", data: messages });
			if(messages.messages != undefined){
				messages = messages.messages;

				if(messages.length > 0){
					for (var i = 0; i < messages.length; i++) {
						var message = messages[i];
						var chat_id = message.key.remoteJid;
						
						// Adicione a chamada para inserir um novo registro no banco de dados
                        if (message.key.fromMe === true) {
                            // Verificar se chatid contém '@g.us'
                            if (!chat_id.includes('@g.us')) {
                                var chatid = chat_id.split('@')[0];
                                var messageText = message.message?.extendedTextMessage?.text || message.message?.conversation || '';

                                //console.log('Message sent:', messageText);
    
                                // Tente buscar o registro no banco de dados
                                var existingRecord = await Common.db_fetch("sp_whatsapp_ar_responses", [{ whatsapp: chatid }, { instance_id: instance_id }]);
                                 // Verifique se o registro existe
                                if (existingRecord) {
                                    // Exclua o registro existente
                                    await Common.db_delete("sp_whatsapp_ar_responses", [{ whatsapp: chatid }, { instance_id: instance_id }]);
                                    console.log('Registro existente excluído com sucesso!');
                                }

                                // Crie um novo registro
                                var newRecord = {
                                    whatsapp: chatid,
                                    instance_id: instance_id,
                                    last_response: new Date(),
                                    // Adicione outras colunas e valores necessários
                                };

                                // Insira o novo registro no banco de dados
                                await Common.db_insert("sp_whatsapp_ar_responses", newRecord);
                                console.log('Novo registro inserido com sucesso!');
                            } 
                        }

						if(message.key.fromMe === false && message.key.remoteJid != "status@broadcast" && message.message != undefined){
							var user_type = "user";
							
	                		if(chat_id.indexOf("s.whatsapp.net") === -1){
	                			user_type = "group";
	                		}

							WAZIPER.chatbot(instance_id, user_type, message);
							await Common.sleep(1000);
							WAZIPER.autoresponder(instance_id, user_type, message);
						}

						//Add Groups for Export participants
						if(message.message != undefined){
							if( chat_id.includes("@g.us") ){
	                			if(sessions[instance_id].groups == undefined){
	                				sessions[instance_id].groups = [];
	                			}

                				var newGroup = true;
                				sessions[instance_id].groups.forEach( async (group) => {
                					if(group.id == chat_id){
                						newGroup = false;
                					}
                				});

                				if(newGroup){
                					await WA.groupMetadata (chat_id).then( async (group) => {
										sessions[instance_id].groups.push( { id: group.id, name: group.subject, size: group.size, desc: group.desc, participants: group.participants });
									} ).catch( (err) => {});
                				}
	                		}
						}


					}
				}
			}
		});

		await WA.ev.on('contacts.update', async(contacts) => {
			WAZIPER.webhook(instance_id, { event: "contacts.update", data:contacts  });
		});

		await WA.ev.on('contacts.upsert', async(contacts) => {
			WAZIPER.webhook(instance_id, { event: "contacts.upsert", data:contacts  });
		});

		await WA.ev.on('messages.update', async(messages) => {
			WAZIPER.webhook(instance_id, { event: "messages.update", data:messages  });
		});
		
		await WA.ev.on('call', async (call) => {
			WAZIPER.webhook(instance_id, { event: "call", data: call });
		});

		await WA.ev.on('groups.update', async(group) => {
			WAZIPER.webhook(instance_id, { event: "groups.update", data:group  });
		});

		await WA.ev.on('creds.update', saveCreds);

		return WA;
	},

	session: async function(instance_id){
		if( sessions[instance_id] == undefined ){
			sessions[instance_id] = await WAZIPER.makeWASocket(instance_id);
		}

		return sessions[instance_id];
	},

	instance: async function(access_token, instance_id, res, callback){
		var time_now = Math.floor(new Date().getTime() / 1000);

		/*
		if(verify_next < time_now){
			var options = await Common.db_query(`SELECT value FROM sp_options WHERE name = 'base_url'`);
			if(!options){
				if(res){
	            	return res.json({ status: 'error', message: "Whoop! The license provided is not valid, please contact the author for assistance" });
	            }else{
	            	return callback(false);
	            }
			}

			var base_url = options.value
			var license = await Common.db_query(`SELECT * FROM sp_purchases WHERE item_id = '32290038' OR item_id = '32399061'`);
			if(!license){
				if(res){
	            	return res.json({ status: 'error', message: "Whoop!!The license provided is not valid, please contact the author for assistance" });
	            }else{
	            	return callback(false);
	            }
			}

			var ip = await publicIp.address();
			var check_license = await new Promise( async (resolve, reject)=>{
				axios.get('https://stackposts.com/api/check?purchase_code='+license.purchase_code+'&website='+base_url+'&ip='+ip)
			    .then((response) => {
			        if (response.status === 200) {
			        	verify_response = response.data;
			        	verified = false;
			            return resolve(response.data);
			        }else{
			        	verified = true;
			        	return resolve(false);
			        }
			    })
			    .catch((err) => {
			    	verified = true;
			        return resolve(false);
			    });
		    });
		}

		if(verify_next < time_now){
			verify_next = time_now + 600;
		}

		if (verify_response) {
			if(verify_response.status == "error"){
				if(res){
		        	return res.json({ status: 'error', message: verify_response.message });
		        }else{
		        	return callback(false);
		        }
			}
		}

		if (!verified) {
			if(res){
	        	return res.json({ status: 'error', message: "Whoop!!! The license provided is not valid, please contact the author for assistance" });
	        }else{
	        	return callback(false);
	        }
		} */

		if(instance_id == undefined && res != undefined){
			if(res){
	        	return res.json({ status: 'error', message: "The Instance ID must be provided for the process to be completed" });
	        }else{
	        	return callback(false);
	        }
		}

		var team = await Common.db_get("sp_team", [{ids: access_token}]);

        if(!team){
        	return res.json({ status: 'error', message: "The authentication process has failed" });
        }

        var session = await Common.db_get("sp_whatsapp_sessions", [ { instance_id: instance_id }, { team_id: team.id } ]);

        if(!session){
        	if(res){
	        	return res.json({ status: 'error', message: "The Instance ID provided has been invalidated" });
	        }else{
	        	return callback(false);
	        }
        }

		sessions[instance_id] = await WAZIPER.session(instance_id);
		return callback(sessions[instance_id]);
	},

	webhook: async function(instance_id, data){
		var tb_webhook = await Common.db_query("SHOW TABLES LIKE 'sp_whatsapp_webhook'");
		if(tb_webhook){
			var webhook = await Common.db_query("SELECT * FROM sp_whatsapp_webhook WHERE status = 1 AND instance_id = '"+instance_id+"'");
			if(webhook){
                axios.post(webhook.webhook_url, { instance_id: instance_id, data: data }).then((res) => {}).catch((err) => {});
			}
		}
	},

	get_qrcode: async function(instance_id, res){
		var client = sessions[instance_id];
		if(client == undefined){
			return res.json({ status: 'error', message: "The WhatsApp session could not be found in the system" });
		}

		if(client.qrcode != undefined && !client.qrcode){
			return res.json({ status: 'error', message: "It seems that you have logged in successfully" });
		}

		//Check QR code exist
		for( var i = 0; i < 10; i++) { 
			if( client.qrcode == undefined ){
		    	await Common.sleep(1000);
			}
		}

		if(client.qrcode == undefined || client.qrcode == false){
			return res.json({ status: 'error', message: "The system cannot generate a WhatsApp QR code" });
		}

		var code = qrimg.imageSync(client.qrcode, { type: 'png' });
    	return res.json({ status: 'success', message: 'Success', base64: 'data:image/png;base64,'+code.toString('base64') });
	},

	get_info: async function(instance_id, res){
		var client = sessions[instance_id];
		if(client != undefined && client.user != undefined){
			if(client.user.avatar == undefined) await Common.sleep(1500);
			client.user.avatar = await WAZIPER.get_avatar( client );
			//client.contacts = await WAZIPER.get_contacts(client);
			return res.json({ status: 'success', message: "Success", data: client.user });
		}else{
			return res.json({ status: 'error', message: "Error", relogin: true });
		}
	},
	
	/*EDITED G3
	//NOVA FUNÇÃO - CODE BY ~FAMILIA@WAZIPER GROUP
	get_contacts: async function(instance_id, res) {
      var client = sessions[instance_id];
        if (client != undefined && client.user != undefined) {
            if (client.user.avatar == undefined) await Common.sleep(1500);
            client.user.avatar = await WAZIPER.get_avatar(client);
            client.contacts = await WAZIPER.get_contacts(client);
            return res.json({ status: 'success', message: "Success", data: client });
        } else {
            return res.json({ status: 'error', message: "Error", relogin: true });
        }
    },
	/* END EDITED G3*/

	get_avatar: async function(client){
		try{
			const ppUrl = await client.profilePictureUrl( client.user.id );
			return ppUrl;
		}catch(e){
			return Common.get_avatar(client.user.name);
		}
	},

	logout: async function(instance_id, res){
		Common.db_delete("sp_whatsapp_sessions", [ { instance_id: instance_id } ]);
		Common.db_update("sp_accounts", [ { status: 0 }, { token: instance_id } ]);

		if(sessions[ instance_id ]){
			if (typeof sessions[ instance_id ].ws._events.close === "function") { 
				sessions[ instance_id ].ws._events.close();
			}

        	var SESSION_PATH = session_dir + instance_id;
			if (fs.existsSync(SESSION_PATH)) {
                rimraf.sync(SESSION_PATH);
            }
    		delete sessions[ instance_id ];
    		delete chatbots[ instance_id ];
    		delete bulks[ instance_id ];
	    	
	    	if(res != undefined){
	    		return res.json({ status: 'success', message: 'Success' });
	    	}
    	}else{
    		if(res != undefined){
	    		return res.json({ status: 'error', message: 'This account seems to have logged out before.' });
	    	}
    	}
	},

	get_groups: async function(instance_id, res){
		var client = sessions[instance_id];
		if( client != undefined && client.groups != undefined ){
			res.json({ status: 'success', message: 'Success', data: client.groups });
		}else{
			res.json({ status: 'success', message: 'Success', data: [] });
		}
	},
	
	//EDITED G3 - Verificar e Registrar envio da mensagem
	registrarEnvioWhatsApp: async function(whatsapp, instance_id, team_id, conteudo_mensagem, status_envio, tipo_envio) {
	    
	    console.log("Registrando envio no banco de dados...");
        console.log(`Parâmetros - whatsapp: ${whatsapp}, instance_id: ${instance_id}, team_id: ${team_id}, conteudo_mensagem: ${conteudo_mensagem}, status_envio: ${status_envio}, tipo_envio: ${tipo_envio}`);
        
        //const hora_mensagem = new Date().toISOString().slice(0, 19).replace('T', ' ');
        
        const moment = require('moment-timezone');
        const hora_mensagem = moment().tz("America/Sao_Paulo").format('YYYY-MM-DD HH:mm:ss');

        const query = `INSERT INTO sp_whatsapp_envios (whatsapp, instance_id, team_id, conteudo_mensagem, hora_mensagem, status_envio, tipo_envio) VALUES ('${whatsapp}', '${instance_id}', '${team_id}', '${conteudo_mensagem}', '${hora_mensagem}', '${status_envio}', '${tipo_envio}')`;
       // await Common.db_query(query, true); // Assumindo que `Common.db_query` é a função que executa o SQL
        
        try {
            const result = await Common.db_query(query, true);
            console.log("Mensagem registrada com sucesso no banco de dados.", result);
        } catch (error) {
            console.error("Erro ao tentar registrar a mensagem no banco de dados:", error);
        }
        
    },

    verificaMensagemEnviada: async function(whatsapp, instance_id, team_id, conteudo_mensagem) {
        
        console.log("Verificando se a mensagem já foi enviada...");
        console.log(`Parâmetros - whatsapp: ${whatsapp}, instance_id: ${instance_id}, team_id: ${team_id}, conteudo_mensagem: ${conteudo_mensagem}`);

        const query = `SELECT COUNT(*) AS count FROM sp_whatsapp_envios WHERE whatsapp = '${whatsapp}' AND instance_id = '${instance_id}' AND team_id = '${team_id}' AND conteudo_mensagem = '${conteudo_mensagem}' AND status_envio = '1' AND hora_mensagem > NOW() - INTERVAL 10 MINUTE`;
        const result = await Common.db_query(query, false); // Supondo que `Common.db_query` executa sua consulta SQL e retorna um array de resultados
        
                console.log(`Resultado da verificação: ${result[0].count} mensagens encontradas`);
                
                console.log("query:", query);

        return result[0].count > 0; // Retorna true se a mensagem já foi enviada nos últimos 10 minutos, caso contrário, retorna false
        

    },
    
    ajustaNumero(chat_id) {
        // Remove espaços em branco no início e no final
        let nmr = chat_id.trim();
        
        // Remove o zero inicial, se presente, mesmo se o número começar com '55'
        if (nmr.startsWith('0')) {
            nmr = nmr.substring(1);
        }
    
        // Se o número começa com '55', remove o zero seguinte
        if (nmr.startsWith('55') && nmr.length > 2 && nmr[2] === '0') {
            nmr = nmr.substring(0, 2) + nmr.substring(3);
        }
        
        // Se o número já contém 'g.us', retorna-o diretamente sem alterações
        if (nmr.includes('@g.us')) {
            return nmr;
        }
    
        // Remove o sinal de mais (+), se presente
        nmr = nmr.startsWith('+') ? nmr.substring(1) : nmr;
        
        // Adiciona automaticamente o prefixo '55' para números de celular com menos de 11 dígitos
        if (nmr.length < 12 && !nmr.startsWith('55') && ['9', '8', '7', '6'].includes(nmr[nmr.length - 8])) {
            nmr = '55' + nmr;
        }
    
        // Verifica se é um número de grupo (17 dígitos ou mais) e não contém 'g.us'
        if (nmr.length > 17 && !nmr.includes('@')) {
            return nmr + '@g.us';
        }
    
        // Extrai os componentes do número para números que não são de grupo
        const nmrDDI = nmr.substring(0, 2);
        const nmrDDD = nmr.substring(2, 4);
        const nmrSemDDIeDDD = nmr.substring(4); // Número sem DDI e DDD
    
        let nmrfinal = nmr;
    
        // Define se o número é potencialmente um celular baseado no primeiro dígito após DDI e DDD
        const ehCelular = ['9', '8', '7', '6'].includes(nmrSemDDIeDDD.substring(0, 1));
    
        // Verifica se o número é do Brasil (DDI 55) e ajusta conforme necessário
        if (nmrDDI === '55') {
            if (parseInt(nmrDDD) <= 30 && ehCelular && nmrSemDDIeDDD.length === 8) {
                nmrfinal = nmrDDI + nmrDDD + "9" + nmrSemDDIeDDD;
            } else if (parseInt(nmrDDD) > 30 && ehCelular && nmrSemDDIeDDD.length === 9) {
                nmrfinal = nmrDDI + nmrDDD + nmrSemDDIeDDD.substring(1);
            }
            // Para números brasileiros que não são de grupo, adiciona '@c.us'
            //nmrfinal += '@c.us';
        } else if (!nmr.includes('@')) {
            // Para números internacionais que não são de grupo, adiciona '@c.us'
            nmrfinal;// += '@c.us';
        }
    
        return nmrfinal;
    },

    //END EDITED

	bulk_messaging: async function(){
		const self = this;
		const d = new Date();
		var time_now = d.getTime()/1000
		var items = await Common.db_query(`SELECT * FROM sp_whatsapp_schedules WHERE status = 1 AND run <= '`+time_now+`' AND accounts != '' AND time_post <= '`+time_now+`' ORDER BY time_post ASC LIMIT 5`, false);
		
		if(items){
			items.forEach( async (item) => {
                await Common.db_update("sp_whatsapp_schedules", [{ run: time_now + 30 }, { id: item.id }]);
    		});

    		items.forEach( async (item) => {
				//Get current hour
    			var current_hour = -1;
    			if(item.timezone != ""){
    				var user_diff = Common.getTZDiff(item.timezone);
    				current_hour = d.getHours() + (user_diff * -1);
    				if(current_hour > 23){
    					current_hour = current_hour - 23;
    				}
    			}

    			//Process next hour
    			if(item.schedule_time != "" && current_hour != -1){
    				var schedule_time = JSON.parse(item.schedule_time);
    				if( !schedule_time.includes( current_hour.toString() ) ){
    					var next_time = -1;
    					var date = new Date( ( d.getTime()/1000 + ( (user_diff * -1) * 60 * 60 ) ) * 1000 );
    					for (var i = 1; i <= 24; i++) {
							date = Common.roundMinutes(date);
							var hour = date.getHours();
    						if( schedule_time.includes( hour.toString() ) ){
    							var minutes = new Date(time_now*1000).getMinutes();
    							var max_minute_rand = (minutes>10)?10:minutes;
								var random_add_minutes = Common.randomIntFromInterval(0,max_minute_rand);
    							next_time = d.getTime()/1000 + i*60*60 - ((minutes - random_add_minutes) * 60);
    							break;
    						}
    					}

    					if(next_time == -1){
    						await Common.db_update("sp_whatsapp_schedules", [{ status: 2 }, { id: item.id }]);
    					}else{
    						await Common.db_update("sp_whatsapp_schedules", [{ time_post: next_time }, { id: item.id }]);
    					}
    					return false;
    				}
    			}

    			if(item.result === null || item.result === ''){
					var query_phone_data='';
				}else{
					result = JSON.parse(item.result);
					var query_phone_data=[];
					for (var i = 0; i < result.length; i++) {
						query_phone_data.push(result[i].phone_number.toString());
					}
				}

				var params = false;
				var phone_number_item = await Common.get_phone_number(item.contact_id, query_phone_data);
				if(!phone_number_item){
					//Complete
					Common.db_update("sp_whatsapp_schedules", [{ status: 2, run: 0 }, { id: item.id }]);
					return false;
				}else{
					phone_number = phone_number_item.phone;
					params = phone_number_item.params;
				}
				
				//EDITED G3
				var cleanedWaName = '';
				var userPhone = '';
				var msgConversa = '';
				var msgDeEnvio = item.caption;
				
				console.log ("msgDeEnvio:", msgDeEnvio);
				
				var idConversa = '';
				var participanteGrupo = '';
				//nextAction, inputName e saveData
                var saveData = '';
                var inputName = '';
                var nextAction = '';
				
				//Random account
				var instance_id = false;
				var accounts = JSON.parse(item.accounts);
				var next_account = item.next_account;
				if( next_account == null || next_account == "" || next_account >= accounts.length) next_account = 0;

				var check_account = await Common.get_accounts(accounts.join(","));
				if(check_account && check_account.count == 0){
					Common.db_update("sp_whatsapp_schedules", [{ status: 0 }, { id: item.id }]);
				}

				await accounts.forEach( async (account, index) => {
					if(!instance_id && index == next_account){
						var account_item = await Common.db_get("sp_accounts", [{id: account}, {status: 1}]);
						if(account_item) instance_id = account_item.token;
						if(phone_number.indexOf("g.us") !== -1){
                			var chat_id = phone_number;
                		}else {
                            // Remove espaços em branco no início e no final
                            phone_number = phone_number.trim();
                        
                            // Se o número for igual ou maior que 17, considera-se um número de grupo e adiciona '@g.us'
                            // Senão, considera-se um número individual e adiciona '@c.us'
                            var chat_id;
                            if (phone_number.length > 17) {
                                chat_id = phone_number + "@g.us";
                            } else {
                                // Não é necessário fazer parseInt aqui, apenas adicione diretamente '@c.us'
                                chat_id = phone_number + "@c.us";
                            }
                        }

						if( sessions[instance_id] == undefined ){
							Common.db_update("sp_whatsapp_schedules", [{ next_account: next_account + 1, run: 1 }, { id: item.id }]);
						}else{
						    /* função auto_send correta:
						    (recebe) auto_send: async function(instance_id, chat_id, phone_number, type, item, params, msg_info, callback)
                            
                            (envia) WAZIPER.auto_send(instance_id, chat_id, chat_id, "chatbot", item, false, msg_info, function(result){});
						    */
						    
						    //EDITED G3 - Verificar Mensagem
						    // Verifica se a mensagem já foi enviada para evitar reenvio
                            const mensagemJaEnviada = await self.verificaMensagemEnviada(phone_number, instance_id, item.team_id, msgConversa);
                
                            if (!mensagemJaEnviada) {
						    // END EDITED
						    
						    // Agrupa os parâmetros em um objeto
                            const msg_info = {
                                cleanedWaName: cleanedWaName,
                                userPhone: userPhone,
                                idConversa: idConversa,
                                msgConversa: msgConversa,
                                participanteGrupo: participanteGrupo,
                                nextAction: nextAction,
                                inputName: inputName,
                                saveData: saveData
                            };
						    
						    console.log("Item Bulk:", item);
						    
							await WAZIPER.auto_send(instance_id, chat_id, chat_id, "bulk", item, params, false, async function(result){
								if(result.stats){
									var status = result.status;
									var new_stats = { phone_number: phone_number, status: status };
									if( item.result == null || item.result == "" ){
										var result_list = [new_stats];
									}else{
										var result_list = JSON.parse(item.result);
										result_list.push(new_stats);
									}

									if(bulks[item.id] == undefined){
										bulks[item.id] = {};
									}

									if(
										bulks[item.id].bulk_sent == undefined &&
										bulks[item.id].bulk_failed == undefined
									){
										bulks[item.id].bulk_sent = item.sent;
										bulks[item.id].bulk_failed = item.failed;
									}
									
									bulks[item.id].bulk_sent += (status?1:0);
									bulks[item.id].bulk_failed += (!status?1:0);

									//Total sent & failed
									var total_sent = bulks[item.id].bulk_sent;
									var total_failed = bulks[item.id].bulk_failed;
									var total_complete = total_sent + total_failed;

									//Next time post
							        var now = Math.floor(new Date().getTime() / 1000);
							        var random_time = Math.floor(Math.random() *  item.max_delay ) + item.min_delay;
							        var next_time = item.time_post + random_time;
									if(next_time < now ){
										next_time = now + random_time;
									}

									var data = { 
										result: JSON.stringify( result_list ), 
										sent: total_sent,
										failed: total_failed,
										time_post: next_time,
										next_account: next_account + 1,
										run: 0,
									};
                                    //EDITED G3 - Registrar envio
                                    await self.registrarEnvioWhatsApp(phone_number, instance_id, item.team_id, msgDeEnvio, '1', 'bulk');
                                    //END EDITED 
									await Common.db_update("sp_whatsapp_schedules", [data, { id: item.id }]);
								}
							});
							//EDITED G3
    						} else {
                                console.log("Mensagem já enviada para o número nos últimos 5 minutos, pulando...");
                            }
							//END EDITED
						}
					}
				});
				
    		});
		}
	},

	/*autoresponder: async function(instance_id, user_type, message){
		var chat_id = message.key.remoteJid;
		var now = new Date().getTime()/1000;
		var item = await Common.db_get("sp_whatsapp_autoresponder", [ { instance_id: instance_id }, { status: 1 } ]);
		
		item.delay = 1; // TESTE APENAS -  Ajuste o valor para o número desejado em minutos

		
		if(!item){
			return false;
		}

		//Accept sent to all/group/user
		switch(item.send_to){
		  	case 2:
		    	if(user_type == "group") return false;
		    	break;
		  	case 3:
		    	if(user_type == "user") return false;
		    	break;
		}

		//Delay response
		if(sessions[instance_id].lastMsg == undefined){
    		sessions[instance_id].lastMsg = {};
    	}

    	var check_autoresponder = sessions[instance_id].lastMsg[chat_id];
    	sessions[instance_id].lastMsg[chat_id] = message.messageTimestamp;
    	
    	//EDITED G3 -  Obter o nome definido pelo contato no WhatsApp
        const waName = message.pushName || '';
        var cleanedWaName = waName.replace(/[&<>"']/g, '');

        // Obter o número de telefone do contato
        var userPhone = message.key.remoteJid.split('@')[0];
        
        // Verificar se há um registro na tabela para este número
        var responseRecord = await Common.db_get("sp_whatsapp_ar_responses", [{ whatsapp: userPhone, instance_id: instance_id }]);
        
        if (responseRecord) {
            // Calcular o tempo decorrido desde a última resposta
            var timeElapsed = now - new Date(responseRecord.last_response).getTime() / 1000;
    
            // Verificar se já passou o tempo definido em delay
            if (timeElapsed < item.delay * 60) {
                return false; // Não enviar a resposta automática se o tempo não tiver passado
            }
        }
        
        var idConversa = message.key.id;
        
        var participanteGrupo = message.key.participant;
        
        //nextAction, inputName e saveData
        var saveData = '';
        var inputName = '';
        var nextAction = '';
        
        //EDITED G3 - Acessar o texto da mensagem
            if (chat_id.length >= 16) {
                var msgConversa = message.message.conversation || '';
            } else {
                var msgConversa = message.message.extendedTextMessage.text || '';
            }
        
        

            //END EDITED

		if(
			check_autoresponder != undefined && 
			check_autoresponder + item.delay*60 >= now 
		){
			return false;
		}

		//Except contacts
    	var except_data = [];
        if(item.except != null){
            var except_data = item.except.split(",");;
        }

        if(except_data.length > 0){
        	for (var i = 0; i < except_data.length; i++) {
        		if( except_data[i] != "" && chat_id.indexOf(except_data[i]) != -1 ){
        			return false;
        		}
        	}
        }
        
        // Agrupa os parâmetros em um objeto
        const msg_info = {
            cleanedWaName: cleanedWaName,
            userPhone: userPhone,
            idConversa: idConversa,
            msgConversa: msgConversa,
            participanteGrupo: participanteGrupo,
            nextAction: nextAction,
            inputName: inputName,
            saveData: saveData
        };
        
        
        
        // Atualizar ou inserir o registro na tabela com o novo timestamp
        var updateData = { last_response: new Date() };
        var whereClause = { whatsapp: userPhone, instance_id: instance_id };
        
        // Adicione esta função dentro do mesmo escopo que autoresponder
        async function updateOrInsert(table, updateData, whereClause) {
            var existingRecord = await Common.db_get(table, [whereClause]);
        
            if (existingRecord) {
                // Se o registro existir, atualizar
                console.log("Registro existente. Atualizando...");
                var res = await Common.db_update(table, updateData, whereClause);
                console.log("Resultado da atualização:", res);
                return res;
            } else {
                // Se o registro não existir, inserir
                console.log("Registro não existente. Inserindo...");
                var res = await Common.db_insert(table, { ...updateData, ...whereClause });
                console.log("Resultado da inserção:", res);
                return res;
            }
        }
        
        // Verificar se o registro já existe
        var existingRecord = await Common.db_get("sp_whatsapp_ar_responses", [whereClause]);
        
        if (existingRecord) {
            // Se o registro existir, atualizar
            await updateOrInsert("sp_whatsapp_ar_responses", updateData, whereClause);
        } else {
            // Se o registro não existir, inserir
            await updateOrInsert("sp_whatsapp_ar_responses", { ...updateData, ...whereClause });
        }
        
        
        
        //ENVIAR SE TIVER PASSADO TEMPO
        console.log("Tempo passou. Enviando a resposta automática...");
        await WAZIPER.auto_send(instance_id, chat_id, chat_id, "autoresponder", item, false, false, function(result){
            // Lógica de envio da resposta automática
        });
        return false;
	},*/
	autoresponder: async function(instance_id, user_type, message){
            var chat_id = message.key.remoteJid;
            var now = new Date().getTime() / 1000;
            var item = await Common.db_get("sp_whatsapp_autoresponder", [{ instance_id: instance_id }, { status: 1 }]);
           // console.log("MENSAGEM RECEBIDA:", message);
            //    console.log("Conteúdo de contextInfo:", message.contextInfo);

        
            //item.delay = 1; // TESTE APENAS - Ajuste o valor para o número desejado em minutos
        
            if (!item) {
                return false;
            }
        
            //Accept sent to all/group/user
            switch (item.send_to) {
                case 2:
                    if (user_type == "group") return false;
                    break;
                case 3:
                    if (user_type == "user") return false;
                    break;
            }
            
            //Except contacts
            var except_data = [];
            if (item.except != null) {
                var except_data = item.except.split(",");;
            }
            
            //console.log("Contatos Excluídos:", except_data);
        
            if (except_data.length > 0) {
                for (var i = 0; i < except_data.length; i++) {
                    if (except_data[i] != "" && chat_id.indexOf(except_data[i]) != -1) {
                        console.log("Contato excluído. Não enviando resposta automática.");
                        return false;
                    }
                }
            }
        
            /* Delay response
            if (sessions[instance_id].lastMsg == undefined) {
                sessions[instance_id].lastMsg = {};
            }
        
            var check_autoresponder = sessions[instance_id].lastMsg[chat_id];
            sessions[instance_id].lastMsg[chat_id] = message.messageTimestamp;
            */
            
            //EDITED G3
            var idConversa = message.key.id;
            var participanteGrupo = message.key.participant;
        
            //nextAction, inputName e saveData
            var saveData = '';
            var inputName = '';
            var nextAction = '';
        
            //EDITED G3 - Acessar o texto da mensagem
            var msgConversa = '';
            if (chat_id.length >= 16) {
                msgConversa = message.message.conversation || '';
            } else {
                msgConversa = message.message.extendedTextMessage.text || '';
            }
            
            //Definir a mensagem recebida
            const msgRecebida = msgConversa;
            //EDITED G3 - Obter o nome definido pelo contato no WhatsApp
            const waName = message.pushName || '';
            var cleanedWaName = waName.replace(/[&<>"']/g, '');
    
            // Substituir as variáveis no corpo da requisição
            item.caption = item.caption.replace('%msg_recebida%', msgRecebida)
                            .replace('%wa_nome%', cleanedWaName)
                            .replace('%wa_numero%', userPhone);
            //console.log("nome wa:", message.pushName);
            //console.log("Dados MSG:", item.caption);
        
            // Obter o número de telefone do contato
            var userPhone = message.key.remoteJid.split('@')[0];
                console.log("DADOS RR:" , userPhone);
            // Verificar se há um registro na tabela para este número
            
            var whereClause = [{ whatsapp: userPhone} , {instance_id: instance_id }];
            //var items = await Common.db_fetch("sp_whatsapp_chatbot", [ { instance_id: instance_id }, { status: 1 }, { run: 1 } ]);
            
            var responseRecord = await Common.db_fetch("sp_whatsapp_ar_responses", [{ whatsapp: userPhone} , {instance_id: instance_id }]);
                //console.log("WHEREClause:", whereClause);
                //console.log("RR:", responseRecord);
        
            // ...

            if (responseRecord) {
                // Calcular o tempo decorrido desde a última resposta
                var timeElapsed = now - new Date(responseRecord[0].last_response).getTime() / 1000;
            
                // Verificar se já passou o tempo definido em delay
                if (timeElapsed < item.delay * 60) {
                    //console.log("Proxima interação:", item.delay);
                    console.log("Tempo ainda não passou. Aguardando...");
                    return false; // Não enviar a resposta automática se o tempo não tiver passado
                }
            } else {
                // Se não existir, crie um novo registro
                var newRecord = {
                    whatsapp: userPhone,
                    instance_id: instance_id,
                    last_response: new Date(),
                    // Adicione outras colunas e valores necessários
                };
            
                // Insira o novo registro no banco de dados
                await Common.db_insert("sp_whatsapp_ar_responses", newRecord);
            
               // console.log("Novo registro criado:", newRecord);
            
                // Debugging: Adicione logs para verificar se a lógica de envio de mensagem está sendo alcançada
                //console.log("Enviando a resposta automática...");
                await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
            
                setTimeout(async function () {
                    await WAZIPER.auto_send(instance_id, chat_id, chat_id, "autoresponder", item, false, false, function(result) {
                        console.log("Resultado do envio 1:", result);
                        // Lógica de envio da resposta automática
                        
                    });
                }, 10000);
                await sessions[instance_id].sendPresenceUpdate('available', chat_id);
            
                console.log("Resposta automática enviada para ", userPhone);
            }
            
            // ...

        
            
        
            //END EDITED
        
            /*if (
                check_autoresponder != undefined &&
                check_autoresponder + item.delay * 60 >= now
            ) {
                console.log("Tempo ainda não passou. Aguardando...");
                return false;
            }*/
            
             // Delay response
            var userPhone = message.key.remoteJid.split('@')[0];
            var whereClause = [{ whatsapp: userPhone} , {instance_id: instance_id }];
            //var items = await Common.db_fetch("sp_whatsapp_chatbot", [ { instance_id: instance_id }, { status: 1 }, { run: 1 } ]);
            
            var responseRecord = await Common.db_fetch("sp_whatsapp_ar_responses", [{ whatsapp: userPhone} , {instance_id: instance_id }]);
                //console.log("WHEREClause 2:", whereClause);
                //console.log("RR 2:", responseRecord);
        
            // ...

            if (responseRecord) {
                // Calcular o tempo decorrido desde a última resposta
                var timeElapsed = now - new Date(responseRecord[0].last_response).getTime() / 1000;
            
                // Verificar se já passou o tempo definido em delay
                if (timeElapsed < item.delay * 60) {
                    //console.log("Proxima interação:", item.delay);
                    console.log("Tempo ainda não passou. Aguardando...");
                    return false; // Não enviar a resposta automática se o tempo não tiver passado
                }
            } else {
                // Se não existir, crie um novo registro
                var newRecord = {
                    whatsapp: userPhone,
                    instance_id: instance_id,
                    last_response: new Date(),
                    // Adicione outras colunas e valores necessários
                };
            
                // Insira o novo registro no banco de dados
                await Common.db_insert("sp_whatsapp_ar_responses", newRecord);
            
               // console.log("Novo registro criado:", newRecord);
            
                // Debugging: Adicione logs para verificar se a lógica de envio de mensagem está sendo alcançada
                //console.log("Enviando a resposta automática...");
            
                await WAZIPER.auto_send(instance_id, chat_id, chat_id, "autoresponder", item, false, false, function(result) {
                    console.log("Resultado do envio:", result);
                    // Lógica de envio da resposta automática
                });
            
                console.log("Resposta automática enviada para ", userPhone);
            }
        
            // Agrupa os parâmetros em um objeto
            const msg_info = {
                cleanedWaName: cleanedWaName,
                userPhone: userPhone,
                idConversa: idConversa,
                msgConversa: msgConversa,
                participanteGrupo: participanteGrupo,
                nextAction: nextAction,
                inputName: inputName,
                saveData: saveData
            };
        
            // Atualizar ou inserir o registro na tabela com o novo timestamp
            var updateData = { last_response: new Date() };
            var whereClause = { whatsapp: userPhone, instance_id: instance_id };
        
            // Adicione esta função dentro do mesmo escopo que autoresponder
            async function updateOrInsert(table, updateData, whereClause) {
                //console.log("whereClause2:", whereClause2);
                var existingRecord = await Common.db_fetch(table, whereClause);
                //console.log("DB_fetch:", existingRecord);
            
                if (existingRecord && existingRecord.length > 0) {
                    // Se o registro existir, atualizar
                    var matchingRecord = existingRecord.find(record => 
                        record.whatsapp === whereClause.whatsapp && record.instance_id === whereClause.instance_id
                    );
            
                    if (matchingRecord) {
                        // Se o registro existir, atualizar
                        console.log("Registro existente. Atualizando...");
            
                        // Obter o ID do registro existente
                        var id = matchingRecord.id;
                        console.log("ID CONTATO:", id);
            
                        var dataUp = {
                            last_response: new Date(),
                            // Adicione outras colunas e valores que deseja atualizar
                        };
            
                        // Atualizar com base no ID
                        var res = await Common.db_update(table, [dataUp, { id: id }]);
                        console.log("Resultado da atualização:", res);
                        return res;
                    } else {
                        console.log("Registro não encontrado para atualização.");
                        // Se o registro não for encontrado, você pode optar por inserir um novo registro aqui
                        // var res = await Common.db_insert(table, { ...updateData, ...whereClause });
                        // console.log("Resultado da inserção:", res);
                        // return res;
                    }
                } else {
                    // Se o registro não existir, inserir
                    console.log("Registro não existente. Inserindo...");
                    var res = await Common.db_insert(table, { ...updateData, ...whereClause });
                    console.log("Resultado da inserção:", res);
                    return res;
                }
            }


        
            // Verificar se o registro já existe
            var existingRecord = await Common.db_fetch("sp_whatsapp_ar_responses", whereClause);
        
            if (existingRecord) {
                // Se o registro existir, atualizar
                await updateOrInsert("sp_whatsapp_ar_responses", updateData, whereClause);
            } else {
                // Se o registro não existir, inserir
                await updateOrInsert("sp_whatsapp_ar_responses", { ...updateData, ...whereClause });
            }
        
            //ENVIAR SE TIVER PASSADO TEMPO
            console.log("Tempo passou. Enviando a resposta automática...");
            await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
            await WAZIPER.auto_send(instance_id, chat_id, chat_id, "autoresponder", item, false, false, function(result) {
                //console.log('Resultado AR 3:', result);
                // Lógica de envio da resposta automática
            });
            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
            return false;
        },


	/*chatbot: async function(instance_id, user_type, message){
		var chat_id = message.key.remoteJid;
		var items = await Common.db_fetch("sp_whatsapp_chatbot", [ { instance_id: instance_id }, { status: 1 }, { run: 1 } ]);
		if(!items){
			return false;
		}

		sent = false;

		items.forEach( async (item, index) => {
			if(sent){
				return false;
			}

    		//EDITED G3 -  Obter o nome definido pelo contato no WhatsApp
            const waName = message.pushName || '';
            var cleanedWaName = waName.replace(/[&<>"']/g, '');
    
            // Obter o número de telefone do contato
            var userPhone = message.key.remoteJid.split('@')[0];
            //var caption = item.caption.replace("[wa_name]", cleanedWaName).replace("[user_phone]", userPhone);
            var participanteGrupo = message.key.participant;
            
            //nextAction, inputName e saveData
            var saveData = item.savedata;
            var inputName = item.inputname;
            var nextAction = item.nextaction;
    		//END EDITED 
    		
    		var caption = item.caption;
            var keywords = item.keywords.split(",");
        	//var content = false;
        	
        	var idConversa = message.key.id;
        	
        	//EDITED G3 - Acessar o texto da mensagem
            if (chat_id.length >= 16) {
                var msgConversa = message.message.conversation || '';
            } else {
                var msgConversa = message.message.extendedTextMessage.text || '';
            }

            //END EDITED
            //END
            
            console.log("Mensagem Recebida:", message);

        	if(message.message.templateButtonReplyMessage != undefined){
        		content = message.message.templateButtonReplyMessage.selectedDisplayText;
        	}else if(message.message.listResponseMessage != undefined){
        		content = message.message.listResponseMessage.title + " " + message.message.listResponseMessage.description;
        	}else if(typeof message.message.extendedTextMessage != "undefined" && message.message.extendedTextMessage != null){
        		content = message.message.extendedTextMessage.text;
        	}else if(typeof message.message.imageMessage != "undefined" && message.message.imageMessage != null){
        		content = message.message.imageMessage.caption;
        	}else if(typeof message.message.videoMessage != "undefined" && message.message.videoMessage != null){
        		content = message.message.videoMessage.caption;
        	}else if(typeof message.message.conversation != "undefined" || message.message.ephemeralMessage.message.extendedTextMessage != "undefined"){ //EDITED G3 - Mensagem temp
        		content = message.message.conversation || message.message.ephemeralMessage.message.extendedTextMessage.text;
        	}

    		var run = true;

    		//Accept sent to all/group/user
			switch(item.send_to){
			  	case 2:
			    	if(user_type == "group") run = false;;
			    	break;
			  	case 3:
			    	if(user_type == "user") run = false;
			    	break;
			}
			
			//EDITED G3
			async function makeAPICall(apiUrl, apiConfig, message) {
                try {
                    const axiosConfig = {
                        method: apiConfig.method,
                        url: apiUrl,
                        data: apiConfig.body,
                        headers: {
                            'Content-Type': apiConfig.body_type
                        }
                    };
            
                    if (apiConfig.header && Array.isArray(apiConfig.header)) {
                        apiConfig.header.forEach(header => {
                            axiosConfig.headers[header.name] = header.value;
                        });
                    }
            
                    // Obter o nome definido pelo contato no WhatsApp
                    const waName = message.pushName || '';
                    const cleanedWaName = waName.replace(/[&<>"']/g, '');
            
                    // Obter o número de telefone do contato
                    const userPhone = message.key.remoteJid.split('@')[0];
            
                    // Substituir as variáveis no corpo da requisição
                    axiosConfig.data = JSON.stringify(axiosConfig.data); // Converter para string
                    axiosConfig.data = axiosConfig.data.replace('[wa_name]', cleanedWaName);
                    axiosConfig.data = axiosConfig.data.replace('[user_phone]', userPhone);
            
                    const response = await axios(axiosConfig);
            
                    // Faça o tratamento da resposta da API de acordo com suas necessidades
                    console.log('Resposta da API:', response.data);
            
                    // Continuar com o código existente do envio automático (WAZIPER.auto_send)
            
                } catch (error) {
                    // Faça o tratamento do erro, se necessário
                    console.error('Erro ao fazer o request para a API:', error);
            
                    // Opcionalmente, você pode lidar com o erro de forma diferente ou parar o envio automático
                }
            }

            if(run){
            	if (item.type_search == 1) {
                    for (var j = 0; j < keywords.length; j++) {
                        if (content) {
                            var msg = content.toLowerCase();
                            if (msg.indexOf(keywords[j]) !== -1) {
                                // Fazer o request para a API com as variáveis
                                if (item.get_api_data == 2 && item.api_url && item.api_config) {
                                    await makeAPICall(item.api_url, JSON.parse(item.api_config), message);
                                }
                                setTimeout(function () {
                                    WAZIPER.auto_send(instance_id, chat_id, "chatbot", item, false, cleanedWaName, userPhone, idConversa, msgConversa, participanteGrupo, nextAction, inputName, saveData, function(result){});
                                }, index * chatbot_delay);
                            }
                        }
                    }
                //EDITED G3
                } else if (item.type_search == 2) {
                    for (var j = 0; j < keywords.length; j++) {
                        if (content) {
                            var msg = content.toLowerCase();
                            if (msg == keywords[j]) {
                                // Fazer o request para a API com as variáveis
                                if (item.get_api_data == 2 && item.api_url && item.api_config) {
                                    await makeAPICall(item.api_url, JSON.parse(item.api_config), message);
                                }
                                setTimeout(function () {
                                    WAZIPER.auto_send(instance_id, chat_id, "chatbot", item, false, cleanedWaName, userPhone, idConversa, msgConversa, participanteGrupo, nextAction, inputName, saveData, function(result){});
                                }, index * chatbot_delay);
                            }
                        }
                    }
                } else if (item.type_search == 3) {
                    for (var j = 0; j < keywords.length; j++) {
                        if (content) {
                            var msg = content.toLowerCase();
                            var keyword = keywords[j].toLowerCase();
                
                            var keywordParts = keyword.split('.'); // Divide a palavra-chave em partes delimitadas por "."
                
                            // Verifica se a mensagem contém todas as partes da palavra-chave
                            var foundAllKeywords = keywordParts.every(function(keywordPart) {
                                return msg.includes(keywordPart.trim());
                            });
                
                            if (foundAllKeywords) {
                                // Fazer o request para a API com as variáveis
                                if (item.get_api_data == 2 && item.api_url && item.api_config) {
                                    await makeAPICall(item.api_url, JSON.parse(item.api_config), message);
                                }
                                setTimeout(function () {
                                    WAZIPER.auto_send(instance_id, chat_id, "chatbot", item, false, cleanedWaName, userPhone, idConversa, msgConversa, participanteGrupo, nextAction, inputName, saveData, function(result){});
                                }, index * chatbot_delay);
                            }
                        }
                    }
                }
                //END EDITED
            }
		});
	},*/
	// Definindo a função chatbot
    chatbot: async function(instance_id, user_type, message){
        
        async function dispararNextaction(instance_id, nextaction){
            var items_next = await Common.db_fetch("sp_whatsapp_chatbot", [ { keywords: nextaction }, { instance_id: instance_id }, { status: 1 }, { run: 1 }]);
            // Certifique-se de que 'items_next' existe antes de continuar
            if(!items_next || items_next.length === 0){return false;}
            // Variável que controla se a mensagem já foi enviada
            var caption_next = items_next[0].caption;
            var nextaction_next = items_next[0].nextaction;
            var keywords_next = items_next[0].keywords;
            console.log("Atraso:", chatbot_delay);
            await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
               setTimeout(function () {
                // Enviando a mensagem automaticamente usando a função WAZIPER.auto_send
                WAZIPER.auto_send(instance_id, chat_id, chat_id,"chatbot", items_next[0], false, msg_info, function(result){});
            }, 10000); // O temporizador é ajustado de acordo com o contador multiplicado pelo atraso definido
            
            // Incrementando o contador após o envio de uma mensagem
            await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
            return nextaction_next;
        }
        
        // chat_id provavelmente se refere ao identificador único do chat
        var chat_id = message.key.remoteJid;
        
        // Buscando itens do banco de dados com as condições especificadas
        var items = await Common.db_fetch("sp_whatsapp_chatbot", [ { instance_id: instance_id }, { status: 1 }, { run: 1 } ]);
        
        // Caso não existam itens, a função é encerrada
        if(!items){
            return false;
        }
        
        // Convertendo a mensagem para uma string JSON
        var msg_info = JSON.stringify(message);
        
        // Variável que controla se a mensagem já foi enviada
        var sent = false;
        function delay(t) {
            return new Promise(resolve => setTimeout(resolve, t));
        }
        // Iterando sobre todos os itens encontrados no banco de dados
        items.forEach(async (item, index) => {
            
            // Se a mensagem já foi enviada, a função é encerrada
            if(sent){
                return false;
            }
    
            // Capturando a legenda do item e dividindo as palavras-chave por vírgulas
            var caption = item.caption;
            var nextaction = item.nextaction;
            var keywords = item.keywords.split(",");
            var content = false;
            
            //console.log("Mensagem Recebida:", message);
    
            // Identificando o tipo de mensagem recebida e definindo o conteúdo
            if(message.message.templateButtonReplyMessage != undefined){
        		content = message.message.templateButtonReplyMessage.selectedDisplayText;
        	}else if(message.message.listResponseMessage != undefined){
        		content = message.message.listResponseMessage.title + " " + message.message.listResponseMessage.description;
        	}else if(typeof message.message.extendedTextMessage != "undefined" && message.message.extendedTextMessage != null){
        		content = message.message.extendedTextMessage.text;
        	}else if(typeof message.message.imageMessage != "undefined" && message.message.imageMessage != null){
        		content = message.message.imageMessage.caption;
        	}else if(typeof message.message.videoMessage != "undefined" && message.message.videoMessage != null){
        		content = message.message.videoMessage.caption;
        	}else if(typeof message.message.conversation != "undefined" || message.message.ephemeralMessage.message.extendedTextMessage != "undefined"){ //EDITED G3 - Mensagem temp
        	    if(typeof message.message.conversation != "undefined"){content = message.message.conversation}
        		else{ content = message.message.ephemeralMessage.message.extendedTextMessage}
        	}
    
            // Definindo run como verdadeiro por padrão
            var run = true;
    
            // Verificando se a mensagem é para ser enviada a um grupo ou usuário individual
            switch(item.send_to){
                case 2:
                    if(user_type == "group") run = false;
                    break;
                case 3:
                    if(user_type == "user") run = false;
                    break;
            }
            
            //EDITED G3 - Função para REST API DATA (usado para enviar requisição caso defina no chatbot)
			async function makeAPICall(apiUrl, apiConfig, message) {
			    
			    if(apiConfig.body_type == 'formData'){
			        var tipo_conteudo = 'application/x-www-form-urlencoded';
			    }else if(apiConfig.body_type == 'json'){
			        var tipo_conteudo = 'application/json';
			    }
			    
                try {
                    const axiosConfig = {
                        method: apiConfig.method,
                        url: apiUrl,
                        data: apiConfig.body,
                        headers: {
                            'Content-Type': tipo_conteudo
                        }
                    };
            
                    if (apiConfig.header && Array.isArray(apiConfig.header)) {
                        apiConfig.header.forEach(header => {
                            axiosConfig.headers[header.name] = header.value;
                        });
                    }
                    
                    //Definir a mensagem recebida
                    const msgRecebida = content;
            
                    // Obter o nome definido pelo contato no WhatsApp
                    const waName = message.pushName || '';
                    const cleanedWaName = waName.replace(/[&<>"']/g, '');
            
                    // Obter o número de telefone do contato
                    const userPhone = message.key.remoteJid.split('@')[0];
            
                    // Substituir as variáveis no corpo da requisição
                    axiosConfig.data = JSON.stringify(axiosConfig.data); // Converter para string
                    axiosConfig.data = axiosConfig.data.replace(/%msg_recebida%/g, msgRecebida.replace(/\n/g, '\\n'));
                    axiosConfig.data = axiosConfig.data.replace(/%wa_nome%/g, cleanedWaName);
                    axiosConfig.data = axiosConfig.data.replace(/%wa_numero%/g, userPhone);
                    
                    // Converter de volta para objeto JSON, se necessário
                    axiosConfig.data = JSON.parse(axiosConfig.data);
            
                    const response = await axios(axiosConfig);
            
                    // Faça o tratamento da resposta da API de acordo com suas necessidades
                    console.log('Resposta da API:', response.data);
            
                    // Continuar com o código existente do envio automático (WAZIPER.auto_send)
            
                } catch (error) {
                    // Faça o tratamento do erro, se necessário
                    console.error('Erro ao fazer o request para a API:', error);
            
                    // Opcionalmente, você pode lidar com o erro de forma diferente ou parar o envio automático
                }
            }
            async function makeAPICallSH(apiUrl, apiConfig, message, userPhone, waName) {
                if (apiConfig.body_type === 'formData') {
                    var tipo_conteudo = 'application/x-www-form-urlencoded';
                } else if (apiConfig.body_type === 'json') {
                    var tipo_conteudo = 'application/json';
                }
            
                try {
                    const axiosConfig = {
                        method: apiConfig.method,
                        url: apiUrl,
                        data: apiConfig.body,
                        headers: {
                            'Content-Type': tipo_conteudo
                        }
                    };
            
                    if (apiConfig.header && Array.isArray(apiConfig.header)) {
                        apiConfig.header.forEach(header => {
                            axiosConfig.headers[header.name] = header.value;
                        });
                    }
            
                    // Definir a mensagem recebida
                    const msgRecebida = message;
            
                    // Obter o nome definido pelo contato no WhatsApp
                    //const waName = message.pushName || '';
                    const cleanedWaName = waName.replace(/[&<>"']/g, '');
            
                    // Substituir as variáveis no corpo da requisição
                    axiosConfig.data = JSON.stringify(axiosConfig.data); // Converter para string
                    axiosConfig.data = axiosConfig.data.replace(/%msg_recebida%/g, msgRecebida.replace(/\n/g, '\\n'));
                    axiosConfig.data = axiosConfig.data.replace(/%wa_nome%/g, '*'+cleanedWaName+'*');
                    axiosConfig.data = axiosConfig.data.replace(/%wa_numero%/g, userPhone);
            
                    // Converter de volta para objeto JSON, se necessário
                    axiosConfig.data = JSON.parse(axiosConfig.data);
            
                    const response = await axios(axiosConfig);
            
                    // Faça o tratamento da resposta da API de acordo com suas necessidades
                    console.log('Resposta da API:', response.data);
            
                    // Continuar com o código existente do envio automático (WAZIPER.auto_send)
            
                } catch (error) {
                    // Faça o tratamento do erro, se necessário
                    console.error('Erro ao fazer o request para a API:', error);
            
                    // Opcionalmente, você pode lidar com o erro de forma diferente ou parar o envio automático
                }
            }
            //EDITED G3 END - FIM DA FUNÇÃO REST API DATA
            async function processarMensagem(keywords, content, instance_id, message, item, count_chatbot, chatbot_delay, sessions) {
    // Ordenar keywords por número de palavras (da maior para a menor)
    const keywordSets = keywords.sort((a, b) => b.split(" ").length - a.split(" ").length);

    // Imprimir a lista de palavras-chave ordenada
    console.log(keywordSets);

    const lowerContent = content.toLowerCase();
    let encontrado = false;

    for (const keywordSet of keywordSets) {
        const setArray = keywordSet.split(" ");
        encontrado = setArray.some(keyword => lowerContent.includes(keyword.toLowerCase()));

        if (encontrado) {
            // Se encontrado, o código dentro do loop será executado
            let msg = content.toLowerCase();

            if (msg) {
                for (const keyword of setArray) {
                    if (msg.includes(keyword.toLowerCase())) {
                        msg = msg.replace(keyword, "").trim();
                    }
                }


                try {
                    const numeroEmp = await Common.db_query("SELECT data FROM sp_whatsapp_sessions WHERE status = 1 AND instance_id = '" + instance_id + "'");
                    const dataObj = JSON.parse(numeroEmp.data);
                    const numeroEmpresa = dataObj.id.split(":")[0];
                    
                    console.log("MSG API:", msg);

                    const response = await axios.get(`https://seuhorario.com/api_automacao/servicos_wpp_nome.php?whatsapp_empresa=${numeroEmpresa}&nome_servico=${msg}`);
                    const services = response.data;

                    const userPhone = message.key.remoteJid.split('@')[0];
                    const waName = message.pushName || '';

                    if (services.length === 1) {
                        const serviceId = services[0].id;
                        await makeAPICallSH(item.api_url, JSON.parse(item.api_config), `agendar id ${serviceId}`, userPhone, waName);
                        await handleAutomaticMessage(sessions, instance_id, chat_id, item, count_chatbot, chatbot_delay);
                    } else if (services.length > 1) {
                        const serviceListMessage = buildServiceListMessage(services);
                        await makeAPICallSH(item.api_url, JSON.parse(item.api_config), serviceListMessage, userPhone, waName);
                        await handleAutomaticMessage(sessions, instance_id, chat_id, item, count_chatbot, chatbot_delay);
                    } else {
                        console.log("Nenhum serviço encontrado. Lidar com isso conforme necessário.");
                    }
                } catch (error) {
                    console.error("Erro na chamada à API:", error);
                    // Trate o erro conforme necessário
                    return false;
                }
            }
            break; // Sair do loop se encontrado
        
        }
    }
}


async function handleAutomaticMessage(sessions, instance_id, chat_id, item, count_chatbot, chatbot_delay) {
    await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
    console.log("Atraso escrevendo 1:", chatbot_delay);
    setTimeout(function () {
        WAZIPER.auto_send(instance_id, chat_id, chat_id, "chatbot", item, false, msg_info, function (result) { });
    }, count_chatbot * chatbot_delay);
    await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
    count_chatbot++;
}

function buildServiceListMessage(services) {
    // Verificar se services é uma matriz
    console.log("SVCS:", services);
    if (!Array.isArray(services)) {
        // Lógica de tratamento de erro ou mensagem padrão, se necessário
        console.error('Erro: services não é uma matriz');
        return 'Desculpe, ocorreu um erro ao processar os serviços.';
    }
    return "Olá %wa_nome%, encontrei *" + services.length + " serviços* relacionados com sua solicitação, segue abaixo a lista:\n\n" +
        services.map(service => {
            const priceAsNumber = parseFloat(service.price);
            const formattedPrice = !isNaN(priceAsNumber) && priceAsNumber !== 0
                ? ` | R$ ${priceAsNumber.toFixed(2).replace('.', ',')}`
                : '';

            const hours = Math.floor(service.duration / 60);
            const minutes = service.duration % 60;
            const formattedDuration = hours > 0 ? `${hours} hora${hours > 1 ? 's' : ''}` : `${minutes} minuto${minutes > 1 ? 's' : ''}`;

            return `*ID ${service.id} - ${service.name}${formattedPrice}* - ${formattedDuration}`;
        }).join('\n') +
        "\n\nQual desses você deseja agendar? _Basta me informar o ID ou o nome do serviço completo._\n\n_*Exemplo:* AGENDAR ID 19 ou AGENDAR MANICURE & PEDICURE_";
}

            // Verificando se a variável 'run' é verdadeira. Se for, o código dentro deste bloco será executado
            if(run){
                
            //rodar makeAPICall somente se tiver menos de 50 caracteres
            if (content && content.length < 60) {
                // Verificando se 'type_search' do item é igual a 1
                if(item.type_search == 1){
                    // Iterando sobre todas as palavras-chave
                    for (var j = 0; j < keywords.length; j++) {
                        // Verificando se existe algum conteúdo na mensagem
                        if(content){
                            // Convertendo a mensagem para minúsculas e inicializando um contador
                            var msg = content.toLowerCase();
                            var count_chatbot = 0;
                            // Verificando se a mensagem contém a palavra-chave atual
                            if( msg.indexOf( keywords[j] ) !== -1 ){
                                //EDITED G3 - Fazer o request para a API REST DATA com as variáveis
                                if (item.get_api_data == 2 && item.api_url && item.api_config) {
                                    await makeAPICall(item.api_url, JSON.parse(item.api_config), message);
                                } //EDITED G3 END - Fim da requisição REST DATA
                                // Definindo um temporizador para enviar a mensagem
                                await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
                                console.log("Atraso escrevendo 1:", chatbot_delay);
                                setTimeout(function () {
                                    // Enviando a mensagem automaticamente usando a função WAZIPER.auto_send
                                    WAZIPER.auto_send(instance_id, chat_id, chat_id,"chatbot", item, false, msg_info, function(result){});
                                }, count_chatbot * chatbot_delay); // O temporizador é ajustado de acordo com o contador multiplicado pelo atraso definido
                                await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                                // Incrementando o contador após o envio de uma mensagem
                                count_chatbot++;
                                if((nextaction != '')&&(nextaction != null)) 
                                {
                                    var statusNext = 0;
                                    while(statusNext<1) {
                                        var resultDispararNextaction = await dispararNextaction(instance_id, nextaction);
                                        console.log(resultDispararNextaction);
                                        if((resultDispararNextaction == null) || (resultDispararNextaction == '')|| (resultDispararNextaction == nextaction))
                                        {
                                            statusNext = 2;
                                        } else {
                                            await delay(20000);  // espera por 15 segundos (15000 milissegundos)
                                        }
                                        nextaction = resultDispararNextaction;
                                    }
                                }
                            }
                        }
                    }
                /*EDITED G3 - OPÇÕES DO CHATBOT COM CONTEXTO DA MENSAGEM */
                } else if(item.type_search == 2) { // Caso 'type_search' do item seja 2, este bloco será executado
                    // Iterando sobre todas as palavras-chave
                    for (var j = 0; j < keywords.length; j++) {
                        // Verificando se existe algum conteúdo na mensagem
                        if(content){
                            // Convertendo a mensagem para minúsculas e inicializando um contador
                            var msg = content.toLowerCase();
                            var count_chatbot = 0;
                            // Verificando se a mensagem é exatamente igual à palavra-chave atual
                            if( msg == keywords[j] ){
                                //EDITED G3 - Fazer o request para a API REST DATA com as variáveis
                                if (item.get_api_data == 2 && item.api_url && item.api_config) {
                                    await makeAPICall(item.api_url, JSON.parse(item.api_config), message);
                                } //EDITED G3 END - Fim da requisição REST DATA
                                // Definindo um temporizador para enviar a mensagem
                                await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
                                console.log("Atraso escrevendo 2:", chatbot_delay);
                                setTimeout(function () {
                                    // Enviando a mensagem automaticamente usando a função WAZIPER.auto_send
                                    WAZIPER.auto_send(instance_id, chat_id, chat_id, "chatbot", item, false, msg_info, function(result){});
                                }, count_chatbot * chatbot_delay); // O temporizador é ajustado de acordo com o contador multiplicado pelo atraso definido
                                await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                                // Incrementando o contador após o envio de uma mensagem
                                count_chatbot++;
                                
                                if((nextaction != '')&&(nextaction != null)) 
                                {
                                    var statusNext = 0;
                                    while(statusNext<1) {
                                        var resultDispararNextaction = await dispararNextaction(instance_id, nextaction);
                                        if((resultDispararNextaction == null) || (resultDispararNextaction == '')|| (resultDispararNextaction == nextaction))
                                        {
                                            statusNext = 2;
                                        } else {
                                            await delay(20000);  // espera por 15 segundos (15000 milissegundos)
                                        }
                                        nextaction = resultDispararNextaction;
                                    }
                                }
                            }
                        }
                    }
                } else if(item.type_search == 3) { // Caso 'type_search' do item seja 3, este bloco será executado
                        
                        var count_chatbot = 0;
                        
            // Iterando sobre todas as palavras-chave
                        for (var j = 0; j < keywords.length; j++) {
                        
                            // Verificando se existe algum conteúdo na mensagem
                            if(content){
                                // Convertendo a mensagem para minúsculas e inicializando um contador
                                var msg = content.toLowerCase();
                                var keyword = keywords[j].toLowerCase();
                                var keywordParts = keyword.split('.'); // Divide a palavra-chave em partes delimitadas por "."
                                // Verifica se a mensagem contém todas as partes da palavra-chave
                                /*var foundAllKeywords = keywordParts.every(function(keywordPart) {
                                    return msg.includes(keywordPart.trim());
                                });*/
                                // Verifica se a mensagem contém todas as partes da palavra-chave na ordem correta
                                var currentIndex = 0;

                                var foundAllKeywords = keywordParts.every(function(keywordPart) {
                                    var index = msg.indexOf(keywordPart.trim(), currentIndex);
                                
                                    // Verifica se a parte da palavra-chave está no início de uma palavra na mensagem
                                    var match = index !== -1 && (index === 0 || isWhiteSpace(msg.charAt(index - 1)));
                                
                                    if (match) {
                                        currentIndex = index + keywordPart.length;
                                       // console.log(currentIndex);
                                        return true;
                                        
                                    }    
                                    
                                
                                    return false;
                                });
                                
                                //console.log(foundAllKeywords);
                                // Função auxiliar para verificar se o caractere é um espaço em branco
                                function isWhiteSpace(char) {
                                    return /\s/.test(char);
                                }
                                // Verificando se a mensagem é exatamente igual à palavra-chave atual
                                if (foundAllKeywords  && count_chatbot === 0) {
                                    //EDITED G3 - Fazer o request para a API REST DATA com as variáveis
                                    if (item.get_api_data == 2 && item.api_url && item.api_config) {
                                        await makeAPICall(item.api_url, JSON.parse(item.api_config), message);
                                    } //EDITED G3 END - Fim da requisição REST DATA
                                    // Definindo um temporizador para enviar a mensagem
                                    await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
                                    console.log("Atraso escrevendo 3:", chatbot_delay);
                                    setTimeout(function () {
                                        // Enviando a mensagem automaticamente usando a função WAZIPER.auto_send
                                        WAZIPER.auto_send(instance_id, chat_id, chat_id, "chatbot", item, false, msg_info, function(result){});
                                    }, count_chatbot * chatbot_delay); // O temporizador é ajustado de acordo com o contador multiplicado pelo atraso definido
                                    await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                                    // Incrementando o contador após o envio de uma mensagem
                                    count_chatbot++;
                                    
                                    if((nextaction != '')&&(nextaction != null)) 
                                    {
                                        var statusNext = 0;
                                        while(statusNext<1) {
                                            var resultDispararNextaction = await dispararNextaction(instance_id, nextaction);
                                            if((resultDispararNextaction == null) || (resultDispararNextaction == '')|| (resultDispararNextaction == nextaction))
                                            {
                                                statusNext = 2;
                                            } else {
                                                await delay(20000);  // espera por 15 segundos (15000 milissegundos)
                                            }
                                            nextaction = resultDispararNextaction;
                                        }
                                    }
                                }
                            
                            }
                        }
                /* MENSAGEM INICIA COM CHAVES DE AGENDAMENTO*/
                } else if (item.type_search == 4) {
    console.log("Valor de keywords:", keywords);
    const lowerContent = content.toLowerCase();
    const keywordSets = keywords;

    // Verificar se o conteúdo contém pelo menos uma palavra-chave de qualquer conjunto seguido por pelo menos uma palavra
    const conteudoContemKeyword = keywordSets.some(keyword => {
        const keywordLowerCase = keyword.toLowerCase();
        const keywordIndex = lowerContent.indexOf(keywordLowerCase);

        // Verificar se a palavra-chave está presente e extrair a substring a partir dela
        if (keywordIndex !== -1) {
            const substringAfterKeyword = content.substring(keywordIndex).trim();
            
            // Se a substring contiver pelo menos uma palavra, incluindo a palavra-chave, processar a mensagem
            if (substringAfterKeyword.length > keyword.length) {
                console.log("Conteúdo após a palavra-chave:", substringAfterKeyword);
                
                // Redefinir o valor de content para a substring após a palavra-chave
                content = substringAfterKeyword;
                return true; // Ativa a condição de conteúdo válido
            }
        }

        return false; // Continua verificando com as próximas palavras-chave
    });

    // Se o conteúdo contém pelo menos uma palavra-chave de qualquer conjunto seguido por pelo menos uma palavra, não ativar o await
    if (conteudoContemKeyword) {
        await processarMensagem(keywords, content, instance_id, message, item, count_chatbot, chatbot_delay, sessions);
    }
}

            } else {
                console.log('A mensagem é muito longa, a chamada da API não será feita.');
            }
                /*EDITED G3 END - FIM DO CONTEXTO*/
                /*} else { // Caso 'type_search' do item não seja 1, este bloco será executado
                    
                    // Iterando sobre todas as palavras-chave
                    for (var j = 0; j < keywords.length; j++) {
                        
                        // Verificando se existe algum conteúdo na mensagem
                        if(content){
                            
                            // Convertendo a mensagem para minúsculas e inicializando um contador
                            var msg = content.toLowerCase();
                            var count_chatbot = 0;
                            
                            // Verificando se a mensagem é exatamente igual à palavra-chave atual
                            if( msg == keywords[j] ){
                                
                                // Definindo um temporizador para enviar a mensagem
                                setTimeout(function () {
                                    // Enviando a mensagem automaticamente usando a função WAZIPER.auto_send
                                    WAZIPER.auto_send(instance_id, chat_id, chat_id, "chatbot", item, false, msg_info, function(result){});
                                }, count_chatbot * chatbot_delay); // O temporizador é ajustado de acordo com o contador multiplicado pelo atraso definido
                                
                                // Incrementando o contador após o envio de uma mensagem
                                count_chatbot++;
                                
                                if((nextaction != '')&&(nextaction != null)) 
                                {
                                    var statusNext = 0;
                                    while(statusNext<1) {
                                        var resultDispararNextaction = await dispararNextaction(instance_id, nextaction);
                                        if((resultDispararNextaction == null) || (resultDispararNextaction == '')|| (resultDispararNextaction == nextaction))
                                        {
                                            statusNext = 2;
                                        } else {
                                            await delay(2000);  // espera por 2 segundos (2000 milissegundos)
                                        }
                                        nextaction = resultDispararNextaction;
                                    }
                                }
                            }
                        }
                    }
                    
                    
                }*/
            }
        });

    },

	/*send_message: async function(instance_id, access_token, req, res){
		var type = req.query.type;
        var chat_id =  req.body.chat_id;
        var media_url = req.body.media_url;
        var caption = req.body.caption;
        var filename = req.body.filename;
        var team = await Common.db_get("sp_team", [{ids: access_token}]);
        
        //EDITED G3
		var cleanedWaName = '';
		var userPhone = '';
		var msgConversa = '';
		var idConversa = '';
		var participanteGrupo = '';
		//nextAction, inputName e saveData
        var saveData = '';
        var inputName = '';
        var nextAction = '';

        if(!team){
        	return res.json({ status: 'error', message: "The authentication process has failed" });
        }

        item = {
        	team_id: team.id,
        	type: 1,
        	caption: caption,
        	media: media_url,
        	filename: filename
        }

        await WAZIPER.auto_send(instance_id, chat_id, "api", item, false, cleanedWaName, userPhone, idConversa, msgConversa, participanteGrupo, nextAction, inputName, saveData, function(result){
        	if(result){
        		if(result.message != undefined){
        			result.message.status = "SUCCESS";
        		}
        		return res.json({ status: 'success', message: "Success", "message": result.message });
        	}else{
        		return res.json({ status: 'error', message: "Error" });
        	}
        });
	},*/
	// Função para ajustar o chat_id/número de telefone
   /* ajustaNumero(chat_id) {
    // Remove espaços em branco no início e no final
    let nmr = chat_id.trim();
    
    // Se o número já contém 'g.us', retorna-o diretamente sem alterações
    if (nmr.includes('@g.us')) {
        return nmr;
    }

    // Verifica se o sufixo '@c.us' ou '@g.us' existe antes de fazer o split
    // Utiliza expressão regular para verificar ambos os sufixos
    const sufixoRegex = /@(c|g)\.us$/;
    if (sufixoRegex.test(nmr)) {
        nmr = nmr.split('@')[0];
    }

    // Remove o sinal de mais (+), se presente
    nmr = nmr.startsWith('+') ? nmr.substring(1) : nmr;

    // Extrai os componentes do número
    const nmrDDI = nmr.substring(0, 2);
    const nmrDDD = nmr.substring(2, 4);
    const inicioNumero = nmr.substring(4, 5); // Dígito inicial após DDI e DDD
    const nmrSemDDIeDDD = nmr.substring(4); // Número sem DDI e DDD

    // Define se o número é potencialmente um celular baseado no primeiro dígito após DDI e DDD
    const ehCelular = ['9', '8', '7', '6'].includes(inicioNumero);

    let nmrfinal = nmr;

    // Verifica se o número é do Brasil (DDI 55)
    if (nmrDDI === '55') {
        // Para números com DDD menor ou igual a 30 e que são celulares, adiciona o nono dígito se ainda não tiver
        if (parseInt(nmrDDD) <= 30 && ehCelular && nmrSemDDIeDDD.length === 8) {
            nmrfinal = nmrDDI + nmrDDD + "9" + nmrSemDDIeDDD;
        } 
        // Para DDDs maiores que 30, remove o nono dígito se estiver presente e for um número de celular
        else if (parseInt(nmrDDD) > 30 && ehCelular && nmrSemDDIeDDD.length === 9) {
            nmrfinal = nmrDDI + nmrDDD + nmrSemDDIeDDD.substring(1);
        }
    }

    // Retorna o número ajustado com o sufixo '@c.us'
    return nmrfinal;
},*/
    

	send_message: async function(instance_id, access_token, req, res){
		var type = req.query.type;
        var chat_id =  this.ajustaNumero(req.body.chat_id);
        var media_url = req.body.media_url;
        var caption = req.body.caption;
        var filename = req.body.filename;
        var team = await Common.db_get("sp_team", [{ids: access_token}]);

        if(!team){
        	return res.json({ status: 'error', message: "The authentication process has failed" });
        }

        item = {
        	team_id: team.id,
        	type: 1,
        	caption: caption,
        	media: media_url,
        	filename: filename
        }
        
        // Conteúdo da mensagem para verificação
        var msgConversa = caption + (media_url ? ` - ${media_url}` : '');
    
        // Verifica se a mensagem já foi enviada para evitar reenvio
        const mensagemJaEnviada = await this.verificaMensagemEnviada(chat_id, instance_id, team.id, msgConversa);
    
        if (!mensagemJaEnviada) {
            await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
            await WAZIPER.auto_send(instance_id, chat_id, chat_id, "api", item, false, false, async (result) => {
                if(result){
                    if(result.message != undefined){
                        result.message.status = "SUCCESS";
                    }
                    // Registrar envio da mensagem após sucesso
                    await this.registrarEnvioWhatsApp(chat_id, instance_id, team.id, msgConversa, '1', 'api');
                    return res.json({ status: 'success', message: "Success", "message": result.message });
                }else{
                    return res.json({ status: 'error', message: "Error" });
                }
            });
            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
        } else {
            console.log("Mensagem já enviada para o número nos últimos 5 minutos, pulando...");
            return res.json({ status: 'error', message: "Mensagem já enviada recentemente." });
        }
        
        /*
        await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
        await WAZIPER.auto_send(instance_id, chat_id, chat_id, "api", item, false, false, function(result){
        	if(result){
        		if(result.message != undefined){
        			result.message.status = "SUCCESS";
        		}
        		return res.json({ status: 'success', message: "Success", "message": result.message });
        	}else{
        		return res.json({ status: 'error', message: "Error" });
        	}
        });
        await sessions[instance_id].sendPresenceUpdate('available', chat_id);*/
	},
	
	send_location: async function(instance_id, access_token, req, res){
    var type = req.query.type;
    var chat_id = req.body.chat_id;
    var latitude = req.body.latitude;
    var longitude = req.body.longitude;
    var team = await Common.db_get("sp_team", [{ids: access_token}]);

    // EDITED G3
    var cleanedWaName = '';
    var userPhone = '';
    var msgConversa = '';
    var idConversa = '';

    if (!team) {
        return res.json({ status: 'error', message: "The authentication process has failed" });
    }

    // Define a função sendLocation fora da função auto_send
    async function sendLocation(instance_id, chat_id, location) {
        try {
            var result = await sessions[instance_id].sendLocation(chat_id, location);
            console.log("Localização enviada com sucesso:", result.message);
            return result;
        } catch (error) {
            console.error("Erro ao enviar a localização:", error.message);
            throw error;
        }
    }

    // Chamar a função WAZIPER.sendLocation para enviar a localização
    var location = {
        degreesLatitude: latitude,
        degreesLongitude: longitude
    };

    try {
        var result = await sendLocation(instance_id, chat_id, location);
        result.message.status = "SUCCESS";
        console.log("Resultado da localização:", result.message);
        return res.json({ status: 'success', message: "Success", "message": result.message });
    } catch (error) {
        console.error("Erro ao enviar a localização:", error.message);
        return res.json({ status: 'error', message: "Error" });
    }
},

	/*
	auto_send: async function(instance_id, chat_id, type, item, params, cleanedWaName, userPhone, idConversa, msgConversa, participanteGrupo, nextAction, inputName, saveData, callback){
		var limit = await WAZIPER.limit(item, type);
		if( !limit ){
			return callback({status: 0, stats: false, message: "The number of messages you have sent per month has exceeded the maximum limit"});
		}
		switch(item.type) {
				//Button 
			  	case 2:
			  		var template = await WAZIPER.button_template_handler(item.template, params);
			  		if(template){
				  		sessions[instance_id].sendMessage(chat_id, template, {
						    ephemeralExpiration: 604800
						}).then( async (message) => {
				  			callback({status: 1, stats: true});
				  			WAZIPER.stats(instance_id, type, item, 1);
			        	}).catch( (err) => {
			        		callback({status: 0, stats: true});
			        		WAZIPER.stats(instance_id, type, item, 0);
			        	});
			        }
				    break;
				//List Messages
			  	case 3:
				  	var template = await WAZIPER.list_message_template_handler(item.template, params);
			  		if(template){
				  		sessions[instance_id].sendMessage(chat_id, template, {
						    ephemeralExpiration: 604800
						}).then( async (message) => {
				  			callback({status: 1, stats: true});
				  			WAZIPER.stats(instance_id, type, item, 1);
			        	}).catch( (err) => {
			        		callback({status: 0, stats: true});
			        		WAZIPER.stats(instance_id, type, item, 0);
			        	});
			        }
				    break;
				//Media & Text
		  		default:
		  			var caption = spintax.unspin(item.caption);
		  			
		  			var msgConversa = msgConversa;
		  			// EDITED G3 - AYCAN
		  			if (caption.includes('#localizacao#')) {
                        var locationData = {
                            degreesLatitude: -22.181963369579737,  // Exemplo de latitude
                            degreesLongitude: -49.95721737566161,  // Exemplo de longitude
                            
                        };
                        // Removendo a string "#localizacao#" da legenda
                        caption = caption.replace('#localizacao#', '');
                        sessions[instance_id].sendMessage(chat_id, { location: locationData }).then( async (message) => {
                            callback({status: 1, type: type,  stats: true, message: message});
                            WAZIPER.stats(instance_id, type, item, 1);
                        }).catch((err) => {
                            callback({status: 0, type: type,  stats: true});
                            WAZIPER.stats(instance_id, type, item, 0);
                        });
                    }
                    if (caption.includes('#vcard#')) {
                        const vcard = 'BEGIN:VCARD\n'
                                    + 'VERSION:3.0\n'
                                    + 'FN:Gilson Júnio\n' 
                                    + 'ORG:Grupo 3DS;\n' 
                                    + 'TEL;type=CELL;type=VOICE;waid=553194766077:+55 31 99476-6077\n'
                                    + 'END:VCARD';
                    
                        const contactData = {
                            displayName: 'Gilson Júnio',
                            contacts: [{ vcard }]
                        };
                        // Removendo a string "#vcard#" da legenda
                        
                        
                        caption = caption.replace('#vcard#', '');
                        sessions[instance_id].sendMessage(chat_id, { contacts: contactData }).then( async (message) => {
                            callback({status: 1, type: type, stats: true, message: message});
                            WAZIPER.stats(instance_id, type, item, 1);
                        }).catch((err) => {
                            callback({status: 0, type: type, stats: true});
                            WAZIPER.stats(instance_id, type, item, 0);
                        });
                    }
                    if (caption.includes('#link#')) {
                        const link = 'https://agendasa.com/'; 
                    
                        // Substitua a string "#link#" pelo link
                        caption = caption.replace('#link#', link);
                        
                        sessions[instance_id].sendMessage(chat_id, { text: caption }).then( async (message) => {
                            callback({status: 1, type: type, stats: true, message: message});
                            WAZIPER.stats(instance_id, type, item, 1);
                        }).catch((err) => {
                            callback({status: 0, type: type, stats: true});
                            WAZIPER.stats(instance_id, type, item, 0);
                        });
                    }
                    

                    msgConversa = msgConversa;
                    idConversa = idConversa;
                    
                    var participanteGrupo;
                    var tagTipo;
                    
                    if (chat_id.length >= 16) {
                        var tagTipoG = '@g.us';
                        tagTipo = tagTipoG;
                    } else {
                        tagTipo = '@s.whatsapp.net';
                    }
                    
                    if (msgConversa.includes('obrigado') && tagTipo === '@g.us') {
                        const reactionMessage = {
                            react: {
                                text: "", // use uma string vazia para remover a reação
                                key: {
                                    remoteJid: userPhone + tagTipo,
                                    fromMe: false,
                                    id: idConversa,
                                    participant: participanteGrupo// Adiciona a propriedade participant somente quando tagTipo é '@g.us' e participanteGrupo estiver definido
                                }
                            }
                        };
                    
                        await sessions[instance_id].sendMessage(chat_id, reactionMessage);
                    }else{
                        const reactionMessage = {
                            react: {
                                text: "", // use uma string vazia para remover a reação
                                key: {
                                    remoteJid: userPhone + '@s.whatsapp.net',
                                    fromMe: false,
                                    id: idConversa,
                                    participant: participanteGrupo
                                }
                            }
                        };
                    
                        await sessions[instance_id].sendMessage(chat_id, reactionMessage);
                    }
                    //Teste Quote
                    /*
                    if (msgConversa.includes('mencioneme') && tagTipo === '@g.us') {
                        const tagMessage = {
                            text: "mensagem mencionada",
                            contextInfo: {
                                stanzaId: "3EB033511FDFC62BC06949",
                                participant: "553194766077@s.whatsapp.net",
                                quotedMessage: {
                                    extendedTextMessage: {
                                        text: "mencioneme",
                                        inviteLinkGroupTypeV2: "DEFAULT"
                                    }
                                }
                            }
                        };
                    
                        var res = await sessions[instance_id].sendMessage(chat_id, tagMessage);
                        console.log(PINK + "resultado tag:", res, RESET); 
                    }else{
                        const tagMessage = {
                            text: "mensagem mencionada",
                            contextInfo: {
                                stanzaId: "3EB033511FDFC62BC06949",
                                participant: "553194766077@s.whatsapp.net",
                                quotedMessage: {
                                    extendedTextMessage: {
                                        text: "mencioneme",
                                        inviteLinkGroupTypeV2: "DEFAULT"
                                    }
                                }
                            }
                        };
                    
                        var res = await sessions[instance_id].sendMessage(chat_id, tagMessage);
                        console.log(YELLOW + "resultado tag:", res, RESET); 
                    }
		  			*//*
		  			//EDITED G3 - AYCAN
		  			var currentDate = new Date();
		  			var meses = [
                        "Janeiro",
                        "Fevereiro",
                        "Março",
                        "Abril",
                        "Maio",
                        "Junho",
                        "Julho",
                        "Agosto",
                        "Setembro",
                        "Outubro",
                        "Novembro",
                        "Dezembro"
                    ];
                    var diasSemana = [
                        "Domingo",
                        "Segunda-feira",
                        "Terça-feira",
                        "Quarta-feira",
                        "Quinta-feira",
                        "Sexta-feira",
                        "Sábado"
                    ];
                    
                    caption = caption.replace("#dia#", currentDate.getDate().toString().padStart(2, '0'));
                    caption = caption.replace("#mes#", (currentDate.getMonth() + 1).toString().padStart(2, '0'));
                    caption = caption.replace("#mesescrito#", meses[currentDate.getMonth()]);
                    caption = caption.replace("#ano4#", currentDate.getFullYear());
                    caption = caption.replace("#diaescrito#", diasSemana[currentDate.getDay()]);
                    
                    let dataAmanha = new Date(currentDate);
                    dataAmanha.setDate(currentDate.getDate() + 1);
                    let proximoMes = currentDate.getMonth() + 2;
                    proximoMes = proximoMes === 13 ? 1 : proximoMes;
                    let ano2digitos = (currentDate.getFullYear() % 100).toString().padStart(2, '0');
                    
                    caption = caption.replace("#proximodia#", ('0' + dataAmanha.getDate()).slice(-2));
                    caption = caption.replace("#proximomes#", ('0' + proximoMes).slice(-2));
                    caption = caption.replace("#data#", ('0' + currentDate.getDate()).slice(-2) + "/" + ('0' + (currentDate.getMonth()+1)).slice(-2) + "/" + currentDate.getFullYear());
                    caption = caption.replace("#ano2#", ano2digitos);
                    caption = caption.replace("#hora#", currentDate.getHours().toString().padStart(2, '0'));
                    caption = caption.replace("#minuto#", currentDate.getMinutes().toString().padStart(2, '0'));
                    
                    // Gerar um código único aleatório com 7 dígitos
                    var codigoUnico = Math.floor(Math.random() * 9000000) + 1000000;
                    
                    // Criar o código do protocolo
                    var dia = currentDate.getDate().toString().padStart(2, '0');
                    var mes = (currentDate.getMonth() + 1).toString().padStart(2, '0');
                    var ano = currentDate.getFullYear();
                    var hora = currentDate.getHours().toString().padStart(2, '0');
                    var minuto = currentDate.getMinutes().toString().padStart(2, '0');
                    var codigoProtocolo = "Prot-" + dia + "" + mes + "" + ano + "" + hora + "" + minuto + "" + codigoUnico;
                    // Substituir "#protocolo#" pelo código do protocolo
                    caption = caption.replace("#protocolo#", codigoProtocolo);
                    caption = caption.replace("#horario#", `${hora}:${minuto}`);
                    var saudacao;
                    // Verificar a hora para determinar a saudação correta
                    if (hora < 5) {
                        saudacao = "Boa madrugada";
                    } else if (hora < 12) {
                        saudacao = "Bom dia";
                    } else if (hora < 18) {
                        saudacao = "Boa tarde";
                    } else {
                        saudacao = "Boa noite";
                    }
                    
                    // Substituir #saudacao# pela saudação determinada
                    caption = caption.replace("#saudacao#", saudacao);
                    
                    // Definir as horas de início e fim do atendimento
                    var inicioAtendimento = 7; // 7:00
                    var fimAtendimentoDiaSemana = 19; // 19:00
                    var fimAtendimentoSabado = 13; // 13:00
                    
                    // Definir a mensagem de atendimento
                    var mensagemAtendimento = "🤖 Mensagem automática \n\n Você está dentro do horário de atendimento 😃 \n Já estamos te encaminhando para um de nossos atendentes. 👥 \n \n 🗓️ Horário de atendimento:\n\n Segunda a Sexta das 07:00 às 19:00 \n Sábado das 07:00 às 13:00";
                    var mensagemForaAtendimento = "🤖 Mensagem automática \n\n Infelizmente, você está fora do horário de atendimento. 😞 \n \n 🗓️ Nosso horário de atendimento: \n \n Segunda a Sexta das 07:00 às 19:00 \n Sábado das 07:00 às 13:00";

                    
                    // Verificar o dia da semana atual (0 = Domingo, 1 = Segunda-feira, ..., 6 = Sábado)
                    var diaSemana = currentDate.getDay();
                    
                    // Converter a variável hora para número
                    var horaAtual = Number(hora);
                    
                    if ((diaSemana >= 1 && diaSemana <= 5 && horaAtual >= inicioAtendimento && horaAtual < fimAtendimentoDiaSemana) ||
                        (diaSemana == 6 && horaAtual >= inicioAtendimento && horaAtual < fimAtendimentoSabado)) {
                        // Dentro do horário de atendimento
                        caption = caption.replace("#horarioatendimento#", mensagemAtendimento);
                    } else {
                        // Fora do horário de atendimento
                        caption = caption.replace("#horarioatendimento#", mensagemForaAtendimento);
                    }
                    //END CODE AYCAN
                    //EDITED G3
		  			caption = caption.replace("[wa_name]", cleanedWaName).replace("[user_phone]", userPhone); 
		  			//END EDITED G3 
		  			caption = Common.params(params, caption);
		  			//EDITED G3 - LOG NX
		  			console.log("Valor da variável NextAction:", nextAction); //proximaacao

            //Função ifNextAction;
            async function ifNextAction(nextAction){
            if (nextAction) {
                try {
                    // Puxar dados do banco de dados usando nextAction para obter o conteúdo da mensagem adicional
                    var busca_next_action = await Common.db_get("sp_whatsapp_chatbot", [{ keywords: nextAction }, { instance_id: instance_id } ]);
                    if (busca_next_action != '') {
                        var caption_next_action = busca_next_action.caption;
                        var caption_next_action = spintax.unspin(caption_next_action);
                        var media_next_action = busca_next_action.media;
                        var proximo_next_action = busca_next_action.nextaction;
                        
                        console.log(MAGENTA + "caption primeira consulta:", caption_next_action, RESET); //Resposta Simples
                        console.log(MAGENTA + "media primeira consulta:", media_next_action, RESET); //Resposta Simples
                        console.log(GREEN + "proxima next action:", proximo_next_action, RESET); //Resposta Simples
            
                        // Segunda consulta usando o resultado da primeira consulta (CAPTION)
                        if (caption_next_action != '') {
                            // var conteudo_data_next = await Common.db_get("sp_whatsapp_chatbot", [{ keywords: data_busca_next_action }, { instance_id: instance_id } ]);
            
                            // Log para verificar o resultado da segunda consulta
                            // console.log("Resultado da segunda consulta (data_next):", conteudo_data_next);
            
                            //if (conteudo_data_next != '') {
                                var data = {
                                    text : caption_next_action
                                };//conteudo_data_next.caption;
                                //var data = 'teste';
                                
                                // Log para verificar o conteúdo a ser enviado na mensagem
                                //console.log(MAGENTA + "Conteúdo a ser enviado na mensagem:", data, RESET);
            
                                // Chamar a função externa para enviar a mensagem
                                //await sendNextMessage(instance_id, chat_id, data, callback, type, item);
                                //Segunda consulta sql para nextaction 2
                                var next_action2 = await Common.db_get("sp_whatsapp_chatbot", [{ keywords: busca_next_action.keywords }, { instance_id: instance_id } ]);
                                console.log(YELLOW + "Resultado nextAction2:", next_action2, RESET);
                                var nextAction2 = next_action2.keywords;
                                console.log(YELLOW + "Resultado nextAction2:", nextAction2, RESET);
                                
                                // No bloco 'default', logo antes de chamar a função sendNextMessage, incremente messageCounter
                                messageCounter++;
                                
                                //await sendNextMessage(instance_id, chat_id, data, callback, type, item);
                                
                                //await WAZIPER.auto_send(instance_id, chat_id, "chatbot", item, false, cleanedWaName, userPhone, idConversa, msgConversa, participanteGrupo, nextAction2, inputName, saveData, function(result){});
                                // Chamar a função para executar próximas ações, se houver
                                await executeNextActions(instance_id, chat_id, nextAction2, callback, type, item, messageCounter);
                            // }
                        }
                    }
                } catch (err) {
                    // Lidar com erros caso ocorram durante as consultas SQL
                    console.error("Erro ao consultar o banco de dados:", err);
                    callback({ status: 0, type: type, phone_number: phone_number, stats: true });
                    WAZIPER.stats(instance_id, type, item, 0);
                }
            }
            
            // Função para executar os próximos passos (nextAction) de forma encadeada
            async function executeNextActions(instance_id, chat_id, initialAction, callback, type, item) {
                try {
                    // Função auxiliar para enviar a próxima ação
                    async function sendNextAction(nextAction, messageOrder) {
                        // Puxar dados do banco de dados usando nextAction para obter o conteúdo da mensagem adicional
                        var busca_next_action = await Common.db_get("sp_whatsapp_chatbot", [{ keywords: nextAction }, { instance_id: instance_id }]);
            
                        if (busca_next_action != '') {
                            var caption_next_action = busca_next_action.caption;
                            var media_next_action = busca_next_action.media;
                            var proximo_next_action = busca_next_action.nextaction;
            
                            console.log(MAGENTA + "caption primeira consulta:", caption_next_action, RESET); //Resposta Simples
                            console.log(MAGENTA + "media primeira consulta:", media_next_action, RESET); //Resposta Simples
                            console.log(GREEN + "proxima next action:", proximo_next_action, RESET); //Resposta Simples
            
                            if (caption_next_action != '') {
                                var data = {
                                    text: caption_next_action
                                };
                                
                                // No bloco 'default', logo antes de chamar a função sendNextMessage, incremente messageCounter
                                messageOrder++;
            
                                // Enviar a mensagem e aguardar o envio completo
                                await sendNextMessage(instance_id, chat_id, data, callback, type, item, messageOrder);
            
                                // Atraso padrão entre 2 e 5 segundos (em milissegundos) para a próxima ação
                                const defaultDelay = 2 * 1000 + messageOrder * 1000;
            
                                // Aguardar o atraso antes de enviar a próxima ação
                                await new Promise(resolve => setTimeout(resolve, defaultDelay));
            
                                // Chamar recursivamente a função para enviar a próxima ação
                                if (proximo_next_action) {
                                    await sendNextAction(proximo_next_action, messageOrder + 1);
                                }
                            }
                        }
                    }
            
                    // Inicia o envio da primeira resposta
                    await sendNextAction(initialAction, 1);
                } catch (err) {
                    // Lidar com erros caso ocorram durante as consultas SQL ou envio de mensagens
                    console.error("Erro ao consultar o banco de dados ou enviar mensagem:", err);
                    callback({ status: 0, type: type, phone_number: phone_number, stats: true });
                    WAZIPER.stats(instance_id, type, item, 0);
                }
            }
            
            /*
            async function executeNextActions(instance_id, chat_id, caption, callback, type, item) {
                //const nextActionPattern = /(?<=^|\s|>)(\S+)(?=$|\s|<)/g;
                const nextActionKeywords = caption;//caption.match(nextActionPattern);
                console.log(nextActionKeywords);
            
                if (nextActionKeywords && nextActionKeywords.length > 0) {
                    // Obter o próximo nextAction
                    const nextAction = nextActionKeywords[0];
            
                    try {
                        // Puxar dados do banco de dados usando nextAction para obter o conteúdo da próxima mensagem
                        const nextActionData = await Common.db_get("sp_whatsapp_chatbot", [{ keywords: nextAction }, { instance_id: instance_id }]);
                        if (nextActionData && nextActionData.caption) {
                            // Obter a próxima legenda a partir do resultado do banco de dados
                            const nextCaption = nextActionData.caption;
            
                            // Verificar se a próxima legenda contém um próximo nextAction
                            const hasNextAction = nextCaption;//.match(nextActionPattern);
            
                            // Verificar se a próxima legenda é diferente da legenda atual
                            const isDifferentCaption = nextCaption !== caption;
            
                            // Se houver um próximo nextAction e a próxima legenda for diferente da legenda atual
                            // então chamar a função para enviar a próxima mensagem e continuar a sequência de execução
                            if (hasNextAction && isDifferentCaption) {
                                // Log para verificar o conteúdo a ser enviado na próxima mensagem
                                console.log(BLUE + "Terceiro Conteúdo a ser enviado na próxima mensagem:", nextCaption, RESET);
            
                                // Chamar a função externa para enviar a próxima mensagem
                                await sendNextMessage(instance_id, chat_id, nextCaption, callback, type, item);
                                
                            } else {
                                // Caso contrário, encerrar o loop e finalizar a sequência de execução
                                callback({ status: 1, type: type, stats: true });
                                WAZIPER.stats(instance_id, type, item, 1);
                            }
                        } else {
                            // Caso não haja nextAction correspondente, encerrar o loop e finalizar a sequência de execução
                            callback({ status: 1, type: type, stats: true });
                            WAZIPER.stats(instance_id, type, item, 1);
                        }
                    } catch (err) {
                        // Lidar com erros caso ocorram durante as consultas SQL
                        console.error("Erro ao consultar o banco de dados:", err);
                        callback({ status: 0, type: type, phone_number: phone_number, stats: true });
                        WAZIPER.stats(instance_id, type, item, 0);
                    }
                }
            }
            *//*
            
            //função para replace
            
            // Função para fazer as substituições no conteúdo da mensagem
            function replaceKeywords(caption, userPhone) {
                const currentDate = new Date();
                const hora = currentDate.getHours().toString().padStart(2, '0');
            
                // Substituições para #localizacao#
                if (caption.includes('#localizacao#')) {
                    var locationData = {
                        degreesLatitude: -22.181963369579737,  // Exemplo de latitude
                        degreesLongitude: -49.95721737566161,  // Exemplo de longitude
                    };
                    caption = caption.replace('#localizacao#', '');
                    return { location: locationData };
                }
            
                // Substituições para #vcard#
                if (caption.includes('#vcard#')) {
                    const vcard = 'BEGIN:VCARD\n'
                        + 'VERSION:3.0\n'
                        + 'FN:Gilson Júnio\n'
                        + 'ORG:Grupo 3DS;\n'
                        + 'TEL;type=CELL;type=VOICE;waid=553194766077:+55 31 99476-6077\n'
                        + 'END:VCARD';
            
                    const contactData = {
                        displayName: 'Gilson Júnio',
                        contacts: [{ vcard }]
                    };
            
                    caption = caption.replace('#vcard#', '');
                    return { contacts: contactData };
                }
            
                // Substituições para #link#
                if (caption.includes('#link#')) {
                    const link = 'https://agendasa.com/';
                    caption = caption.replace('#link#', link);
                }
            
                // Substituição para #dia#
                caption = caption.replace("#dia#", currentDate.getDate().toString().padStart(2, '0'));
            
                // Substituição para #mes#
                caption = caption.replace("#mes#", (currentDate.getMonth() + 1).toString().padStart(2, '0'));
            
                // Substituição para #mesescrito#
                const meses = [
                    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
                    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
                ];
                caption = caption.replace("#mesescrito#", meses[currentDate.getMonth()]);
            
                // Substituição para #ano4#
                caption = caption.replace("#ano4#", currentDate.getFullYear());
            
                // Substituição para #diaescrito#
                const diasSemana = [
                    "Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
                    "Quinta-feira", "Sexta-feira", "Sábado"
                ];
                caption = caption.replace("#diaescrito#", diasSemana[currentDate.getDay()]);
            
                // Substituição para #proximodia#
                let dataAmanha = new Date(currentDate);
                dataAmanha.setDate(currentDate.getDate() + 1);
                caption = caption.replace("#proximodia#", ('0' + dataAmanha.getDate()).slice(-2));
            
                // Substituição para #proximomes#
                let proximoMes = currentDate.getMonth() + 2;
                proximoMes = proximoMes === 13 ? 1 : proximoMes;
                caption = caption.replace("#proximomes#", ('0' + proximoMes).slice(-2));
            
                // Substituição para #data#
                caption = caption.replace("#data#", ('0' + currentDate.getDate()).slice(-2) + "/" + ('0' + (currentDate.getMonth() + 1)).slice(-2) + "/" + currentDate.getFullYear());
            
                // Substituição para #ano2#
                const ano2digitos = (currentDate.getFullYear() % 100).toString().padStart(2, '0');
                caption = caption.replace("#ano2#", ano2digitos);
            
                // Substituição para #hora#
                caption = caption.replace("#hora#", currentDate.getHours().toString().padStart(2, '0'));
            
                // Substituição para #minuto#
                caption = caption.replace("#minuto#", currentDate.getMinutes().toString().padStart(2, '0'));
            
                // Gerar um código único aleatório com 7 dígitos
                var codigoUnico = Math.floor(Math.random() * 9000000) + 1000000;
                
                // Função para obter a saudação com base na hora
                function getSaudacao(hora) {
                    hora = parseInt(hora);
                
                    if (hora >= 0 && hora < 12) {
                        return "Bom dia";
                    } else if (hora >= 12 && hora < 18) {
                        return "Boa tarde";
                    } else {
                        return "Boa noite";
                    }
                }
            
                // Criar o código do protocolo
                var dia = currentDate.getDate().toString().padStart(2, '0');
                var mes = (currentDate.getMonth() + 1).toString().padStart(2, '0');
                var ano = currentDate.getFullYear();
                var hora1 = currentDate.getHours().toString().padStart(2, '0');
                var minuto = currentDate.getMinutes().toString().padStart(2, '0');
                var codigoProtocolo = "Prot-" + dia + "" + mes + "" + ano + "" + hora1 + "" + minuto + "" + codigoUnico;
            
                // Substituição para #protocolo#
                caption = caption.replace("#protocolo#", codigoProtocolo);
            
                // Substituição para #horario#
                caption = caption.replace("#horario#", `${hora}:${minuto}`);
            
                // Substituição para #saudacao#
                caption = caption.replace("#saudacao#", getSaudacao(hora));
            
                // Definir as horas de início e fim do atendimento
                var inicioAtendimento = 7; // 7:00
                var fimAtendimentoDiaSemana = 19; // 19:00
                var fimAtendimentoSabado = 13; // 13:00
            
                // Definir a mensagem de atendimento
                var mensagemAtendimento = "🤖 Mensagem automática \n\n Você está dentro do horário de atendimento 😃 \n Já estamos te encaminhando para um de nossos atendentes. 👥 \n \n 🗓️ Horário de atendimento:\n\n Segunda a Sexta das 07:00 às 19:00 \n Sábado das 07:00 às 13:00";
                var mensagemForaAtendimento = "🤖 Mensagem automática \n\n Infelizmente, você está fora do horário de atendimento. 😞 \n \n 🗓️ Nosso horário de atendimento: \n \n Segunda a Sexta das 07:00 às 19:00 \n Sábado das 07:00 às 13:00";
            
                // Verificar o dia da semana atual (0 = Domingo, 1 = Segunda-feira, ..., 6 = Sábado)
                var diaSemana = currentDate.getDay();
            
                // Converter a variável hora para número
                var horaAtual = Number(hora);
            
                // Substituição para #horarioatendimento#
                if ((diaSemana >= 1 && diaSemana <= 5 && horaAtual >= inicioAtendimento && horaAtual < fimAtendimentoDiaSemana) ||
                    (diaSemana == 6 && horaAtual >= inicioAtendimento && horaAtual < fimAtendimentoSabado)) {
                    // Dentro do horário de atendimento
                    caption = caption.replace("#horarioatendimento#", mensagemAtendimento);
                } else {
                    // Fora do horário de atendimento
                    caption = caption.replace("#horarioatendimento#", mensagemForaAtendimento);
                }
            
                // Substituição final para [wa_name] e [user_phone]
                caption = caption.replace("[wa_name]", cleanedWaName).replace("[user_phone]", userPhone);
            
                return { text: caption };
            }
            // Função para enviar a mensagem com o conteúdo obtido do próximo passo
            async function sendNextMessage(instance_id, chat_id, data, callback, type, item, messageOrder) {
                try {
                    const content = replaceKeywords(data.text, userPhone);
                    
                    // Atraso padrão entre 4 e 16 segundos (em milissegundos) para a mensagem
                    const defaultDelay = 4 * 1000 + messageOrder * 1000;
                    
                    // Aguardar o atraso antes de enviar a mensagem
                    await new Promise(resolve => setTimeout(resolve, defaultDelay));
            
                    // Enviar a mensagem usando a sessão fornecida e o conteúdo obtido
                    const message = await sessions[instance_id].sendMessage(chat_id, content);
                    console.log(MAGENTA + "Mensagem sendNextMessage:", message, RESET);
            
                    // Lidar com o sucesso do envio da mensagem
                    callback({ status: 1, stats: true, message: message });
                    WAZIPER.stats(instance_id, type, item, 1);
                } catch (err) {
                    // Lidar com erros caso ocorram durante o envio da mensagem
                    console.error("Erro ao enviar a mensagem:", err);
                    callback({ status: 0, stats: true });
                    WAZIPER.stats(instance_id, type, item, 0);
                }
            }
		} // FIM function ifNextAction

                    // END EDITED
				  	if(item.media != "" && item.media){
			            var mime = Common.ext2mime(item.media);
						var post_type = Common.post_type(mime, 1);
						var filename = (item.filename != undefined)?item.filename:Common.get_file_name(item.media);
					  	switch(post_type){
							case "videoMessage":
								var data = { 
							    	video: {url: item.media},
							        caption: caption
							    }
							    break;

							case "imageMessage":
								var data = { 
							    	image: {url: item.media},
							    	caption: caption 
							    }
							    break;

							case "audioMessage":
								var data = { 
							    	audio: { url: item.media },
							    	ptt: true,
							    	caption: caption
							    }
							    break;

							default:
								var data = { 
							    	document: {url: item.media},
							    	fileName: filename,
							    	caption: caption 
							    }
							    break;
						}

					  	sessions[instance_id].sendMessage( chat_id, data ).then( async (message) => {
							callback({status: 1, stats: true, message: message});
							WAZIPER.stats(instance_id, type, item, 1);
							await ifNextAction(nextAction);
						}).catch((err) => {
							callback({status: 0, stats: true});
							WAZIPER.stats(instance_id, type, item, 0);
			            });
			        }else{
			        	sessions[instance_id].sendMessage (chat_id, { text: caption }).then( (message) => {
			        		callback({status: 1, stats: true, message: message});
			        		WAZIPER.stats(instance_id, type, item, 1);
			        		
			        		ifNextAction(nextAction);
			        	
			        	    
			        	}).catch( (err) => {
			        		callback({status: 0, stats: true});
			        		WAZIPER.stats(instance_id, type, item, 0);
			        	});
			        }

			}
	},*/
	auto_send: async function(instance_id, chat_id, phone_number, type, item, params, msg_info, callback){
	    chat_id = this.ajustaNumero(chat_id);
		var limit = await WAZIPER.limit(item, type);
		if( !limit ){
			return callback({status: 0, stats: false, message: "The number of messages you have sent per month has exceeded the maximum limit"});
		}               
                    /* EDITED G3 - adicionar variavel WA*/
                    
                    caption = item.caption;
                    console.log(BLUE + "dados caption:", item + RESET);
                      // Verificar se msg_info é uma string JSON antes de fazer o parsing
                      if (typeof msg_info === 'string') {
                        dados_msg_info= JSON.parse(msg_info);
                        console.log(RED + "dados msg:", dados_msg_info + RESET);
                        
                        // Obter o nome definido pelo contato no WhatsApp
                        var obterMensagem = Object.keys(dados_msg_info.message)[0];
                        var msgRecebida = dados_msg_info.message[obterMensagem] || '';
                        var waName = dados_msg_info.pushName || '';
                        var cleanedWaName = waName.replace(/[&<>"']/g, '');
                        
                        // Obter o número de telefone do contato
                        var userPhone = dados_msg_info.key.remoteJid.split('@')[0];
                        console.log(WHITE + "wa:", cleanedWaName + userPhone + RESET);
                        
                        // Restante do código que utiliza dados_msg_info
                        // ...
                      }else{
                        // Obter o número de telefone do contato
                        var msgRecebida = '';
                        var cleanedWaName = '';
                        var userPhone = chat_id;
                        console.log(WHITE + "wa:", cleanedWaName + userPhone + RESET);
                      }
                    /* END EDITED*/
                    
                        async function sendText(instance_id, chat_id, caption, type, item, phone_number, duration) {
    					    // Remover as tags %a% e %t% do caption antes de enviar
                            caption = caption.replace(/%a%|%t%|%v%|%i%|%d%/g, '').trim();
                            if(caption != "") {
                                await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
                                await new Promise(resolve => setTimeout(resolve, duration));
                                return sessions[instance_id].sendMessage(chat_id, { text: caption }).then((message) => {
                                    callback({status: 1, type: type, phone_number: phone_number, stats: true, message: message});
                                    WAZIPER.stats(instance_id, type, item, 1);
                                }).catch((err) => {
                                    callback({status: 0, type: type, phone_number: phone_number, stats: true});
                                    WAZIPER.stats(instance_id, type, item, 0);
                            });
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                            }
                        }
                        async function sendAudio(instance_id, chat_id, data, type, item, duration) {
                            await sessions[instance_id].sendPresenceUpdate('recording', chat_id);
                            await new Promise(resolve => setTimeout(resolve, duration));
                            return sessions[instance_id].sendMessage(chat_id, data).then(async (message) => {
                                callback({status: 1, type: type, stats: true, message: message});
                                WAZIPER.stats(instance_id, type, item, 1);
                            }).catch((err) => {
                                callback({status: 0, type: type, stats: true});
                                WAZIPER.stats(instance_id, type, item, 0);
                            });
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                        }
                        async function sendVideo(instance_id, chat_id, data, type, item, duration) {
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                            await new Promise(resolve => setTimeout(resolve, duration));
                            // Remova a propriedade caption de data
                            if (data.hasOwnProperty('caption')) {
                                delete data.caption;
                            }
                            return sessions[instance_id].sendMessage(chat_id, data).then(async (message) => {
                                callback({status: 1, type: type, stats: true, message: message});
                                WAZIPER.stats(instance_id, type, item, 1);
                            }).catch((err) => {
                                callback({status: 0, type: type, stats: true});
                                WAZIPER.stats(instance_id, type, item, 0);
                            });
                        }
                        async function sendVideoTexto(instance_id, chat_id, data, type, item, duration) {
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                            await new Promise(resolve => setTimeout(resolve, duration));
                            return sessions[instance_id].sendMessage( chat_id, data ).then( async (message) => {
							callback({status: 1, type: type, phone_number: phone_number, stats: true, message: message});
							WAZIPER.stats(instance_id, type, item, 1);
                            }).catch((err) => {
                                callback({status: 0, type: type, stats: true});
                                WAZIPER.stats(instance_id, type, item, 0);
                            });
                        }
			            async function sendImagem(instance_id, chat_id, data, type, item, duration) {
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                            await new Promise(resolve => setTimeout(resolve, duration));
                            // Remova a propriedade caption de data
                            if (data.hasOwnProperty('caption')) {
                                delete data.caption;
                            }
                            return sessions[instance_id].sendMessage(chat_id, data).then(async (message) => {
                                callback({status: 1, type: type, stats: true, message: message});
                                WAZIPER.stats(instance_id, type, item, 1);
                            }).catch((err) => {
                                callback({status: 0, type: type, stats: true});
                                WAZIPER.stats(instance_id, type, item, 0);
                            });
                        }
                        async function sendImagemTexto(instance_id, chat_id, data, type, item, duration) {
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                            await new Promise(resolve => setTimeout(resolve, duration));
                            return sessions[instance_id].sendMessage( chat_id, data ).then( async (message) => {
							callback({status: 1, type: type, phone_number: phone_number, stats: true, message: message});
							WAZIPER.stats(instance_id, type, item, 1);
                            }).catch((err) => {
                                callback({status: 0, type: type, stats: true});
                                WAZIPER.stats(instance_id, type, item, 0);
                            });
                        }
                        async function sendDocumento(instance_id, chat_id, data, type, item, duration) {
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                            await new Promise(resolve => setTimeout(resolve, duration));
                            // Remova a propriedade caption de data
                            if (data.hasOwnProperty('caption')) {
                                delete data.caption;
                            }
                            return sessions[instance_id].sendMessage(chat_id, data).then(async (message) => {
                                callback({status: 1, type: type, stats: true, message: message});
                                WAZIPER.stats(instance_id, type, item, 1);
                            }).catch((err) => {
                                callback({status: 0, type: type, stats: true});
                                WAZIPER.stats(instance_id, type, item, 0);
                            });
                        }
                        async function sendDocumentoTexto(instance_id, chat_id, data, type, item, duration) {
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                            await new Promise(resolve => setTimeout(resolve, duration));
                            return sessions[instance_id].sendMessage( chat_id, data ).then( async (message) => {
							callback({status: 1, type: type, phone_number: phone_number, stats: true, message: message});
							WAZIPER.stats(instance_id, type, item, 1);
                            }).catch((err) => {
                                callback({status: 0, type: type, stats: true});
                                WAZIPER.stats(instance_id, type, item, 0);
                            });
                        }
		
		switch(item.type) {

				//Button 
			  	case 2:
			  		var template = await WAZIPER.button_template_handler(item.template, params);
			  		if(template){
				  		sessions[instance_id].sendMessage(chat_id, template, {
						    ephemeralExpiration: 604800
						}).then( async (message) => {
				  			callback({status: 1, type: type, phone_number: phone_number, stats: true});
				  			WAZIPER.stats(instance_id, type, item, 1);
			        	}).catch( (err) => {
			        		callback({status: 0, type: type, phone_number: phone_number, stats: true});
			        		WAZIPER.stats(instance_id, type, item, 0);
			        	});
			        }
				    break;
				//List Messages
			  	case 3:
				  	var template = await WAZIPER.list_message_template_handler(item.template, params);
			  		if(template){
				  		sessions[instance_id].sendMessage(chat_id, template, {
						    ephemeralExpiration: 604800
						}).then( async (message) => {
				  			callback({status: 1, type: type, phone_number: phone_number, stats: true});
				  			WAZIPER.stats(instance_id, type, item, 1);
			        	}).catch( (err) => {
			        		callback({status: 0, type: type, phone_number: phone_number, stats: true});
			        		WAZIPER.stats(instance_id, type, item, 0);
			        	});
			        }
			        console.log("lista: ", template);
				    break;
				//Media & Text
		  		default:
		  			var caption = spintax.unspin(item.caption);
		  			//EDITED G3 - Substituir as variáveis WA no corpo da requisição
		  			if(msgRecebida != '' || cleanedWaName != '' || userPhone != ''){
                    caption = caption.replace('%msg_recebida%', msgRecebida);
                    caption = caption.replace('%wa_nome%', cleanedWaName);
                    caption = caption.replace('%wa_numero%', userPhone);
		  			}
                    //END EDITED - WA
		  			// Use a regex para extrair o número no início da string
		  			console.log(GREEN + "API INFO:", msg_info, RESET);
		  			if (msg_info !== '' || msg_info !== false){
                    msg_info= JSON.parse(msg_info);
                    
                    var keyt = msg_info.hasOwnProperty('key') ? msg_info.key : '';
                    var messageTimestampt = msg_info.hasOwnProperty('messageTimestamp') ? msg_info.messageTimestamp : '';
                    var pushNamet = msg_info.hasOwnProperty('pushName') ? msg_info.pushName : '';
                    var broadcastt = msg_info.hasOwnProperty('broadcast') ? msg_info.broadcast.toString() : '';
                    var messaget = msg_info.hasOwnProperty('message') ? msg_info.message : '';
                    var remoteJidt = (msg_info.key && msg_info.key.hasOwnProperty('remoteJid')) ? msg_info.key.remoteJid : '';
                    var fromMet = (msg_info.key && msg_info.key.hasOwnProperty('fromMe')) ? msg_info.key.fromMe.toString() : '';
                    var idt = (msg_info.key && msg_info.key.hasOwnProperty('id')) ? msg_info.key.id : '';
                    var participantt = (msg_info.key && msg_info.key.hasOwnProperty('participant')) ? msg_info.key.participant : '';
                    var extendedTextMessaget = (msg_info.message && msg_info.message.hasOwnProperty('extendedTextMessage')) ? msg_info.message.extendedTextMessage : '';
                    var messageContextInfot = (msg_info.message && msg_info.message.hasOwnProperty('messageContextInfo')) ? msg_info.message.messageContextInfo : '';
                    var textt = (msg_info.message && msg_info.message.extendedTextMessage && msg_info.message.extendedTextMessage.hasOwnProperty('text')) ? msg_info.message.extendedTextMessage.text : '';
                    var conversationt = (msg_info.message && msg_info.message.hasOwnProperty('conversation')) ? msg_info.message.conversation : '';
                    
                    
                    if (caption.includes('%extendedTextMessage%')) {
                        caption = caption.replace('%extendedTextMessage%', JSON.stringify(extendedTextMessaget));
                    }
                    
                    if (caption.includes('%messageContextInfo%')) {
                        caption = caption.replace('%messageContextInfo%', JSON.stringify(messageContextInfot));
                    }
                    
                    if (caption.includes('%text%')) {
                        caption = caption.replace('%text%', textt);
                    }
                    
                    if (caption.includes('%delay|') || caption.includes('%atraso|')) {
                    // Utilizando regex para encontrar o conteúdo entre '%' e '|'
                    var delayRegex = /%(delay|atraso)\|(\d+)%/;
                    var matches = caption.match(delayRegex);
                
                    if (matches) {
                        var tempo = parseInt(matches[2]); // Tempo em segundos
                
                        // Aguarda o tempo especificado antes de enviar a mensagem
                       // await new Promise(resolve => setTimeout(resolve, tempo * 1000));
                
                        // Restante do código
                        return sessions[instance_id].sendMessage(chat_id, data).then(async (message) => {
                            callback({ status: 1, type: type, phone_number: phone_number, stats: true, message: message });
                            WAZIPER.stats(instance_id, type, item, 1);
                        }).catch((err) => {
                            callback({ status: 0, type: type, stats: true });
                            WAZIPER.stats(instance_id, type, item, 0);
                        });
                
                        // Após o envio da mensagem, atualiza a presença
                        await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
                    }
                }

                    
                    if (caption.includes('%key%')) {
                        caption = caption.replace('%key%', JSON.stringify(keyt));
                    }
                    if (caption.includes('%messageTimestamp%')) {
                        caption = caption.replace('%messageTimestamp%', messageTimestampt);
                    }
                    if (caption.includes('%pushName%')) {
                        caption = caption.replace('%pushName%', pushNamet);
                    }
                    if (caption.includes('%broadcast%')) {
                        caption = caption.replace('%broadcast%', broadcastt);
                    }
                    if (caption.includes('%message%')) {
                        caption = caption.replace('%message%', JSON.stringify(messaget));
                    }
                    if (caption.includes('%remoteJid%')) {
                        caption = caption.replace('%remoteJid%', remoteJidt);
                    }
                    if (caption.includes('%fromMe%')) {
                        caption = caption.replace('%fromMe%', fromMet);
                    }
                    if (caption.includes('%id%')) {
                        caption = caption.replace('%id%', idt);
                    }
                    if (caption.includes('%participant%')) {
                        caption = caption.replace('%participant%', participantt);
                    }
                    if (caption.includes('%conversation%')) {
                        caption = caption.replace('%conversation%', conversationt);
                    }
                    msg_info= JSON.stringify(msg_info);
                    if (caption.includes('%testeinfo%')) {
                        caption = caption.replace('%testeinfo%', msg_info);
                    }
                    if (remoteJidt.includes('g.us')) {
                        var conversation_react = conversationt;
                    } else if (remoteJidt.includes('s.whatsapp.net')) {
                        var conversation_react = conversationt;
                    }
                    if (caption.includes('%mensagemdowhats%')) {
                        caption = caption.replace('%mensagemdowhats%', conversation_react);
                    }
                   if (conversationt.includes('%reagir%')) {
                        const reactionMessage = {
                            react: {
                                text: "💖", // use uma string vazia para remover a reação
                                key: keyt
                            }
                        }
                        await sessions[instance_id].sendMessage(remoteJidt, reactionMessage);
                    }
		  			}
                    var regex = /^%(\d+)%/;
                    var match = caption.match(regex);
                    
                    
                    // Se encontrarmos um match, e o número está entre 1 e 50, use-o como a duração (em segundos)
                    if (match && match[1] && Number(match[1]) >= 1 && Number(match[1]) <= 60) {
                        duration = Number(match[1]) * 1000; // Converter para milissegundos
                        // Remover o número da caption
                        caption = caption.replace(regex, '').trim();
                    }
                    
                    /*EDITED G3 - file_get_contents*/
                    // Função para obter o conteúdo de uma URL usando fetch
                        async function file_get_contents(url) {
                          try {
                            const response = await axios.get(url);
                            return response.data;
                          } catch (error) {
                            console.error("Erro ao obter conteúdo da URL:", error);
                            return null;
                          }
                        }
                    /*END EDITED*/
                    
                    if (caption.includes('%localizacao|')) {
                    // Utilizando regex para encontrar o conteúdo entre '%' e '|'
                    var localizacaoRegex = /%localizacao\|([^%]*)%/;
                    var matches = caption.match(localizacaoRegex);
                    
                    if (matches) {
                      var localizacao = matches[0]; // Isso será "%localizacao|{valor}%"
                      var endereco = matches[1]; // Isso será "{valor}"
                      var info_mapa;
                    
                      // Remover a string "%localizacao%" da legenda
                      caption = caption.replace(localizacao, '');
                    
                      // Verificar se o valor corresponde ao formato de latitude e longitude
                      var latitudeLongitudeRegex = /^-?\d+\.\d+,-?\d+\.\d+$/;
                      if (latitudeLongitudeRegex.test(endereco)) {
                        // Se o valor for no formato de latitude e longitude (ex: "-19.8062312,-43.9634797")
                        // Podemos extrair diretamente a latitude e a longitude
                        var [latitude, longitude] = endereco.split(',');
                        info_mapa = {name: latitude+','+longitude ,address: "Enviado no formato Latitude/Longitude"};
                      } else {
                        // Caso contrário, chamar a API para obter a latitude e longitude do endereço:
                        try {
                          var lat_long = await file_get_contents("https://app.seuatendimento.com/geocode/?endereco_completo=" + endereco);
                          var { latitude, longitude } = lat_long;
                          info_mapa = { name: endereco, address: endereco};
                        } catch (error) {
                          console.error("Erro ao obter lat/long:", error);
                          return;
                        }
                      }
                    
                      // Criar o objeto de localização
                      var locationData = {
                        degreesLatitude: parseFloat(latitude),
                        degreesLongitude: parseFloat(longitude),
                        name: info_mapa ? info_mapa.name : "",
                        address: info_mapa ? info_mapa.address : ""
                      };
                    
                      var post_type = "localizacaoMessage";
                    
                      // Realizar o envio da mensagem com a localização
                      sessions[instance_id].sendMessage(chat_id, { location: locationData }).then((message) => {
                        callback({ status: 1, type: type, phone_number: phone_number, stats: true });
                        WAZIPER.stats(instance_id, type, item, 1);
                      }).catch((err) => {
                        callback({ status: 0, type: type, phone_number: phone_number, stats: true });
                        WAZIPER.stats(instance_id, type, item, 0);
                      });
                    }
                    }
                    
                    /**/
                  function formatPhoneNumber(phoneNumber) {
                    // Remover todos os caracteres não numéricos do número de telefone
                    phoneNumber = phoneNumber.replace(/\D/g, '');
                
                    // Verificar se o número tem mais de 12 dígitos e começa com "55"
                    if (phoneNumber.length > 12 && phoneNumber.startsWith('55')) {
                        // Verificar se é um número de celular e se já tem o nono dígito
                        var isCelular = phoneNumber.charAt(4) === '9';
                        if (isCelular && phoneNumber.charAt(9) === '9') {
                            phoneNumber = phoneNumber.slice(0, 9) + phoneNumber.slice(10);
                        }
                    } else {
                        // Verificar se é um número de celular e se não tem o nono dígito
                        var isCelular = phoneNumber.charAt(2) === '9';
                        if (isCelular && phoneNumber.charAt(8) !== '9') {
                            phoneNumber = phoneNumber.slice(0, 8) + '9' + phoneNumber.slice(8);
                        }
                    }
                
                    // Formato 1: Número sem DDD
                    var phoneNumberWithoutDDD = phoneNumber;
                
                    // Formato 2: Número com DDD
                    var phoneNumberWithDDD = '+55 ' + phoneNumber.slice(2, 4) + ' ' + phoneNumber.slice(4, 8) + '-' + phoneNumber.slice(8);
                
                    return {
                        phoneNumberWithoutDDD,
                        phoneNumberWithDDD,
                    };
                }
                    /**/
                    if (caption.includes('%vcard|')) {
                        // Utilizando regex para encontrar o conteúdo entre '%' e '%'
                        var vcardRegex = /%vcard\|([^%]*)%/;
                        var matches = caption.match(vcardRegex);
                        
                        if (matches) {
                            var vcardData = matches[1]; // Isso será "Grupo 3DS,553194766077"
                            var [nome, phoneNumber] = vcardData.split(',');
                            
                            // Formatar o número de telefone
                            var formattedPhoneNumber = formatPhoneNumber(phoneNumber);
                            var phoneNumberWithDDD = formattedPhoneNumber.phoneNumberWithDDD;
                            var phoneNumberWithoutDDD = formattedPhoneNumber.phoneNumberWithoutDDD;
                        
                            // Construir o VCard a partir dos dados
                            const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${nome}\nORG:${nome};\nTEL;type=CELL;type=VOICE;waid=${phoneNumberWithoutDDD}:${phoneNumberWithDDD}\nEND:VCARD`;
                            
                            
                    
                            const contactData = {
                                displayName: nome,
                                contacts: [{ vcard }]
                            };
                            var post_type = "vcardMessage";
                            
                            console.log("vcard data:", contactData);
                    
                            // Definindo a legenda como uma string vazia após a remoção da hashtag
                            caption = '';
                            sessions[instance_id].sendMessage(chat_id, { contacts: contactData }).then(async (message) => {
                                callback({ status: 1, type: type, phone_number: phone_number, stats: true });
                                WAZIPER.stats(instance_id, type, item, 1);
                            }).catch((err) => {
                                callback({ status: 0, type: type, phone_number: phone_number, stats: true });
                                WAZIPER.stats(instance_id, type, item, 0);
                            });
                        }
                    }

		  			if (caption.includes('%link|')) {
                        // Utilizando regex para encontrar o conteúdo entre '%' e '%'
                        var linkRegex = /%link\|([^%]*)%/;
                        var matches = caption.match(linkRegex);
                        
                        if (matches) {
                            var linkData = matches[1]; // Isso será "https://grupo3ds.com.br" ....
                            
                            // Adicionar "https://" se não estiver presente
                            if (!linkData.startsWith('https://') && !linkData.startsWith('http://')) {
                                linkData = 'https://' + linkData;
                            }
                    
                            const link = linkData; 
                    
                            // Substitua a string "%link%" pelo link
                            var post_type = "linkMessage";
                            
                            await sessions[instance_id].sendPresenceUpdate('composing', chat_id);
            
                            setTimeout(async function () {
                                sessions[instance_id].sendMessage(chat_id, { text: link }).then( async (message) => {
                                            callback({ status: 1, type: type, phone_number: phone_number, stats: true, message: message });
                                            WAZIPER.stats(instance_id, type, item, 1);
                                        }).catch((err) => {
                                            callback({ status: 0, type: type, phone_number: phone_number, stats: true });
                                            WAZIPER.stats(instance_id, type, item, 0);
                                        });
                            }, 10000);
                            await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                            
                            
                        }
                    }
                    if (caption.includes('%verificarnumero%')) {
                        const numeroDeTelefone = '5514997281148';  // Insira o número de telefone que você quer verificar
                        const id = `${numeroDeTelefone}@s.whatsapp.net`; // Convertendo para o formato JID
                        var resultadonumero;
                        const [result] = await sessions[instance_id].onWhatsApp(id);
                        if (result.exists) {
                            resultadonumero = (`${numeroDeTelefone} existe no WhatsApp, como jid: ${result.jid}`);
                        } else {
                            resultadonumero = (`${numeroDeTelefone} não existe no WhatsApp`);
                        }
                        caption = caption.replace('%verificarnumero%', resultadonumero);
                    }
                    
		  			//EDITED G3 - AYCAN
		  			var currentDate = new Date();
		  			var meses = [
                        "Janeiro",
                        "Fevereiro",
                        "Março",
                        "Abril",
                        "Maio",
                        "Junho",
                        "Julho",
                        "Agosto",
                        "Setembro",
                        "Outubro",
                        "Novembro",
                        "Dezembro"
                    ];
                    var diasSemana = [
                        "Domingo",
                        "Segunda-feira",
                        "Terça-feira",
                        "Quarta-feira",
                        "Quinta-feira",
                        "Sexta-feira",
                        "Sábado"
                    ];
                    caption = caption.replace("%dia%", currentDate.getDate().toString().padStart(2, '0'));
                    caption = caption.replace("%mes%", (currentDate.getMonth() + 1).toString().padStart(2, '0'));
                    caption = caption.replace("%mesescrito%", meses[currentDate.getMonth()]);
                    caption = caption.replace("%ano4%", currentDate.getFullYear());
                    caption = caption.replace("%diaescrito%", diasSemana[currentDate.getDay()]);
                    
                    let dataAmanha = new Date(currentDate);
                    dataAmanha.setDate(currentDate.getDate() + 1);
                    let proximoMes = currentDate.getMonth() + 2;
                    proximoMes = proximoMes === 13 ? 1 : proximoMes;
                    let ano2digitos = (currentDate.getFullYear() % 100).toString().padStart(2, '0');
                    // Obtenha a representação escrita do próximo mês e dia
                    let proximoMesEscrito = meses[proximoMes - 1];
                    let proximoDiaEscrito = diasSemana[dataAmanha.getDay()];

                    caption = caption.replace("%proximomesescrito%", proximoMesEscrito);
                    caption = caption.replace("%proximodiaescrito%", proximoDiaEscrito);
                    caption = caption.replace("%proximodia%", ('0' + dataAmanha.getDate()).slice(-2));
                    caption = caption.replace("%proximomes%", ('0' + proximoMes).slice(-2));
                    caption = caption.replace("%data%", ('0' + currentDate.getDate()).slice(-2) + "/" + ('0' + (currentDate.getMonth()+1)).slice(-2) + "/" + currentDate.getFullYear());
                    caption = caption.replace("%ano2%", ano2digitos);
                    caption = caption.replace("%hora%", currentDate.getHours().toString().padStart(2, '0'));
                    caption = caption.replace("%minuto%", currentDate.getMinutes().toString().padStart(2, '0'));
                    
                    // Gerar um código único aleatório com 7 dígitos
                    var codigoUnico = Math.floor(Math.random() * 9000000) + 1000000;
                    
                    // Criar o código do protocolo
                    var dia = currentDate.getDate().toString().padStart(2, '0');
                    var mes = (currentDate.getMonth() + 1).toString().padStart(2, '0');
                    var ano = currentDate.getFullYear();
                    var hora = currentDate.getHours().toString().padStart(2, '0');
                    var minuto = currentDate.getMinutes().toString().padStart(2, '0');
                    var segundo = currentDate.getSeconds().toString().padStart(2, '0');
                    var codigoProtocolo = "Prot-" + dia + "" + mes + "" + ano + "" + hora + "" + minuto + "" + codigoUnico;
                    // Substituir "%protocolo%" pelo código do protocolo
                    caption = caption.replace("%protocolo%", codigoProtocolo);
                    caption = caption.replace("%horario%", `${hora}:${minuto}:${segundo}`);
                    var saudacao;
                    // Verificar a hora para determinar a saudação correta
                    if (hora < 5) {
                        saudacao = "Boa madrugada";
                    } else if (hora < 12) {
                        saudacao = "Bom dia";
                    } else if (hora < 18) {
                        saudacao = "Boa tarde";
                    } else {
                        saudacao = "Boa noite";
                    }
                    if (caption.includes('%saudacao%')) {
                        caption = caption.replace("%saudacao%", saudacao);
                    }
                    
                    
                    // Definir as horas de início e fim do atendimento
                    var inicioAtendimento = 7; // 7:00
                    var fimAtendimentoDiaSemana = 19; // 19:00
                    var fimAtendimentoSabado = 13; // 13:00
                    
                    // Definir a mensagem de atendimento
                    var mensagemAtendimento = "🤖 Mensagem automática \n\n Você está dentro do horário de atendimento 😃 \n Já estamos te encaminhando para um de nossos atendentes. 👥 \n \n 🗓️ Horário de atendimento:\n\n Segunda a Sexta das 07:00 às 19:00 \n Sábado das 07:00 às 13:00";
                    var mensagemForaAtendimento = "🤖 Mensagem automática \n\n Infelizmente, você está fora do horário de atendimento. 😞 \n \n 🗓️ Nosso horário de atendimento: \n \n Segunda a Sexta das 07:00 às 19:00 \n Sábado das 07:00 às 13:00";

                    
                    // Verificar o dia da semana atual (0 = Domingo, 1 = Segunda-feira, ..., 6 = Sábado)
                    var diaSemana = currentDate.getDay();
                    
                    // Converter a variável hora para número
                    var horaAtual = Number(hora);
                    
                    if ((diaSemana >= 1 && diaSemana <= 5 && horaAtual >= inicioAtendimento && horaAtual < fimAtendimentoDiaSemana) ||
                        (diaSemana == 6 && horaAtual >= inicioAtendimento && horaAtual < fimAtendimentoSabado)) {
                        // Dentro do horário de atendimento
                        caption = caption.replace("%horarioatendimento%", mensagemAtendimento);
                    } else {
                        // Fora do horário de atendimento
                        caption = caption.replace("%horarioatendimento%", mensagemForaAtendimento);
                    }
		  			caption = Common.params(params, caption);
				  	if(item.media != "" && item.media){
			            var mime = Common.ext2mime(item.media);
						var post_type = Common.post_type(mime, 1);
						var filename = (item.filename != undefined)?item.filename:Common.get_file_name(item.media);
					  	
					  	switch(post_type){
                            case "videoMessage":
                            var data = { 
                                video: { url: item.media },
                                caption: caption
                            };
                        
                            if (caption && caption.trim() !== "") {
                                // Remova hashtags e espaços extras
                                let cleanedCaption = caption.replace(/%\w+%/g, '').trim();
                                
                                if (cleanedCaption.length === 0) {
                                    // Se o caption limpo é vazio, envie apenas o vídeo
                                    await sendVideo(instance_id, chat_id, data, type, item, phone_number, duration);
                                } else {
                                    if (caption.includes('%t%')) {
                                        // Se contém %t%, envie o texto primeiro, depois o vídeo
                                        await sendText(instance_id, chat_id, caption, type, item, phone_number, duration);
                                        await new Promise(resolve => setTimeout(resolve, duration));
                                        await sendVideo(instance_id, chat_id, data, type, item, phone_number, duration);
                                    } else if (caption.includes('%v%')) {
                                        // Se contém %v%, envie o vídeo primeiro, depois o texto
                                        await sendVideo(instance_id, chat_id, data, type, item, phone_number, duration);
                                        await new Promise(resolve => setTimeout(resolve, duration));
                                        await sendText(instance_id, chat_id, caption, type, item, phone_number, duration);
                                    }
                                    else {
                                        // Se contém %v%, envie o vídeo primeiro, depois o texto
                                        await sendVideoTexto(instance_id, chat_id, data, type, item, phone_number, duration);
                                    }
                                }
                            } else {
                                // Se o caption é vazio ou nulo, envie apenas o vídeo
                                await sendVideo(instance_id, chat_id, data, type, item, phone_number, duration);
                            }
                            break;
							case "imageMessage":
                            var data = { 
                                image: { url: item.media },
                                caption: caption
                            };
                        
                            if (caption && caption.trim() !== "") {
                                // Remove hashtags e espaços extras
                                let cleanedCaption = caption.replace(/%\w+%/g, '').trim();
                                
                                if (cleanedCaption.length === 0) {
                                    // Se o caption limpo é vazio, envie apenas a imagem
                                    await sendImagem(instance_id, chat_id, data, type, item, phone_number, duration);
                                } else {
                                    if (caption.includes('%t%')) {
                                        // Se contém %t%, envie o texto primeiro, depois a imagem
                                        await sendText(instance_id, chat_id, caption, type, item, phone_number, duration);
                                        await new Promise(resolve => setTimeout(resolve, duration));
                                        await sendImagem(instance_id, chat_id, data, type, item, phone_number, duration);
                                    } else if (caption.includes('%i%')) {
                                        // Se contém %i%, envie a imagem primeiro, depois o texto
                                        await sendImagem(instance_id, chat_id, data, type, item, phone_number, duration);
                                        await new Promise(resolve => setTimeout(resolve, duration));
                                        await sendText(instance_id, chat_id, caption, type, item, phone_number, duration);
                                    }
                                    else {
                                        // Se contém %i%, envie a imagem primeiro, depois o texto
                                        await sendImagemTexto(instance_id, chat_id, data, type, item, phone_number, duration);
                                    }
                                }
                            } else {
                                // Se o caption é vazio ou nulo, envie apenas a imagem
                                await sendImagem(instance_id, chat_id, data, type, item, phone_number, duration);
                            }
                            break;


							function generateRandomWaveform() {
                                // Definindo o tamanho do array de bytes.
                                const arraySize = 64; // Ajuste conforme necessário
                                // Usando o módulo crypto para gerar um buffer de bytes aleatórios
                                let randomBytes = crypto.randomBytes(arraySize);
                            
                                // Convertendo o buffer de bytes para uma string de caracteres
                                let byteString = randomBytes.toString('binary');
                            
                                // Codificando a string de bytes em base64
                                let base64String = Buffer.from(byteString, 'binary').toString('base64');
                            
                                return base64String;
                            }
                            
                            // Exemplo de como usar a função no seu caso
                            case "audioMessage":
                                var data = { 
                                    audio: { url: item.media },
                                    ptt: true,
                                    waveform: generateRandomWaveform(), // Aqui usamos a função para gerar um valor aleatório
                                    caption: caption
                                };
							/*case "audioMessage":
                            var data = { 
                                audio: { url: item.media },
                                ptt:true,
                                waveform: "AAAVOTomLj05RzNBOCMzJSE6Ozw3IzAWODZFRD41MjAFEAUPOQ0kST8xHjQjOUA/Qj4hFjdIDzkzLS0fLEM7AA==",
                                caption: caption
                            };*/
                        
                            if (caption && caption.trim() !== "") {
                                // Remova hashtags e espaços extras
                                let cleanedCaption = caption.replace(/%\w+%/g, '').trim();
                                
                                if (cleanedCaption.length === 0) {
                                    // Se o caption limpo é vazio, envie apenas o áudio
                                    await sendAudio(instance_id, chat_id, data, type, item, duration);
                                } else {
                                    if (caption.includes('%t%')) {
                                        // Se contém %t%, envie o texto primeiro, depois o áudio
                                        await sendText(instance_id, chat_id, caption, type, item, phone_number, duration);
                                        await new Promise(resolve => setTimeout(resolve, duration));
                                        await sendAudio(instance_id, chat_id, data, type, item, duration);
                                    } else if (caption.includes('%a%')){
                                        // Se contém %a%, envie o áudio primeiro, depois o texto
                                        await sendAudio(instance_id, chat_id, data, type, item, duration);
                                        await new Promise(resolve => setTimeout(resolve, duration));
                                        await sendText(instance_id, chat_id, caption, type, item, phone_number, duration);
                                    }
                                }
                            } else {
                                // Se o caption é vazio ou nulo, envie apenas o áudio
                                await sendAudio(instance_id, chat_id, data, type, item);
                            }
                            break;
                            default:
                            var data = { 
							    	document: {url: item.media},
							    	fileName: filename,
							    	caption: caption 
							};
                        
                            if (caption && caption.trim() !== "") {
                                // Remove hashtags e espaços extras
                                let cleanedCaption = caption.replace(/%\w+%/g, '').trim();
                                
                                if (cleanedCaption.length === 0) {
                                    // Se o caption limpo é vazio, envie apenas o item default
                                    await sendDefault(instance_id, chat_id, data, type, item, phone_number, duration);
                                } else {
                                    if (caption.includes('%t%')) {
                                        // Se contém %t%, envie o texto primeiro, depois o item default
                                        await sendText(instance_id, chat_id, caption, type, item, phone_number, duration);
                                        await new Promise(resolve => setTimeout(resolve, duration));
                                        await sendDocumento(instance_id, chat_id, data, type, item, phone_number, duration);
                                    } else if (caption.includes('%d%')) {
                                        // Se contém %d%, envie o item default primeiro, depois o texto
                                        await sendDocumento(instance_id, chat_id, data, type, item, phone_number, duration);
                                        await new Promise(resolve => setTimeout(resolve, duration));
                                        await sendText(instance_id, chat_id, caption, type, item, phone_number, duration);
                                    }
                                    else {
                                        // Se contém %d%, envie o item default primeiro, depois o texto
                                        await sendDocumentoTexto(instance_id, chat_id, data, type, item, phone_number, duration);
                                    }
                                }
                            } else {
                                // Se o caption é vazio ou nulo, envie apenas o item default
                                await sendDocumento(instance_id, chat_id, data, type, item, phone_number);
                            }
                            break;
			            // Defina o status de volta para 'available'
                        await sessions[instance_id].sendPresenceUpdate('available', chat_id);
                        }
			        }else{
			            if((post_type != "vcardMessage" )&&(post_type != "localizacaoMessage" )&&(post_type != "linkMessage" )&&(post_type != "NOT" )) {
			                //console.log("MENSAGEM_INFO:", msg_info);
			                //console.log("MENSAGEM_TAG:", msg_info.message);
			               // Supondo que você tenha um objeto chamado "msg_info" que contém o JSON recebido
                        /*var msg = conversationt;
                        
                        if(msg == ''){
                            var msg = textt;
                        }
                        
                        console.log("MENSAGEM_TAG2:", msg);
                        console.log("MSG", messaget);
                        console.log("TXT", textt);
                        console.log("CV", conversationt);*/

			                await new Promise(resolve => setTimeout(resolve, duration));
			        	sessions[instance_id].sendMessage (chat_id, { text: caption}).then( (message) => {
			        		callback({status: 1, type: type, phone_number: phone_number, stats: true, message: message});
			        		WAZIPER.stats(instance_id, type, item, 1);
			        	}).catch( (err) => {
			        		callback({status: 0, type: type, phone_number: phone_number, stats: true});
			        		WAZIPER.stats(instance_id, type, item, 0);
			        	});
			        	// Defina o status de volta para 'available'
                        await sessions[instance_id].sendPresenceUpdate('available', chat_id);
			            }
			        }

			}
	},

	limit: async function(item, type){
		var time_now = Math.floor(new Date().getTime() / 1000);

		//
		var team = await Common.db_query(`SELECT owner FROM sp_team WHERE id = '`+item.team_id+`'`);
		if(!team){ return false }

		var user = await Common.db_query(`SELECT expiration_date FROM sp_users WHERE id = '`+team.owner+`'`);
		if(!user){ return false }

		if(user.expiration_date != 0 && user.expiration_date < time_now){
			return false;
		}

		/*
		* Stats
		*/
		if(stats_history[item.team_id] == undefined){
			stats_history[item.team_id] = {};
			var current_stats = await Common.db_get("sp_whatsapp_stats", [ { team_id: item.team_id } ]);
			if(current_stats){
				stats_history[item.team_id].wa_total_sent_by_month = current_stats.wa_total_sent_by_month;
				stats_history[item.team_id].wa_total_sent = current_stats.wa_total_sent;
				stats_history[item.team_id].wa_chatbot_count = current_stats.wa_chatbot_count;
				stats_history[item.team_id].wa_autoresponder_count = current_stats.wa_autoresponder_count;
				stats_history[item.team_id].wa_api_count = current_stats.wa_api_count;
				stats_history[item.team_id].wa_bulk_total_count = current_stats.wa_bulk_total_count;
				stats_history[item.team_id].wa_bulk_sent_count = current_stats.wa_bulk_sent_count;
				stats_history[item.team_id].wa_bulk_failed_count = current_stats.wa_bulk_failed_count;
				stats_history[item.team_id].wa_time_reset = current_stats.wa_time_reset;
				stats_history[item.team_id].next_update = current_stats.next_update;
			}else{
				return false;
			}
		}
		//End stats

		if(stats_history[item.team_id] != undefined){
			if(stats_history[item.team_id].wa_time_reset < time_now){
				stats_history[item.team_id].wa_total_sent_by_month = 0;
				stats_history[item.team_id].wa_time_reset = time_now + 30*60*60*24;
			}

			//if(stats_history[item.team_id].next_update < time_now){
				var current_stats = await Common.db_get("sp_whatsapp_stats", [ { team_id: item.team_id } ]);
				if(current_stats){
					stats_history[item.team_id].wa_time_reset = current_stats.wa_time_reset;
					if(current_stats.wa_time_reset == 0){
						stats_history[item.team_id].wa_total_sent_by_month = 0;
						stats_history[item.team_id].wa_time_reset = time_now + 30*60*60*24;
					}
				}
			//}
		}

		/*
		* Limit by month
		*/
		if(limit_messages[item.team_id] == undefined){
			limit_messages[item.team_id] = {};
			var team = await Common.db_get("sp_team", [ { id: item.team_id } ]);
			if(team){
				var permissioms = JSON.parse( team.permissions );
				limit_messages[item.team_id].whatsapp_message_per_month = parseInt(permissioms.whatsapp_message_per_month);
				limit_messages[item.team_id].next_update = 0;
			}else{
				return false;
			}
		}

		if(limit_messages[item.team_id].next_update < time_now){
			var team = await Common.db_get("sp_team", [ { id: item.team_id } ]);
			if(team){
				var permissioms = JSON.parse( team.permissions );
				limit_messages[item.team_id].whatsapp_message_per_month = parseInt(permissioms.whatsapp_message_per_month);
				limit_messages[item.team_id].next_update = time_now + 30;
			}
		}
		//End limit by month

		/*
		* Stop all activity when over limit
		*/
		if(limit_messages[item.team_id] != undefined && stats_history[item.team_id] != undefined){
			if( limit_messages[item.team_id].whatsapp_message_per_month <= stats_history[item.team_id].wa_total_sent_by_month ){

				//Stop bulk campaign
				switch(type){
					case "bulk":
						await Common.db_update("sp_whatsapp_schedules", [{run: 0, status: 0}, { id: item.id }]);
						break
				}

				return false;
			}
		}

		return true;
		//End stop all activity when over limit
	},

	stats: async function(instance_id, type, item, status){
		var time_now = Math.floor(new Date().getTime() / 1000);

		if(stats_history[item.team_id].wa_time_reset < time_now){
			stats_history[item.team_id].wa_total_sent_by_month = 0;
			stats_history[item.team_id].wa_time_reset = time_now + 30*60*60*24;
		}

		var sent = status?1:0;
		var failed = !status?1:0;

		stats_history[item.team_id].wa_total_sent_by_month += sent;
		stats_history[item.team_id].wa_total_sent += sent;

		switch(type){
			case "chatbot":
				if(chatbots[item.id] == undefined){
					chatbots[item.id] = {};
				}

				if(
					chatbots[item.id].chatbot_sent == undefined &&
					chatbots[item.id].chatbot_failed == undefined
				){
					chatbots[item.id].chatbot_sent = item.sent;
					chatbots[item.id].chatbot_failed = item.sent;
				}

				chatbots[item.id].chatbot_sent += (status?1:0);
				chatbots[item.id].chatbot_failed += (!status?1:0);

				stats_history[item.team_id].wa_chatbot_count += sent;

				var total_sent = chatbots[item.id].chatbot_sent;
				var total_failed = chatbots[item.id].chatbot_failed;
				var data = { 
					sent: total_sent,
					failed: total_failed,
				};

				await Common.db_update("sp_whatsapp_chatbot", [data, { id: item.id }]);
			    break;

			case "autoresponder":
				if(
					sessions[instance_id].autoresponder_sent == undefined &&
					sessions[instance_id].autoresponder_failed == undefined
				){
					sessions[instance_id].autoresponder_sent = item.sent;
					sessions[instance_id].autoresponder_failed = item.sent;
				}

				sessions[instance_id].autoresponder_sent += (status?1:0);
				sessions[instance_id].autoresponder_failed += (!status?1:0);
				
				stats_history[item.team_id].wa_autoresponder_count += sent;

				var total_sent = sessions[instance_id].autoresponder_sent;
				var total_failed = sessions[instance_id].autoresponder_failed;
				var data = { 
					sent: total_sent,
					failed: total_failed,
				};
				
				await Common.db_update("sp_whatsapp_autoresponder", [data, { id: item.id }]);
			    break;

			case "bulk":
				stats_history[item.team_id].wa_bulk_total_count += 1;
				stats_history[item.team_id].wa_bulk_sent_count += sent;
				stats_history[item.team_id].wa_bulk_failed_count += failed;
			    break;

			case "api":
				stats_history[item.team_id].wa_api_count += sent;
			    break;
		}

		/*
		* Update stats
		*/
		if(stats_history[item.team_id].next_update < time_now){
			stats_history[item.team_id].next_update = time_now + 30;
		}
		await Common.db_update("sp_whatsapp_stats", [ stats_history[item.team_id], { team_id: item.team_id }]);
		//End update stats

	},

	button_template_handler: async function(template_id, params){
		var template = await Common.db_get("sp_whatsapp_template", [{ id: template_id }, { type: 2 }]);
  		if(template){
	  		var data = JSON.parse( template.data );
	  		if(data.text != undefined){
	  			data.text = spintax.unspin(data.text);
	  			data.text = Common.params(params, data.text);
	  		}

	  		if(data.caption != undefined){
	  			data.caption = spintax.unspin(data.caption);
	  			data.caption = Common.params(params, data.caption);
	  		}

	  		if(data.footer != undefined){
	  			data.footer = spintax.unspin(data.footer);
	  			data.footer = Common.params(params, data.footer);
	  		}

	  		for (var i = 0; i < data.templateButtons.length; i++) {
	  			if(data.templateButtons[i]){
	  				if(data.templateButtons[i].quickReplyButton != undefined){
	  					data.templateButtons[i].quickReplyButton.displayText = spintax.unspin(data.templateButtons[i].quickReplyButton.displayText);
	  					data.templateButtons[i].quickReplyButton.displayText = Common.params(params, data.templateButtons[i].quickReplyButton.displayText);
	  				}

	  				if(data.templateButtons[i].urlButton != undefined){
	  					data.templateButtons[i].urlButton.displayText = spintax.unspin(data.templateButtons[i].urlButton.displayText);
	  					data.templateButtons[i].urlButton.displayText = Common.params(params, data.templateButtons[i].urlButton.displayText);
	  				}

	  				if(data.templateButtons[i].callButton != undefined){
	  					data.templateButtons[i].callButton.displayText = spintax.unspin(data.templateButtons[i].callButton.displayText);
	  					data.templateButtons[i].callButton.displayText = Common.params(params, data.templateButtons[i].callButton.displayText);
	  				}
	  			}
	  		}

	  		return data;
	  	}

	  	return false;
	},

	list_message_template_handler: async function(template_id, params){
		var template = await Common.db_get("sp_whatsapp_template", [{ id: template_id }, { type: 1 }]);
  		if(template){

	  		var data = JSON.parse( template.data );

	  		if(data.text != undefined){
	  			data.text = spintax.unspin(data.text);
	  			data.text = Common.params(params, data.text);
	  		}

	  		if(data.footer != undefined){
	  			data.footer = spintax.unspin(data.footer);
	  			data.footer = Common.params(params, data.footer);
	  		}

	  		if(data.title != undefined){
	  			data.title = spintax.unspin(data.title);
	  			data.title = Common.params(params, data.title);
	  		}

	  		if(data.buttonText != undefined){
	  			data.buttonText = spintax.unspin(data.buttonText);
	  			data.buttonText = Common.params(params, data.buttonText);
	  		}

	  		for (var i = 0; i < data.sections.length; i++) {
	  			var sessions = data.sections;
	  			if(data.sections[i]){
	  				if(data.sections[i].title != undefined){
	  					data.sections[i].title = spintax.unspin(data.sections[i].title);
	  					data.sections[i].title = Common.params(params, data.sections[i].title);
	  				}

	  				for (var j = 0; j < data.sections[i].rows.length; j++) {
	  					if(data.buttonText != undefined){
	  						data.sections[i].rows[j].title = spintax.unspin(data.sections[i].rows[j].title);
	  						data.sections[i].rows[j].title = Common.params(params, data.sections[i].rows[j].title);
	  					}

	  					if(data.buttonText != undefined){
	  						data.sections[i].rows[j].description = spintax.unspin(data.sections[i].rows[j].description);
	  						data.sections[i].rows[j].description = Common.params(params, data.sections[i].rows[j].description);
	  					}
	  				}
	  			}
	  		}

	  		return data;
	  	}

	  	return false;
	},

	live_back: async function(){
		var account = await Common.db_query(`
			SELECT a.changed, a.token as instance_id, a.id, b.ids as access_token 
			FROM sp_accounts as a 
			INNER JOIN sp_team as b ON a.team_id=b.id 
			WHERE a.social_network = 'whatsapp' AND a.login_type = '2' AND a.status = 1 
			ORDER BY a.changed ASC 
			LIMIT 1
		`);
		
		if(account){
			var now = new Date().getTime()/1000;
			await Common.db_update("sp_accounts", [ { changed: now }, { id: account.id } ]);
			await WAZIPER.instance(account.access_token, account.instance_id, false, async (client) => {
				if(client.qrcode != undefined && client.qrcode != ""){
					await WAZIPER.logout(account.instance_id);
				}
	        });
		}

		//Close new session after 2 minutes
		if( Object.keys(new_sessions).length ){
			Object.keys(new_sessions).forEach( async (instance_id) => {
				var now = new Date().getTime()/1000;
				if(now > new_sessions[instance_id] && sessions[instance_id] && sessions[instance_id].qrcode != undefined){
					delete new_sessions[instance_id];
					await WAZIPER.logout(instance_id);
				}
			});
		}

		//console.log("Total sessions: ", Object.keys(sessions).length );
		//console.log("Total queue sessions: ", Object.keys(new_sessions).length );
		
	},

	add_account: async function(instance_id, team_id, wa_info, account){
		if(!account){
			await Common.db_insert_account(instance_id, team_id, wa_info);
		}else{
			var old_instance_id = account.token;

			await Common.db_update_account(instance_id, team_id, wa_info, account.id);

			//Update old session
			if(instance_id != old_instance_id){
				await Common.db_delete("sp_whatsapp_sessions", [ { instance_id: old_instance_id } ]);
				await Common.db_update("sp_whatsapp_autoresponder", [ { instance_id: instance_id }, { instance_id: old_instance_id } ]);
				await Common.db_update("sp_whatsapp_chatbot", [ { instance_id: instance_id }, { instance_id: old_instance_id } ]);
				await Common.db_update("sp_whatsapp_webhook", [ { instance_id: instance_id }, { instance_id: old_instance_id } ]);
				WAZIPER.logout(old_instance_id);
			}

			var pid = Common.get_phone(wa_info.id, 'wid');
			var account_other = await Common.db_query(`SELECT id FROM sp_accounts WHERE pid = '`+pid+`' AND team_id = '`+team_id+`' AND id != '`+account.id+`'`);
			if(account_other){
				await Common.db_delete("sp_accounts", [ { id: account_other.id } ]);
			}
		}

		/*Create WhatsApp stats for user*/
		var wa_stats = await Common.db_get("sp_whatsapp_stats", [ { team_id: team_id } ]);
		if(!wa_stats) await Common.db_insert_stats(team_id);
	}
}

module.exports = WAZIPER; 

setInterval(function(){
	WAZIPER.live_back();
}, 2000);

setInterval(function(){
	WAZIPER.bulk_messaging();
}, 1000);

cron.schedule('*/2 * * * * *', function() {
  WAZIPER.live_back();
});

cron.schedule('*/1 * * * * *', function() {
  WAZIPER.bulk_messaging();
});
