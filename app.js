
require('./Core/BetterLogs');

var Web3 = require('web3');
var Rabbot = require("rabbot");


var Config = require('./config');
var RabbitConfig = Config.rabbotConfig;

/**
 * Read Params
 */
let modules = {
    validate: false,
    transactions: false,
    calls: false
};
for (let arg of process.argv) {
    if (arg === "validate") {
        modules.validate = true;
    }
    if (arg === "transactions") {
        modules.transactions = true;
    }
    if (arg === "calls") {
        modules.calls = true;
    }
}

/**
 * Get Web3
 */
getWeb3 = async function() {
    return new Web3(new Web3.providers.HttpProvider(Config.web3_host));
};

/**
 * Configure Rabbot
 */
getRabbot = async function (connection = null) {
    // Update rabbot connection user
    if (connection && connection.hasOwnProperty("user") && connection.hasOwnProperty("pass")) {
        RabbitConfig.connection.user = connection.user;
        RabbitConfig.connection.pass = connection.pass;
    }
    await Rabbot.configure(RabbitConfig);
    return Rabbot;
};

/**
 * Start the modules
 */
start = async function () {
    let web3 = await getWeb3();

    if (modules.validate) {
        let rabbot = await getRabbot(Config.validate.connection);
        require('./Validate-Transaction-Node/validate')(web3, rabbot);
    }

    if (modules.transactions) {
        let rabbot = await getRabbot(Config.transactions.connection);
        require('./Send-Transaction-Node/transactions')(web3, rabbot);
    }

    if (modules.calls) {
        let rabbot = await getRabbot(Config.calls.connection);
        require('./Calls-Node/calls')(web3, rabbot);
    }
};


/**
 * RUN
 */
start().then(() => {
    console.log("Started Ethereum Nodes:");
    if (modules.validate) console.log("  - validate");
    if (modules.transactions) console.log("  - transactions");
    if (modules.calls) console.log("  - calls");
    console.log("");
}).catch(function(e){
    console.error("ERROR starting Ethereum nodes");
    console.error(e);
});