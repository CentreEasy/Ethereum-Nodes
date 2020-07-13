var util = require("util");
var Rabbus = require("rabbus");
var Config = require('../config');
var ActionsUtility = require('../Core/ActionsUtility');

module.exports = async function (Web3, Rabbot) {

    async function isBlockchainSynchronized() {
        try {
            const sync = await Web3.eth.isSyncing();
            const isListening = await Web3.eth.net.isListening();
            return sync === false && isListening === true;
        } catch (e) {
            return false;
        }
    }

    // Set Action sender
    function CallResponder(){
        Rabbus.Responder.call(this, Rabbot, {
            exchange:  Config.rabbitMQ.exchanges.calls,
            queue:  Config.rabbitMQ.queues.calls,
            routingKey: Config.network_name
        });
    }

    util.inherits(CallResponder, Rabbus.Responder);

    // Set Transaction Receiver
    var callResponder = new CallResponder();

    // basic error handler
    callResponder.use(function(err, msg, props, actions, next){
        setTimeout(
            function(){
                throw err;
            });
    });

    // Main handler
    callResponder.handle(async function (message, properties, actionsp, next) {
        let actions = new ActionsUtility(actionsp);

        try {

            if(Date.now() - properties.timestamp > Config.calls.timeout){
                console.log("Rejected call for timeout");
                return actions.reject();
            }

            console.log("Received call message");

            // Check if the Blockchain is Synchronizing or not
            const sync = await isBlockchainSynchronized();
            if (!sync){
                console.log("  Blockchain not synchronized!");
                return actions.nack();
            }

            // Check if the destiny address is a contract or not
            let codeResult = await Web3.eth.getCode(message.to);
            if(codeResult === '0x'){
                // is User Account
                console.error("Calls Node: The destiny address is not a contract");
                return actions.reject();
            }
            console.log("Checked that destiny address is a contract");

            let response = await Web3.eth.call(message);
            console.log("  Request: " + JSON.stringify(message));
            console.log("  Response: " + JSON.stringify(response));
            actions.reply(response);
        } catch (e) {
            console.log("  Error in call. Retry other");
            console.error(e);
            actions.nack();
        } finally {

        }
    });

};
