
var moment = require('moment');

// Current log function
let log = console.log;

// Re-implement log function
console.log = function (m1, m2 = '') {
    let timeStr = moment(new Date()).format('YYYY-MM-DD HH:mm:ss');
    log(timeStr + "   " + m1, m2);
};

// Current error function
let error = console.error;

// Re-implement log function
console.error = function (message) {
    let timeStr = moment(new Date()).format('YYYY-MM-DD HH:mm:ss');
    if (typeof message === 'object') {
        error(timeStr + "   Error");
        error(message);
    } else {
        error(timeStr + "   " + message);
    }
};
