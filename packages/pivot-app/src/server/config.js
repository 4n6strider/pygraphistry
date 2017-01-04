import convict from 'convict';
import path from 'path';
import glob from 'glob';


// Define a schema
const conf = convict({
    env: {
        doc: 'The applicaton environment.',
        format: ['production', 'development', 'test'],
        default: 'development',
        env: 'NODE_ENV'
    },
    host: {
        doc: 'Pivot-app host name/IP',
        format: 'ipaddress',
        default: '0.0.0.0',
        env: 'HOST',
    },
    port: {
        doc: 'Pivot-app port number',
        format: 'port',
        default: 80,
        arg: 'port',
        env: 'PORT'
    },
    auth: {
        password: {
            doc: 'bcrypt hashed password needed to access this app over the web',
            format: String,
            default: undefined,
            arg: 'password',
            env: 'PASSWORD'
        }
    },
    pivotApp: {
        dataDir: {
            doc: 'Directory to store investigation files',
            format: String,
            default: 'data',
            arg: 'pivot-data-dir'
        }
    },
    log: {
        level: {
            doc: `Log levels - ['trace', 'debug', 'info', 'warn', 'error', 'fatal']`,
            format: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
            default: 'info',
            arg: 'log-level',
            env: 'GRAPHISTRY_LOG_LEVEL' // LOG_LEVEL conflicts with mocha
        },
        file: {
            doc: 'Log so a file intead of standard out',
            format: String,
            default: undefined,
            arg: 'log-file',
            env: 'LOG_FILE'
        },
        logSource: {
            doc: 'Logs line numbers with debug statements. Bad for Perf.',
            format: [ true, false ],
            default: false,
            arg: 'log-source',
            env: 'LOG_SOURCE'
        }
    },
    graphistry: {
        key: {
            doc: `Graphistry's api key`,
            format: String,
            default: undefined,
            arg:'graphistry-key',
            env: 'GRAPHISTRY_KEY'
        },
        host: {
            doc: `The location of Graphistry's Server`,
            format: String,
            default: 'https://labs.graphistry.com',
            arg: 'graphistry-host',
            env: 'GRAPHISTRY_HOST'
        }
    },
    splunk: {
        key: {
            doc: 'Splunk password',
            format: String,
            default: undefined,
            arg: 'splunk-key',
            env: 'SPLUNK_KEY'
        },
        user: {
            doc: 'Splunk user name',
            format: String,
            default: undefined,
            arg: 'splunk-user',
            env: 'SPLUNK_USER'
        },
        host: {
            doc: 'The hostname of the Splunk Server',
            format: String,
            default: undefined,
            arg: 'splunk-host',
            env: 'SPLUNK_HOST'
        },
        jobCacheTimeout: {
            doc: 'Time (in seconds) during which Splunk caches the query results. Set to -1 to disable caching altogether',
            format: Number,
            default: 14400,
            arg: 'splunk-cache-timeout',
            env: 'SPLUNK_CACHE_TIMEOUT'
        },
        searchMaxTime: {
            doc: 'Maximum time (in seconds) allowed for executing a Splunk search query.',
            format: Number,
            default: 20,
            arg: 'splunk-search-max-time',
            env: 'SPLUNK_SEARCH_MAX_TIME',
        }
    }
});


let configFiles = [];

if (process.env.CONFIG_FILES) {
    configFiles = process.env.CONFIG_FILES.split(',');
} else {
    const defaultConfigPath = path.resolve('.', 'config', '*.json');
    configFiles = glob.sync(defaultConfigPath);
}

// eslint-disable-next-line no-console
console.log(`Loading configuration from ${configFiles.join(", ")}`);

conf.loadFile(configFiles);
conf.validate({strict: true});

module.exports = conf;
