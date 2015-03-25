var Q = require('q');
var _ = require('underscore');
var fs = require('fs');
var debug = require('debug')('graphistry:etl:vgraph');
var pb = require('protobufjs');
var zlib = require('zlib');
var path = require('path');
var sprintf = require('sprintf-js').sprintf;

var protoFile = path.resolve(__dirname, '../node_modules/graph-viz/js/libs/graph_vector.proto');
var builder = pb.loadProtoFile(protoFile);
if (builder === null) {
    console.error('error: could not build proto', err, err.stack);
    process.exit(-1);
}
var pb_root = builder.build();

var defaults = {
    'double': NaN,
    'integer': 0,
    'string': 'n/a',
};

// String * String -> Vector
function makeVector(name, type, target) {
    var vector;

    if (type === 'double') {
        vector = new pb_root.VectorGraph.DoubleAttributeVector();
        vector.dest = 'double_vectors';
        vector.transform = parseFloat;
    } else if (type === 'integer') {
        vector = new pb_root.VectorGraph.Int32AttributeVector();
        vector.dest = 'int32_vectors';
        vector.transform = function (x) {
            return parseInt(x) || 0
        };
    } else {
        vector = new pb_root.VectorGraph.StringAttributeVector();
        vector.dest = 'string_vectors';
        vector.transform = function (x) {
            return String(x).trim();
        };
    }

    vector.default = defaults[type];
    vector.name = name;
    vector.target = target;
    vector.values = [];
    vector.map = {};
    return vector;
}

// JSON -> {String -> Vector}
function getAttributeVectors(header, target) {
    var map = _.map(header, function (info, key) {
        if (info.type === 'empty') {
            console.info('Skipping attribute', key, 'because it has no data.');
            return [];
        }
        var vec = makeVector(key, info.type, target);
        return [key, vec];
    });

    return _.object(_.filter(map, function (x) {return x.length > 0;}));
}

function defined(value) {
    return value !== undefined && value !== null &&
        value !== '' && value !== 'n/a' &&
        !(typeof value === 'number' && isNaN(value));
}

function inferType(samples) {
    if (samples.length == 0)
        return 'empty';
    if (_.all(samples, function (val) { return !isNaN(val); })) {
        if (_.all(samples, function (val) { return val === +val && val === (val|0); })) {
            return 'integer'
        } else {
            return 'double';
        }
    } else {
        return 'string';
    }
}

function getHeader(table) {
    var res = {};

    var total = 0;

    _.each(table, function (row) {
        _.each(_.keys(row), function (key) {

            var data = res[key] || {count: 0, samples: [], type: undefined};
            var val = row[key];
            if (defined(val)) {
                data.count++;
                if (data.samples.length < 100) {
                    data.samples.push(val);
                }
            }
            res[key] = data;
        });
        total++;
    })

    return _.object(_.map(res, function (data, name) {
        data.freq = data.count / total;
        data.type = inferType(data.samples);
        return [name, data];
    }));
}

// Simple (and dumb) conversion of JSON edge lists to VGraph
// JSON * String * String * String -> VGraph
function fromEdgeList(elist, nlabels, srcField, dstField, idField,  name) {
    var node2Idx = {};
    var idx2Node = {};
    var nodeCount = 0;
    var edges = [];
    // For detecting duplicate edges.
    var edgeMap = {}

    function addNode(node) {
        if (!(node in node2Idx)) {
            idx2Node[nodeCount] = node;
            node2Idx[node] = nodeCount;
            nodeCount++;
        }
    }

    function warnIfDuplicated(src, dst) {
        var dsts = edgeMap[src] || {};
        if (dst in dsts) {
            console.info('Edge %s -> %s is duplicated', src, dst);
        }

        var srcs = edgeMap[dst] || {};
        if (src in srcs) {
            console.info('Edge %s <-> %s has both directions', src, dst)
        }
    }

    function addEdge(node0, node1, entry) {
        var e = new pb_root.VectorGraph.Edge();
        e.src = node2Idx[node0];
        e.dst = node2Idx[node1];
        edges.push(e);

        warnIfDuplicated(node0, node1);
        var dsts = edgeMap[node0] || {};
        dsts[node1] = true;
        edgeMap[node0] = dsts;
    }

    function addAttributes(vectors, entry) {
        _.each(vectors, function (vector, name) {
            if (name in entry && entry[name] !== null) {
                vector.values.push(vector.transform(entry[name]));
            } else {
                vector.values.push(vector.default);
            }
        });
    }

    debug('Infering schema...');
    var eheader = getHeader(elist);
    console.log('Edge Table');
    _.each(eheader, function (data, key) {
        console.log(sprintf('%36s: %3d%% filled    %s', key, Math.floor(data.freq * 100).toFixed(0), data.type));
    });
    var nheader = getHeader(nlabels);
    console.log('Node Table');
    _.each(nheader, function (data, key) {
        console.log(sprintf('%36s: %3d%% filled    %s', key, Math.floor(data.freq * 100).toFixed(0), data.type));
    });

    if (!(srcField in eheader) || eheader[srcField].count < elist.length) {
        console.warn('Edges have no srcField' , srcField);
        return undefined;
    }
    if (!(dstField in eheader) || eheader[dstField].count < elist.length) {
        console.warn('Edges have no dstField' , dstField);
        return undefined;
    }
    if (!(idField in nheader) || nheader[idField].count < nlabels.length) {
        console.warn('Nodes have no idField' , idField);
        return undefined;
    }
    var evectors = getAttributeVectors(eheader, pb_root.VectorGraph.AttributeTarget.EDGE);
    var nvectors = getAttributeVectors(nheader, pb_root.VectorGraph.AttributeTarget.VERTEX);

    debug('Loading', elist.length, 'edges...');
    _.each(elist, function (entry) {
        var node0 = entry[srcField];
        var node1 = entry[dstField];
        addNode(node0);
        addNode(node1);
        addEdge(node0, node1);
        addAttributes(evectors, entry);
    });

    debug('Loading', nlabels.length, 'labels for', nodeCount, 'nodes');
    if (nodeCount > nlabels.length) {
        console.info('There are', nodeCount - nlabels.length, 'labels missing');
    }

    var sortedLabels = new Array(nodeCount);
    for (var i = 0; i < nlabels.length; i++) {
        var label = nlabels[i];
        var nodeId = label[idField];
        if (nodeId in node2Idx) {
            var labelIdx = node2Idx[nodeId];
            sortedLabels[labelIdx] = label;
        } else {
            console.info(sprintf('Skipping label #%6d (nodeId: %10s) which has no matching node.', i, nodeId));
        }
    }

    _.each(sortedLabels, function (entry) {
        addAttributes(nvectors, entry || {});
    });

    debug('Encoding protobuf...');
    var vg = new pb_root.VectorGraph();
    vg.version = 0;
    vg.name = name;
    vg.type = pb_root.VectorGraph.GraphType.DIRECTED;
    vg.nvertices = nodeCount;
    vg.nedges = edges.length;
    vg.edges = edges;

    _.each(_.omit(evectors, srcField, dstField), function (vector) {
        vg[vector.dest].push(vector);
    });

    _.each(_.omit(nvectors, '_mkv_child', '_timediff'), function (vector) {
        vg[vector.dest].push(vector);
    });

    //debug('VectorGraph', vg);
    debug('Encoding vgraph done');

    return vg;
}

module.exports = {
    fromEdgeList: fromEdgeList
};
