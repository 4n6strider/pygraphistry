/** @module config */
'use strict';

var util = require('util');
var path = require('path');
var _ = require('lodash');


var configErrors = [];


function getS3() {
    try {
        var AWS = require('aws-sdk');
        AWS.config.update({accessKeyId: 'AKIAJSGVPK46VRVYMU2A', secretAccessKey: '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'});
        AWS.config.update({region: 'us-west-1'});

        return new AWS.S3();
    } catch(err) {
        configErrors.push(err);
        return null;
    }
}


function getErrors(clear) {
    var errors = configErrors.slice(0);

    if(clear) { configErrors = []; }

    return errors;
}


/**
 * Sane default options (assumes local dev server). All possible options MUST be set to some value
 * here (even just to null) so as to act as an authoritative reference of all possible options.
 * @return {Object} The default options object
 */
function defaults() {
    return {
        CONFIG_ERRORS: [],
        getErrors: getErrors,

        HOSTNAME: 'localhost',
        ENVIRONMENT: 'local',
        ALLOW_MULTIPLE_VIZ_CONNECTIONS: true,

        CLUSTER: util.format('%s.local', (process.env['USER'] || 'localuser')),

        // FIXME: Change this to 'VIZ_BIND_ADDRESS', to clarify this is the IP the server binds to,
        // not the IP it is reachable at. Binding to 0.0.0.0 is legal, but not a real, routable IP.
        VIZ_LISTEN_ADDRESS: '127.0.0.1',
        VIZ_LISTEN_PORTS: [10000],   // Fixed list of workers for central.
        VIZ_LISTEN_PORT: 10000,      // Port for this worker.

        // The number of seconds old a GPU ping may be before being considered stale
        GPU_PING_TIMEOUT: 60,
        // The number of seconds a worker waits for an assigned user to connect. During this time,
        // no other connections will be assigned to this worker.
        WORKER_CONNECT_TIMEOUT: 10,

        HTTP_LISTEN_ADDRESS: 'localhost',
        HTTP_LISTEN_PORT: 3000,

        BUCKET: 'graphistry.data',
        S3: getS3(),

        MONGO_USERNAME: undefined,
        MONGO_PASSWORD: undefined,
        MONGO_HOSTS: ['localhost'],
        MONGO_DATABASE: 'graphistry-local',
        DATABASE: 'graphistry-local',   // legacy option name
        MONGO_REPLICA_SET: undefined,
        // This option will be set by synthesized; it's only here for reference
        MONGO_SERVER: 'mongodb://localhost/graphistry-local',
        PINGER_ENABLED: false,

        BOUNDARY: {
            ENDPOINT: 'https://api.graphdat.com/v1/measurements',
            AUTH: {
                user: 'boundary@graphistry.com',
                pass: 'api.62fb69d814-3713'
            }
        },

        API: {
            ALGORITHM: 'aes-256-cbc',
            CANARY: 'Validated',
            SECRET: 'Graphtacular'
        },

        PYGRAPHISTRY: {
            minVersion: '0.9.0',
            latestVersion: '0.9.15'
        },

        LOCAL_CACHE: true,
        LOCAL_CACHE_DIR: '/tmp/graphistry/data_cache',

        // Minimum level of log messages to output (can be an integer or string)
        LOG_LEVEL: 'debug',
        // Where Bunyan should write its logs. If undefined, uses stdout.
        LOG_FILE: undefined,

        // If defined, etl-worker posts notification on slack
        SLACK_BOT_ETL_TOKEN: 'xoxb-7736668449-X6kR1n3omF4CoQ6VeNiXhZSc',

        // This string is prefixed to all Graphistry routes. For example, if BASE_URL is '/foo',
        // then central will append '/vizaddr' to get the route it will listen for viz server
        // address requests, '/foo/vizaddr'. This applies to both static and dynamic content.
        BASE_PATH: '/',
    };
}


/**
 * Parses command-line arguments as JSON and combines that with the existing options.
 * @return {Object} A new set of options combining existing options with command-line options
 */
function commandLine() {
    if (process.argv.length > 2) {
        try {
            return JSON.parse(process.argv[2]);
        } catch (err) {
            err.message = 'WARNING Cannot parse command line arguments, ignoring. Error: ' + err.message;
            configErrors.push(err);

            return {};
        }
    }
}


function getProcessName() {
    if(process.env.SUPERVISOR_PROCESS_NAME) {
        return process.env.SUPERVISOR_PROCESS_NAME;
    } else if(process.env.npm_package_name) {
        return process.env.npm_package_name + '-' + process.pid;
    } else if(require.main) {
        return path.basename(require.main.filename, '.js') + '-' + process.pid;
    } else {
        return __filename + '-' + process.pid;
    }
}


/**
 * Sets/modifies the existing options based off the current `ENVIRONMENT` option value
 * @param  {Object} options - the set of options already set via other methods
 * @return {Object} A new set of options combining existing options with ENVIRONMENT options
 */
function deployEnv(options) {
    if(_.isEmpty(options) || _.isUndefined(options.ENVIRONMENT)) {
        return {};
    }

    // Common options for 'staging' and 'production'
    var cloudOptions = {
        MONGO_USERNAME: 'graphistry',
        MONGO_PASSWORD: 'graphtheplanet',

        VIZ_LISTEN_ADDRESS: '0.0.0.0',

        LOG_FILE: '/var/log/graphistry-json/' + getProcessName() + '.log',
        LOG_LEVEL: 'info',

        MONGO_HOSTS: ['c48.lighthouse.2.mongolayer.com:10048', 'c48.lighthouse.3.mongolayer.com:10048'],
        MONGO_REPLICA_SET: 'set-545152bc461811298c009c03',
        ALLOW_MULTIPLE_VIZ_CONNECTIONS: false,


        PINGER_ENABLED: true
    };

    var stagingOptions = {
        CLUSTER: "staging",

        DATABASE: 'graphistry-staging',
        MONGO_DATABASE: 'graphistry-staging'
    };

    var prodOptions = {
        CLUSTER: "production",

        DATABASE: 'graphistry-prod',
        MONGO_DATABASE: 'graphistry-prod'
    };

    switch(options.ENVIRONMENT) {
        case 'staging':
            return _.extend({}, cloudOptions, stagingOptions);
            break;
        case 'production':
            return _.extend({}, cloudOptions, prodOptions);
            break;
        default:  // 'local'
            return {};
    }
}


/**
 * Sets options based off the value of existing options (except for `ENVIRONMENT`).
 * @param  {Object} options - The set of existing options.
 * @return {Object} A new set of options containing the existing options + new options synthesized
 * from the existing options. The synthesized values will override any existing options of the same
 * name.
 */
function synthesized(options) {
    var mongoServer = getMongoURL(
        options['MONGO_HOSTS'],
        options['MONGO_USERNAME'],
        options['MONGO_PASSWORD'],
        options['MONGO_DATABASE'],
        options['MONGO_REPLICA_SET']);

    return {MONGO_SERVER: mongoServer};
}


/**
 * Creates a MongoDB connection URL from individual parameters
 *
 * @param  {string[]} hosts      - List of MongoDB server hostnames
 * @param  {string} [username]   - MongoDB username (optional)
 * @param  {string} [password]   - MongoDB password (options; if given, username must be given)
 * @param  {string} database     - Name of the database to authenticate against
 * @param  {string} [replicaSet] - The replicaset to use for the MongoDB database (optional)
 *
 * @return {string} A URL you can pass to `MongoClient.connect()` to connect to the database with
 * the options given.
 */
function getMongoURL(hosts, username, password, database, replicaSet) {
    var passwordUrl = _.isString(password) ? util.format(':%s', password) : '';
    var credentialsUrl = _.isString(username) ? util.format('%s%s@', username, passwordUrl) : '';

    var replicaSetUrl = _.isString(replicaSet) ? util.format('?replicaSet=%s', replicaSet) : '';

    var hostsUrl = hosts.join(',');

    return util.format('mongodb://%s%s/%s%s', credentialsUrl, hostsUrl, database, replicaSetUrl);
}


function extend() {
    var args = [{}];
    for(var i = 0; i < arguments.length; i++) {
        args.push(arguments[i]);
    }

    function deepExtend(curVal, newVal) {
        if((_.isObject(curVal) && !(_.isFunction(curVal))) &&
           (_.isObject(newVal) && !(_.isFunction(newVal)))) {
            return extend(curVal, newVal);
        } else {
            return newVal;
        }
    }

    args.push(deepExtend);

    return _.extend.apply(this, arguments);
}


/**
 * Run each resolver function (passing in the current options) and then combine their output (with
 * later resolvers taking precedence).
 *
 * @param  {...Function} resolvers - One or more resolver functions, which take in the set of
 * current program options (as set when resolve is called) and returns the program options to set.
 *
 * @return {Object} The set of program options created by merging the options generated by all
 * resolvers.
 */
function resolve(resolvers) {
    return _.reduce(
        arguments,
        function(resolved, resolver) {
            try {
                return extend(resolved, (_.isFunction(resolver) ? resolver(resolved) : resolver));
            } catch(err) {
                configErrors.push(err);
                return resolved;
            }
        },
        {}
    );
}


/**
 * Returns an object containing the current set of resolved options for Graphistry apps.
 * @param  {Object} optionOverrides - Options which will override all other options generators.
 * @return {Object} The set of program options generated by resolving all sources of options.
 */
function getOptions(optionOverrides) {
    optionOverrides = optionOverrides || {};
    var overrides = resolve(commandLine, optionOverrides);

    var optionsResolved = resolve(defaults, overrides, deployEnv, synthesized, overrides);
    return optionsResolved;
};


module.exports = (function() {
    var emptyArgKey = (Math.random()).toString();

    return _.memoize(getOptions, function() {
        return arguments.length > 0 ? JSON.stringify(arguments) : emptyArgKey;
    });
})();
