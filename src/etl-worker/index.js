'use strict';

var Q           = require('q');
var _           = require('underscore');
var sprintf     = require('sprintf-js').sprintf;
var bodyParser  = require('body-parser');
var multer      = require('multer');

var config      = require('@graphistry/config')();
var Log         = require('@graphistry/common').logger;
var slack       = require('@graphistry/common').slack;
var apiKey      = require('@graphistry/common').api;
var etl1        = require('./src/etl1.js');
var etl2        = require('./src/etl2.js');
var logger      = Log.createLogger('etlworker:index');



// String * String * Sting * Object -> ()
function notifySlackAndSplunk(name, nodeCount, edgeCount, params) {
    function makeUrl(server) {
        var type = params.apiVersion == 2 ? 'jsonMeta' : 'vgraph';
        var domain;
        switch (server) {
            case 'staging':
                domain = 'http://staging.graphistry.com';
                break;
            case 'labs':
                domain = 'http://labs.graphistry.com';
                break;
            case 'localhost':
                domain = 'http://localhost:3000';
                break;
            default:
                domain = 'http://%s.graphistry.com';
        }
        var url = sprintf('%s/graph/graph.html?type=%s&dataset=%s&info=true',
                          domain, type, name);
        return sprintf('<%s|%s>', url, server);
    }
    function isInternal(key) {
        var suffix = 'graphistry.com';
        return key.slice(-suffix.length) === suffix;
    }

    var key = '';
    if (params.key) {
        try {
            key += apiKey.decrypt(params.key);
        } catch (err) {
            logger.error(err, 'Could not decrypt key');
            key += ' COULD NOT DECRYPT';
        }
    } else {
        key = 'n/a';
    }

    var links = sprintf('View on %s or %s or %s', makeUrl('labs'), makeUrl('staging'), makeUrl('localhost'));
    var title = sprintf('*New dataset:* `%s`', name);
    var tag = sprintf('`%s`', params.usertag.split('-')[0]);

    var msg = {
        channel: '#datasets',
        username: key,
        text: '',
        attachments: JSON.stringify([{
            fallback: 'New dataset: ' + name,
            text: title + '\n' + links,
            color: isInternal(key) ? 'good' : 'bad',
            fields: [
                { title: 'Nodes', value: nodeCount, short: true },
                { title: 'Edges', value: edgeCount, short: true },
                { title: 'API', value: params.apiVersion, short: true },
                { title: 'Machine Tag', value: tag, short: true },
                { title: 'Agent', value: params.agent, short: true },
                { title: 'Version', value: params.agentVersion, short: true }
            ],
            mrkdwn_in: ['text', 'pretext', 'fields']
        }])
    };

    // Log info forwarded to Slack so we can access it in Splunk
    logger.info({
        user: key,
        internal: isInternal(key),
        dataset: name,
        tag: tag,
        params: _.pick(params, ['apiVersion', 'agent', 'agentVersion']),
        nodes: nodeCount,
        edges: edgeCount,
    }, 'New dataset');

    return Q.denodeify(slack.post)(msg)
        .fail(function (err) {
            logger.error(err, 'Error posting on slack');
        });
}


// Request -> Object
function parseQueryParams(req) {
    var res = {};

    res.usertag = req.query.usertag || 'unknown';
    res.agent = req.query.agent || 'unknown';
    res.agentVersion = req.query.agentversion || '0.0.0';
    res.apiVersion = parseInt(req.query.apiversion) || 0;
    res.key = req.query.key;

    return res;
}


// Response * (Int -> ()) -> ()
function makeFailHandler(res, tearDown) {
    return function (err) {
        logger.error(err, 'ETL post fail');
        res.send({
            success: false,
            msg: err.message
        });
        logger.debug('Failed worker, tearing down');
        tearDown(1);
    };
}


// (Int -> ()) * Request * Response -> ()
function dispatcher(tearDown, req, res) {
    var params = parseQueryParams(req);

    var handlers = {
        '0': etl1.process,
        '1': etl1.process,
        '2': etl2.process
    };

    var apiVersion = params.apiVersion || 0;
    var handler = handlers[apiVersion];
    if (handler !== undefined) {
        try {
            handler(req, res, params)
                .then(function (info) {
                    return notifySlackAndSplunk(info.name, info.nodeCount, info.edgeCount, params);
                }).then(function() {
                    tearDown(0);
                }).fail(makeFailHandler(res, tearDown));
        } catch (err) {
            makeFailHandler(res, tearDown)(err);
        }
    } else {
        res.send({ success: false, msg: 'Unsupported API version:' + apiVersion });
        tearDown(1);
    }
}


// Socket * Int -> ()
function tearDown(socket, exitCode) {
    logger.debug('Worker finished, exiting');
    if (config.WORKER_RESTART) {
        process.exit(exitCode);
    } else {
        logger.info('Not actually exiting, only disconnect socket');
        socket.disconnect();
    }
}


// Express.App * Socket -> ()
function init(app, socket) {
    logger.debug({socket: socket.id}, 'Client connected');

    var JSONParser = bodyParser.json({limit: '384mb'}); // This is the uncompressed size

    var fields = _.map(_.range(16), function (n) {
        return { name: 'data' + n, maxCount: 1 };
    }).concat([{ name: 'metadata', maxCount: 1 }]);

    var formParser = multer({ storage: multer.memoryStorage() }).fields(fields);

    var apiDispatcher = dispatcher.bind('', tearDown.bind('', socket));
    app.post('/etl', JSONParser, formParser, apiDispatcher);
}


module.exports = {
    staticFilePath: function() { return __dirname; },
    init: init
};
