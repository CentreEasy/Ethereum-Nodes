
// First load base configuration file
let baseConfiguration = require('./config.base');

// now load the dynamic config file
let dynamicConfiguration = {};
try {
    dynamicConfiguration = require('./config');
} catch (ignored) {
    if (ignored.toString().includes("SyntaxError")) {
        console.error("Syntax Error in config file.");
        process.exit();
    }
    console.log("Config file not found. Using default configuration.");
}

// Merge the two configurations

let mergeObjects = function (object1, object2) {
    for (let key of Object.keys(object2)) {
        if (object2[key] instanceof Object) {
            object1[key] = mergeObjects(object1[key], object2[key]);
        } else {
            object1[key] = object2[key];
        }
    }
    return object1;
};
let configuration = mergeObjects(baseConfiguration, dynamicConfiguration);

// Configure RabbitMQ
configuration.rabbitMQ={
    exchanges: {
        'transactions': {
            name: 'transactions',
            type: 'topic',
            autoDelete: false,
            durable: true,
            persistent: true},
        'transactions-pending': {
            name: 'transactions-pending',
            type: 'topic',
            autoDelete: false,
            durable: true,
            persistent: true
        },
        'calls': {
            name: 'calls',
            type: 'topic',
            autoDelete: false,
            durable: true,
            persistent: false},
        'actions': {
            name: 'actions',
            type: 'topic',
            autoDelete: false,
            durable: true,
            persistent: true
        }
    },
    queues:{
        'calls':{
            name: 'calls-'+configuration.network_name,
            autoDelete: false,
            durable:false,
            noBatch:true,
            limit:configuration.calls.threads
        },
        'transactions':{
            name:"transactions-"+configuration.network_name,
            autoDelete: false,
            durable:true,
            noBatch:true,
            limit:1
        },
        'transactions-pending':{
            name: "transactions-pending-" + configuration.network_name,
            autoDelete: false,
            durable: true,
            noBatch: true,
            limit: configuration.validate.threads
        }
    }
};

// Configura Rabbot
configuration.rabbotConfig = {
    connection: configuration.rabbit_connection,
    exchanges: [
        configuration.rabbitMQ.exchanges['transactions'],
        configuration.rabbitMQ.exchanges['transactions-pending'],
        configuration.rabbitMQ.exchanges['calls'],
        configuration.rabbitMQ.exchanges['actions'],
    ],
    queues: [
        configuration.rabbitMQ.queues['transactions'],
        configuration.rabbitMQ.queues['transactions-pending'],
        configuration.rabbitMQ.queues['calls'],
    ],
    bindings: [
        { exchange: 'transactions', target:  configuration.rabbitMQ.queues['transactions'].name, keys: configuration.network_name },
        { exchange: 'transactions-pending', target:  configuration.rabbitMQ.queues['transactions-pending'].name, keys: configuration.network_name },
        { exchange: 'calls', target: configuration.rabbitMQ.queues['calls'].name, keys: configuration.network_name },
    ]
};

// Export configuration
module.exports = configuration;
