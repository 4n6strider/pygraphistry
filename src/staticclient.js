'use strict';

/*
    Static-only facet for client.js
*/

var debug        = require('debug')('graphistry:StreamGL:staticclient');
var $            = window.$;
var Rx           = require('rxjs/Rx');
                   require('./rx-jquery-stub');
var _            = require('underscore');

var renderer     = require('./renderer.js');
var caption      = require('./caption.js');


//======

var DimCodes = {
    point: 1,
    edge: 2
};

// Site-level configuration:
var BUCKET_REGION = 'us-west-1';
var BUCKET_NAME = 'graphistry.data';
var BUCKET_URL = 'https://s3-' + BUCKET_REGION + '.amazonaws.com/' + BUCKET_NAME;
var BASE_URL = BUCKET_URL + '/Static/';

// Per-content-instance:
// TODO: de-globalize:
var contentKey;
var labelsByType = {point: {}, edge: {}};


// ======

/**
 * URL composition for static content access.
 * @param {string} contentKey - identifies which content bundle sub-part of the bucket
 * @param {string} contentPath - identifies the member of the content bundle (relative file name/path)
 * @returns {string}
 */
function getStaticContentURL(contentKey, contentPath) {
    return BASE_URL + contentKey + '/' + (contentPath || '');
}


// string * {socketHost: string, socketPort: int} -> (... -> ...)
// where fragment == 'vbo?buffer' or 'texture?name'
function makeFetcher() {
// string * {<name> -> int} * name -> Subject ArrayBuffer
    return function (bufferByteLengths, bufferName) {

        debug('fetching', bufferName);

        var res = new Rx.Subject();

        // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/Sending_and_Receiving_Binary_Data?redirectlocale=en-US&redirectslug=DOM%2FXMLHttpRequest%2FSending_and_Receiving_Binary_Data
        var oReq = new XMLHttpRequest();
        var assetURL = getStaticContentURL(contentKey, bufferName);
        oReq.open('GET', assetURL, true);
        // Handling a response as an arraybuffer means bypassing $.ajax:
        oReq.responseType = 'arraybuffer';

        var now = Date.now();
        oReq.onload = function () {
            if (oReq.status !== 200) {
                console.error('HTTP error acquiring data at: ', assetURL, oReq.statusText);
                return;
            }
            try {
                debug('got texture/vbo data', bufferName, Date.now() - now, 'ms');

                var arrayBuffer = oReq.response; // Note: not oReq.responseText
                if (bufferByteLengths.hasOwnProperty(bufferName)) {
                    var bufferLength = bufferByteLengths[bufferName];
                    debug('Buffer length (%s): %d, %d', bufferName, bufferLength, arrayBuffer.byteLength);
                    var trimmedArray = new Uint8Array(arrayBuffer, 0, bufferLength);

                    res.onNext(trimmedArray);
                } else {
                    res.onNext(new Uint8Array(arrayBuffer));
                }

            } catch (e) {
                console.error('Render error on loading data into WebGL:', e, e.stack);
            }
        };

        oReq.send(null);

        return res.take(1);
    };
}

/**
 * Observable stream for one AJAX GET for a label offsets buffer (pure binary, UInt32Array).
 * @param {String} bufferName
 * @returns {Rx.ReplaySubject}
 */
function fetchOffsetBuffer(bufferName) {
    debug('fetching', bufferName);

    // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/Sending_and_Receiving_Binary_Data?redirectlocale=en-US&redirectslug=DOM%2FXMLHttpRequest%2FSending_and_Receiving_Binary_Data
    var result = new Rx.ReplaySubject(1),
        oReq = new XMLHttpRequest(),
        assetURL = getStaticContentURL(contentKey, bufferName),
        now = Date.now();
    oReq.open('GET', assetURL, true);
    // Handling a response as an arraybuffer means bypassing $.ajax:
    oReq.responseType = 'arraybuffer';

    oReq.onload = function () {
        if (oReq.status !== 200) {
            console.error('HTTP error acquiring data at: ', assetURL, oReq.statusText);
            return;
        }
        try {
            debug('got offset data', bufferName, Date.now() - now, 'ms');

            var arrayBuffer = oReq.response; // Note: not oReq.responseText
            // Uint32Array to match persist.js static export format.
            result.onNext(new Uint32Array(arrayBuffer));
        } catch (e) {
            console.error('Render error on loading data:', e, e.stack);
        }
    };

    oReq.send(null);

    return result;
}

/**
 * @param {String} type 'point' or 'edge'
 * @returns {Rx.ReplaySubject}
 */
function getLabelOffsets(type) {
    var bufferName = type + 'Labels.offsets';
    return fetchOffsetBuffer(bufferName).do(function (labelContentOffsets) {
        debug('Got offsets for', type, labelContentOffsets);
    });
}


/** Arbitrary limit to prevent large range requests, ~ 260kb. */
var LABEL_SIZE_LIMIT = Math.pow(2, 18);


function getLabelViaRange(type, index, byteStart, byteEnd) {
    var res = new Rx.Subject();
    var oReq = new XMLHttpRequest();
    var assetURL = getStaticContentURL(contentKey, type + 'Labels.buffer');
    var byteStartString = byteStart !== undefined && byteStart.toString ? byteStart.toString(10) : '';
    var byteEndString = byteEnd !== undefined && byteEnd.toString ? byteEnd.toString(10) : '';

    // First label: start can be 0, but end must be set.
    // Last label: start is set, end unspecified, okay.
    if (byteStartString || byteEndString) {
        oReq.responseType = 'text'; // 'json' does not work for a range request!
        if (!isNaN(byteEnd - byteStart)) {
            if (byteEnd - byteStart > LABEL_SIZE_LIMIT) {
                throw new Error('Too large labels range request', type, index, byteStart, byteEnd);
            }
        }

        oReq.open('GET', assetURL, true);
        oReq.setRequestHeader('Range', 'bytes=' + byteStartString + '-' + byteEndString);
        debug(assetURL, 'Range', 'bytes=' + byteStartString + '-' + byteEndString);

        oReq.onload = function () {
            if (oReq.status !== 206) {
                console.error('HTTP error acquiring ranged data at: ', assetURL);
                return;
            }
            try {
                var responseData = JSON.parse(oReq.responseText);
                // Dynamically transform deprecated/obsolete label response format of {attribute: value, ...}
                if (!responseData.hasOwnProperty('columns')) {
                    var title = responseData._title;
                    responseData = {
                        formatted: false,
                        title: decodeURIComponent(title),
                        columns: _.pairs(_.omit(responseData, '_title'))
                    };
                }

                debug('Label fetched', responseData);
                labelsByType[type][index] = responseData;
                res.onNext([responseData]);
            } catch (e) {
                console.error('Error on loading ranged data: ', e, e.stack);
            }
        };

        oReq.send(null);
    } else {
        throw new Error('Undefined labels range request', type, index, byteStart, byteEnd);
    }

    return res;
}


function getRangeForLabel(offsetsForType, type, index) {
    if (!offsetsForType) {
        throw new Error('Label offsets not found for type', type);
    }

    var lowerBound = offsetsForType[index];
    // Upper bound will be undefined for last label
    var upperBound = index < offsetsForType.length ? offsetsForType[index + 1] - 1 : undefined;

    if (upperBound !== undefined && lowerBound >= upperBound) {
        throw new Error('Invalid byte range indicated at', type, index);
    }
    return [lowerBound, upperBound];
}


function getLabel(offsetsForType, type, index) {
    var translatedType = _.findKey(DimCodes, function (dimCode) { return dimCode === type; }) || type,
        labelCache = labelsByType[translatedType];
    if (labelCache.hasOwnProperty(index)) {
        var res = new Rx.Subject();
        res.onNext(labelCache[index]);
        return res;
    }
    var range = getRangeForLabel(offsetsForType, translatedType, index);
    return getLabelViaRange(translatedType, index, range[0], range[1]);
}


module.exports = {

    getStaticContentURL: getStaticContentURL,

    connect: function (vizType, urlParams) {
        debug('connect', vizType, urlParams);

        contentKey = urlParams.contentKey;

        var offsetsSource = Rx.Observable.combineLatest(
            getLabelOffsets('point'),
            getLabelOffsets('edge'),
            function (pointsOffsets, edgesOffsets) {
                // Ensure that points and edges are accessed at the same enum dim value (1 and 2):
                return [undefined, pointsOffsets, edgesOffsets];
            }
        );
        var offsetsCombined = new Rx.ReplaySubject(1);
        offsetsSource.subscribe(offsetsCombined);

        return Rx.Observable.return({
            socket: {
                on: function (eventName) {
                    debug('ignoring on event', eventName);
                },
                emit: function (eventName, data, cb) {
                    if (eventName === 'get_labels') {
                        var dim = data.dim,
                            indices = data.indices;
                        offsetsCombined.flatMap(function (offsetsArray) {
                            return getLabel(offsetsArray[dim], dim, indices[0]);
                        }).do(function (responseData) {
                            cb(undefined, responseData);
                        }).subscribe(_.identity, function (err) {
                            console.error('Error fetching labels', data, err, (err || {}).stack);
                            cb(err, data);
                        });
                    } else if (eventName === 'interaction') {
                        // Ignored for now, cuts back on logs.
                        return undefined;
                    } else {
                        debug('ignoring emit event', eventName);
                    }
                }
            },
            uri: {}
        });
    },

    createRenderer: function (socket, canvas, urlParams) {
        debug('createRenderer');

        return $.ajaxAsObservable({
                url: getStaticContentURL(contentKey, 'renderconfig.json'),
                dataType: 'json'
            })
            .catch(function (error) {
                console.error('Error retrieving render config.', error);
                throw new Error('Content Not Found');
            })
            .pluck('data')
            .map(function (data) {
                debug('got', data);
                var renderState = renderer.init(data, canvas, urlParams);
                debug('Renderer created');
                return renderState;
            });
    },

    handleVboUpdates: function (socket, uri, renderState) {
        debug('handle vbo updates');

        var vboUpdates = new Rx.ReplaySubject(1);
        vboUpdates.onNext('init');

        var previousVersions = {buffers: {}, textures: {}};
        var vboVersions = new Rx.BehaviorSubject(previousVersions);

        var bufferBlackList = ['selectedPointIndexes', 'selectedEdgeIndexes'];

        $.ajaxAsObservable({url: getStaticContentURL(contentKey, 'metadata.json'), dataType: 'json'})
            .pluck('data')
            .do(function (data) {
                debug('got metadata', data);

                caption.renderCaptionFromData(data);

                vboUpdates.onNext('start');

                var fetchBuffer = makeFetcher().bind(data.bufferByteLengths, '');
                var fetchTexture = makeFetcher().bind(data.bufferByteLengths, '');

                var readyBuffers = new Rx.ReplaySubject(1);
                var readyTextures = new Rx.ReplaySubject(1);
                var readyToRender = Rx.Observable.zip(readyBuffers, readyTextures, _.identity).share();
                readyToRender.subscribe(
                    function () { vboUpdates.onNext('received'); },
                    function (err) { console.error('readyToRender error', err, (err||{}).stack); });

                var changedBufferNames = _.select(_.keys(data.bufferByteLengths), function(bufferName) {
                    return !_.contains(bufferBlackList, bufferName);
                });
                var bufferFileNames = changedBufferNames.map(function (bufferName) {
                    return bufferName + '.vbo';
                });
                var bufferVBOs = Rx.Observable.combineLatest(
                    [Rx.Observable.return()]
                        .concat(bufferFileNames.map(fetchBuffer)))
                    .take(1);
                bufferVBOs
                    .subscribe(
                        function (vbos) {
                            vbos.shift();
                            var bindings = _.object(_.zip(changedBufferNames, vbos));
                            try {
                                _.each(data.elements, function (num, itemName) {
                                    renderer.setNumElements(renderState, itemName, num);
                                });
                                renderer.loadBuffers(renderState, bindings);
                                readyBuffers.onNext();
                            } catch (e) {
                                console.error('Render error on loading data into WebGL:', e, e.stack);
                            }
                        },
                        function (err) {
                            console.error('bufferVBOs exn', err, (err||{}).stack);
                        });

                var changedTextureNames = [];
                var texturesData = Rx.Observable.combineLatest(
                    [Rx.Observable.return()]
                        .concat(changedTextureNames.map(fetchTexture)))
                    .take(1);
                texturesData
                    .subscribe(function (textures) {
                            textures.shift();
                            var textureNfos = changedTextureNames.map(function (name, i) {
                                return _.extend(data.textures[name], {buffer: textures[i]});
                            });
                            var bindings = _.object(_.zip(changedTextureNames, textureNfos));
                            renderer.loadTextures(renderState, bindings);
                            readyTextures.onNext();
                        },
                        function (err) {
                            console.error('texturesData exn', err, (err||{}).stack);
                        });

            }).subscribe(_.identity,
                function (err) {
                    console.error('fetch vbo exn', err, (err||{}).stack);
                    throw new Error('Content Not Found');
                });

        return {
            vboUpdates: vboUpdates,
            vboVersions: vboVersions
        };

    }
};
